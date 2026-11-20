-- Dogcare — the iPhone app writes my confirmed gardes into its own calendar
-- (no subscription delay). It reads them as the signed-in user, with the
-- same rule as the calendar subscription (calendar_feed_events): live
-- assignments I keep, or on my dogs, of active requests in my groups.

create function private.calendar_events_for(p_uid uuid)
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
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    r.id,
    case when a.assigned_user_id = p_uid then 'sitter' else 'owner' end,
    r.request_type,
    a.status,
    a.starts_at,
    a.ends_at,
    d.name,
    case
      when a.assigned_user_id = p_uid then coalesce(private.display_name(r.created_by), '')
      else private.display_name(a.assigned_user_id)
    end,
    r.description,
    greatest(a.updated_at, r.updated_at)
  from public.care_assignments a
  join public.care_requests r on r.id = a.request_id
  join public.dogs d on d.id = r.dog_id
  where p_uid is not null
    and a.status <> 'cancelled'
    and r.lifecycle_status = 'active'
    and a.ends_at > now() - interval '60 days'
    and exists (select 1 from public.group_members m where m.group_id = r.group_id and m.user_id = p_uid)
    and (
      a.assigned_user_id = p_uid
      or exists (select 1 from public.dog_caretakers c where c.dog_id = r.dog_id and c.user_id = p_uid)
    )
  order by a.starts_at
  limit 1000;
$$;

revoke all on function private.calendar_events_for(uuid) from public, anon, authenticated;

-- the subscription (no session): the feed owner's events, by token
create or replace function public.calendar_feed_events(p_token text)
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
  return query select * from private.calendar_events_for(v_uid);
end;
$$;

-- the app (signed in): my own events
create function public.my_calendar_events()
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
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.calendar_events_for(auth.uid());
$$;

revoke all on function public.my_calendar_events() from public, anon;
grant execute on function public.my_calendar_events() to authenticated;
