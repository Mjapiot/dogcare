-- Dogcare — personal calendar subscription (webcal)
-- Each user can get a secret feed URL that Apple Calendar (or any calendar
-- app) polls. The feed lists confirmed assignments: the ones the user takes
-- on, and the ones covering the user's own dogs. Cancelled assignments and
-- requests drop out of the feed, so subscribed calendars follow changes.
-- The calendar app fetches without a session: the token is the only key.

create table public.calendar_feeds (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now()
);

alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;
-- no policy: tokens are only read and written through the functions below

-- 32 random bytes, base64url without padding (43 characters)
create function private.new_feed_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
$$;

-- Current user: feed token (created on first use), or null if disabled
create function public.get_calendar_feed_token(p_create boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  select token into v_token from public.calendar_feeds where user_id = v_uid;
  if v_token is null and p_create then
    insert into public.calendar_feeds (user_id, token)
    values (v_uid, private.new_feed_token())
    on conflict (user_id) do update set token = public.calendar_feeds.token
    returning token into v_token;
  end if;
  return v_token;
end;
$$;

-- Current user: new feed URL (the old one stops working) or disable it
create function public.reset_calendar_feed_token(p_enabled boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  delete from public.calendar_feeds where user_id = auth.uid();
  if not p_enabled then
    return null;
  end if;
  return public.get_calendar_feed_token(true);
end;
$$;

-- Calendar app (no session): events of the feed owner. An unknown token
-- returns nothing. Only live assignments of active requests, in groups the
-- owner still belongs to, from 60 days ago onwards.
create function public.calendar_feed_events(p_token text)
returns table (
  assignment_id uuid,
  request_id uuid,
  role text,
  request_type public.request_type,
  assignment_status public.assignment_status,
  starts_at timestamptz,
  ends_at timestamptz,
  dog_name text,
  other_name text,
  description text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return;
  end if;
  select f.user_id into v_uid from public.calendar_feeds f where f.token = p_token;
  if v_uid is null then
    return;
  end if;

  return query
  select
    a.id,
    r.id,
    case when a.assigned_user_id = v_uid then 'sitter' else 'owner' end,
    r.request_type,
    a.status,
    a.starts_at,
    a.ends_at,
    d.name,
    case
      when a.assigned_user_id = v_uid then coalesce(private.display_name(r.created_by), '')
      else private.display_name(a.assigned_user_id)
    end,
    r.description,
    greatest(a.updated_at, r.updated_at)
  from public.care_assignments a
  join public.care_requests r on r.id = a.request_id
  join public.dogs d on d.id = r.dog_id
  where a.status <> 'cancelled'
    and r.lifecycle_status = 'active'
    and a.ends_at > now() - interval '60 days'
    and exists (select 1 from public.group_members m where m.group_id = r.group_id and m.user_id = v_uid)
    and (
      a.assigned_user_id = v_uid
      or exists (select 1 from public.dog_caretakers c where c.dog_id = r.dog_id and c.user_id = v_uid)
    )
  order by a.starts_at
  limit 1000;
end;
$$;

revoke all on function private.new_feed_token() from public, anon, authenticated;
revoke all on function public.get_calendar_feed_token(boolean) from public, anon;
revoke all on function public.reset_calendar_feed_token(boolean) from public, anon;
revoke all on function public.calendar_feed_events(text) from public;
grant execute on function public.get_calendar_feed_token(boolean) to authenticated;
grant execute on function public.reset_calendar_feed_token(boolean) to authenticated;
-- called by the feed route with the publishable key (no session)
grant execute on function public.calendar_feed_events(text) to anon, authenticated;
