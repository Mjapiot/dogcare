-- Dogcare — Web Push delivery
-- Every in-app notification is also delivered as a push to the recipient's
-- registered devices. Delivery is done by the app server (service role) right
-- after the action that created the notification.

alter table public.notifications
  add column push_state text not null default 'pending'
    check (push_state in ('pending', 'sending', 'sent', 'skipped')),
  add column push_claimed_at timestamptz;

-- notifications that existed before push was enabled are never pushed
update public.notifications set push_state = 'skipped';

create index notifications_push_pending_idx on public.notifications (created_at)
  where push_state in ('pending', 'sending');

alter table public.push_subscriptions
  add column user_agent text check (char_length(user_agent) <= 300),
  add column last_success_at timestamptz,
  add column failure_count integer not null default 0;

create trigger push_subscriptions_touch before update on public.push_subscriptions
  for each row execute function private.touch_updated_at();

-- A device (endpoint) belongs to the account currently signed in on it.
create function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or char_length(coalesce(p_p256dh, '')) not between 20 and 200
     or char_length(coalesce(p_auth, '')) not between 10 and 100 then
    raise exception 'Abonnement aux notifications invalide.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.push_subscriptions where user_id = v_uid and endpoint <> p_endpoint) >= 10 then
    -- keep the 9 most recent devices
    delete from public.push_subscriptions
    where id in (
      select id from public.push_subscriptions
      where user_id = v_uid and endpoint <> p_endpoint
      order by updated_at desc offset 9
    );
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        failure_count = 0;
end;
$$;

-- Atomically claims notifications to push (no double sending between
-- concurrent servers). Old notifications are skipped rather than pushed late.
create function public.claim_push_batch(p_limit integer default 100)
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
    where n.push_state = 'pending'
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

create function public.complete_push_batch(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set push_state = 'sent' where id = any (p_ids) and push_state = 'sending';
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- delivery functions: server (service role) only
revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
revoke all on function public.complete_push_batch(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;
grant execute on function public.complete_push_batch(uuid[]) to service_role;
