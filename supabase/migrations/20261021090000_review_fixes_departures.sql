-- Dogcare — review fixes (2026-10-21), part 1
--  * groups (and therefore accounts) can be deleted even when they have requests
--  * a helper who leaves a group or deletes their account never leaves a
--    confirmed assignment behind silently: it is cancelled and owners notified
--  * push subscriptions can only be written through validated functions

-- ---------------------------------------------------------------------------
-- Deleting a group deletes its requests. The composite FK to group_dogs is
-- kept: unsharing a dog that still has requests in a group stays refused.
-- ---------------------------------------------------------------------------
alter table public.care_requests
  add constraint care_requests_group_id_fkey
  foreign key (group_id) references public.groups (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Withdraw a member's future commitments (all groups when p_group_id is null)
-- ---------------------------------------------------------------------------
create function private.withdraw_member_commitments(p_user_id uuid, p_group_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(private.display_name(p_user_id), 'Un membre');
  v_a record;
  v_owner record;
begin
  for v_a in
    select a.id, a.starts_at, a.ends_at, r.id as request_id, r.group_id, r.dog_id, d.name as dog_name
    from public.care_assignments a
    join public.care_requests r on r.id = a.request_id
    join public.dogs d on d.id = r.dog_id
    where a.assigned_user_id = p_user_id
      and a.status <> 'cancelled'
      and a.ends_at > now()
      and r.lifecycle_status = 'active'
      and (p_group_id is null or r.group_id = p_group_id)
    for update of a
  loop
    update public.care_assignments
      set status = 'cancelled', cancelled_at = now(), cancelled_by = null,
          cancellation_reason = left(v_name || ' ' || p_reason, 500)
      where id = v_a.id;
    for v_owner in
      select user_id from public.dog_caretakers where dog_id = v_a.dog_id and user_id <> p_user_id
    loop
      perform private.notify(v_owner.user_id, v_a.group_id, 'assignment_cancelled',
        v_name || ' ne peut plus garder ' || v_a.dog_name,
        private.fmt_period(v_a.starts_at, v_a.ends_at) || ' — ' || v_name || ' ' || p_reason || '. Le créneau est à réorganiser.',
        v_a.request_id, null);
    end loop;
  end loop;

  -- answers to requests that are still ahead no longer stand
  delete from public.request_responses rr
  using public.care_requests r
  where rr.request_id = r.id
    and rr.user_id = p_user_id
    and r.ends_at > now()
    and (p_group_id is null or r.group_id = p_group_id);
end;
$$;

create function private.group_members_withdraw()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.groups where id = old.group_id) then
    return null; -- the whole group is being deleted
  end if;
  if not exists (select 1 from auth.users where id = old.user_id) then
    return null; -- account deletion: handled before the user row disappears
  end if;
  perform private.withdraw_member_commitments(
    old.user_id,
    old.group_id,
    case when (select auth.uid()) = old.user_id then 'a quitté le groupe' else 'ne fait plus partie du groupe' end
  );
  return null;
end;
$$;

create trigger group_members_withdraw after delete on public.group_members
  for each row execute function private.group_members_withdraw();

-- Runs before the cascades of an account deletion (from the app or by an
-- operator), while the profile and the assignments still exist.
create function private.handle_user_deleting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.withdraw_member_commitments(old.id, null, 'a supprimé son compte');
  return old;
end;
$$;

create trigger on_auth_user_deleting before delete on auth.users
  for each row execute function private.handle_user_deleting();

-- ---------------------------------------------------------------------------
-- Push subscriptions: no direct writes from clients (prevents registering
-- arbitrary URLs the server would then call). Deleting one's own device stays.
-- ---------------------------------------------------------------------------
delete from public.push_subscriptions
where not (endpoint ~ '^https://\S+$' or endpoint ~ '^apns:[0-9a-f]{64,200}$');

alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_format
  check (endpoint ~ '^https://\S+$' or endpoint ~ '^apns:[0-9a-f]{64,200}$');

revoke insert, update on public.push_subscriptions from authenticated;
drop policy "push_subscriptions: insert own" on public.push_subscriptions;
drop policy "push_subscriptions: update own" on public.push_subscriptions;

revoke all on function private.withdraw_member_commitments(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.group_members_withdraw() from public, anon, authenticated;
revoke all on function private.handle_user_deleting() from public, anon, authenticated;
