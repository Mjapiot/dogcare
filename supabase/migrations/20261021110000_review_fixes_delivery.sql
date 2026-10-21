-- Dogcare — review fixes (2026-10-21), part 3: push delivery, retention, indexes

-- ---------------------------------------------------------------------------
-- Push retries: a notification that could not be delivered goes back to the
-- queue (at most 5 attempts, never later than 30 minutes after creation).
-- ---------------------------------------------------------------------------
alter table public.notifications add column push_attempts integer not null default 0;

create or replace function public.claim_push_batch(p_limit integer default 100)
returns table (
  id uuid,
  user_id uuid,
  notification_type public.notification_type,
  title text,
  body text,
  request_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications n
    set push_state = 'skipped'
  where n.push_state in ('pending', 'sending')
    and n.created_at < now() - interval '30 minutes';

  return query
  with batch as (
    select n.id
    from public.notifications n
    where (n.push_state = 'pending' and (n.push_claimed_at is null or n.push_claimed_at < now() - interval '1 minute'))
       or (n.push_state = 'sending' and n.push_claimed_at < now() - interval '2 minutes')
    order by n.created_at
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  )
  update public.notifications n
    set push_state = 'sending', push_claimed_at = now()
  from batch
  where n.id = batch.id
  returning n.id, n.user_id, n.notification_type, n.title, n.body, n.request_id;
end;
$$;

-- puts notifications back in the queue after a transient failure
create function public.release_push_batch(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
    set push_attempts = push_attempts + 1,
        push_state = case when push_attempts + 1 >= 5 then 'skipped' else 'pending' end,
        push_claimed_at = now()
  where id = any (p_ids) and push_state = 'sending';
$$;

-- ---------------------------------------------------------------------------
-- Retention: old notifications and audit events are purged
-- ---------------------------------------------------------------------------
create function public.purge_old_records()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notifications where created_at < now() - interval '180 days';
  delete from public.audit_events where created_at < now() - interval '365 days';
$$;

revoke all on function public.release_push_batch(uuid[]) from public, anon, authenticated;
revoke all on function public.purge_old_records() from public, anon, authenticated;
revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.release_push_batch(uuid[]) to service_role;
grant execute on function public.purge_old_records() to service_role;
grant execute on function public.claim_push_batch(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Indexes for upcoming-request lookups, retention and foreign keys
-- ---------------------------------------------------------------------------
create index care_requests_group_active_end_idx on public.care_requests (group_id, ends_at)
  where lifecycle_status = 'active';
create index notifications_created_idx on public.notifications (created_at);
create index notifications_request_idx on public.notifications (request_id);
create index notifications_group_idx on public.notifications (group_id);
create index notifications_actor_idx on public.notifications (actor_id);
create index audit_events_created_idx on public.audit_events (created_at);
create index care_assignments_confirmed_by_idx on public.care_assignments (confirmed_by);
create index care_assignments_cancelled_by_idx on public.care_assignments (cancelled_by);
create index groups_created_by_idx on public.groups (created_by);
create index dogs_created_by_idx on public.dogs (created_by);
create index group_invitations_created_by_idx on public.group_invitations (created_by);
create index availability_entries_date_idx on public.availability_entries (date);
