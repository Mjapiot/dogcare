-- Dogcare — native iOS push (APNs) next to Web Push
-- A native device is stored in push_subscriptions with platform 'ios' and
-- endpoint 'apns:<device token>' (keeps the existing uniqueness rule).

alter table public.push_subscriptions
  add column platform text not null default 'web' check (platform in ('web', 'ios')),
  add column apns_environment text check (apns_environment in ('production', 'sandbox')),
  alter column p256dh drop not null,
  alter column auth drop not null,
  add constraint push_subscriptions_web_keys check (platform <> 'web' or (p256dh is not null and auth is not null));

create function public.register_native_push(p_token text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_endpoint text;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  if p_token is null or p_token !~ '^[0-9a-fA-F]{64,200}$' then
    raise exception 'Jeton de notification invalide.' using errcode = 'P0001';
  end if;
  v_endpoint := 'apns:' || lower(p_token);
  insert into public.push_subscriptions (user_id, endpoint, platform, user_agent)
  values (v_uid, v_endpoint, 'ios', left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        platform = 'ios',
        user_agent = excluded.user_agent,
        failure_count = 0;
end;
$$;

revoke all on function public.register_native_push(text, text) from public, anon;
grant execute on function public.register_native_push(text, text) to authenticated;
