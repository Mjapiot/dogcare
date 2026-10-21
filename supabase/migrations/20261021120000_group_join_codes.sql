-- Dogcare — permanent group join code
-- An admin can show a short code (e.g. K7PQ-M2XD) that anyone signed in can
-- type to join the group. The code stays valid until the admin renews or
-- disables it. Attempts are throttled per account to prevent guessing.

create table public.group_join_codes (
  group_id uuid primary key references public.groups (id) on delete cascade,
  code text not null unique check (code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.join_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index join_code_attempts_user_idx on public.join_code_attempts (user_id, attempted_at);
create index group_join_codes_created_by_idx on public.group_join_codes (created_by);

alter table public.group_join_codes enable row level security;
alter table public.join_code_attempts enable row level security;
revoke all on public.group_join_codes from anon, authenticated;
revoke all on public.join_code_attempts from anon, authenticated;
-- no policy: codes are only read and written through the functions below

-- 31-character alphabet without look-alikes (0/O, 1/I/L): 31^8 ≈ 8.5e11 codes
create function private.new_join_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
begin
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 31), 1);
  end loop;
  return v_code;
end;
$$;

-- Admin: current code of the group (created on first use), or null if disabled
create function public.get_group_join_code(p_group_id uuid, p_create boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Seul un administrateur peut voir le code du groupe.' using errcode = 'P0001';
  end if;
  select code into v_code from public.group_join_codes where group_id = p_group_id;
  if v_code is null and p_create then
    loop
      begin
        insert into public.group_join_codes (group_id, code, created_by)
        values (p_group_id, private.new_join_code(), auth.uid())
        returning code into v_code;
        exit;
      exception when unique_violation then
        -- extremely unlikely collision: draw again
      end;
    end loop;
  end if;
  return v_code;
end;
$$;

-- Admin: renew (old code stops working) or disable the code
create function public.reset_group_join_code(p_group_id uuid, p_enabled boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Seul un administrateur peut changer le code du groupe.' using errcode = 'P0001';
  end if;
  delete from public.group_join_codes where group_id = p_group_id;
  perform private.audit(case when p_enabled then 'join_code_renewed' else 'join_code_disabled' end, p_group_id, null);
  if not p_enabled then
    return null;
  end if;
  return public.get_group_join_code(p_group_id, true);
end;
$$;

-- Anyone signed in: join with a code. Never raises for a wrong code so that
-- failed attempts are recorded (and throttled): 10 failures per 15 minutes.
create function public.join_group_with_code(p_code text)
returns table (status text, group_id uuid, group_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_group public.groups%rowtype;
  v_admin record;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.join_code_attempts a
    where a.user_id = v_uid and a.attempted_at > now() - interval '15 minutes'
  ) >= 10 then
    return query select 'throttled'::text, null::uuid, null::text;
    return;
  end if;

  select g.* into v_group
  from public.group_join_codes c join public.groups g on g.id = c.group_id
  where c.code = v_code;

  if not found then
    insert into public.join_code_attempts (user_id) values (v_uid);
    return query select 'invalid'::text, null::uuid, null::text;
    return;
  end if;

  if exists (select 1 from public.group_members m where m.group_id = v_group.id and m.user_id = v_uid) then
    return query select 'already_member'::text, v_group.id, v_group.name;
    return;
  end if;

  insert into public.group_members (group_id, user_id, role) values (v_group.id, v_uid, 'member');
  perform private.audit('joined_with_code', v_group.id, v_uid);
  for v_admin in
    select m.user_id from public.group_members m where m.group_id = v_group.id and m.role = 'admin'
  loop
    perform private.notify(v_admin.user_id, v_group.id, 'member_joined',
      private.display_name(v_uid) || ' a rejoint le groupe', 'Avec le code du groupe.', null, v_uid);
  end loop;
  return query select 'joined'::text, v_group.id, v_group.name;
end;
$$;

-- old attempts are purged with the rest
create or replace function public.purge_old_records()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notifications where created_at < now() - interval '180 days';
  delete from public.audit_events where created_at < now() - interval '365 days';
  delete from public.join_code_attempts where attempted_at < now() - interval '1 day';
$$;

revoke all on function private.new_join_code() from public, anon, authenticated;
revoke all on function public.get_group_join_code(uuid, boolean) from public, anon;
revoke all on function public.reset_group_join_code(uuid, boolean) from public, anon;
revoke all on function public.join_group_with_code(text) from public, anon;
grant execute on function public.get_group_join_code(uuid, boolean) to authenticated;
grant execute on function public.reset_group_join_code(uuid, boolean) to authenticated;
grant execute on function public.join_group_with_code(text) to authenticated;
revoke all on function public.purge_old_records() from public, anon, authenticated;
grant execute on function public.purge_old_records() to service_role;
