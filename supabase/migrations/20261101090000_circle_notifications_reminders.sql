-- Dogcare — circle notifications and day-before reminders
-- Circle ("circle_update", can be switched off for push):
-- - someone accepts an invitation or leaves the circle → the caretakers;
-- - a caretaker adds someone, changes their role or access, or removes them
--   → the person;
-- - a guest's access ends tomorrow → the guest (daily job).
-- Reminders ("care_reminder", preference "reminders_enabled"), daily around
-- 18:00 Paris time, run by the server with the secret key:
-- - each confirmed garde starting tomorrow → its helper and the caretakers;
-- - a required need starting tomorrow that is not fully covered → the caretakers.
-- A reminder is sent once (reminder_log), even if the job runs twice.

alter type public.notification_type add value if not exists 'circle_update';
alter type public.notification_type add value if not exists 'care_reminder';

alter table public.notification_preferences
  add column circle_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- Preferences for the new types
-- ---------------------------------------------------------------------------
create or replace function private.notify(
  p_user_id uuid,
  p_group_id uuid,
  p_type public.notification_type,
  p_title text,
  p_body text,
  p_request_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_group uuid := p_group_id;
begin
  if p_user_id is null or p_user_id is not distinct from p_actor_id then
    return;
  end if;
  if private.is_blocked_pair(p_user_id, p_actor_id) then
    return;
  end if;
  if v_group is not null and not exists (
    select 1 from public.group_members gm where gm.group_id = v_group and gm.user_id = p_user_id
  ) then
    v_group := null;
  end if;

  select case p_type::text
           when 'new_request' then np.new_requests_enabled
           when 'response_reset' then np.new_requests_enabled
           when 'new_volunteer' then np.responses_enabled
           when 'assignment_confirmed' then np.confirmations_enabled
           when 'reconfirmation_needed' then np.confirmations_enabled
           when 'request_updated' then np.confirmations_enabled
           when 'assignment_cancelled' then np.cancellations_enabled
           when 'request_cancelled' then np.cancellations_enabled
           when 'care_log' then np.care_log_enabled
           when 'circle_update' then np.circle_enabled
           when 'care_reminder' then np.reminders_enabled
           else true
         end
    into v_enabled
  from public.notification_preferences np
  where np.user_id = p_user_id;

  insert into public.notifications (user_id, group_id, notification_type, title, body, request_id, actor_id, push_state)
  values (p_user_id, v_group, p_type, p_title, p_body, p_request_id, p_actor_id,
          case when v_enabled is false then 'skipped' else 'pending' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Circle notifications
-- ---------------------------------------------------------------------------
-- "d'Aston", "de Moka" (same rule as deName in src/lib/format.ts)
create function private.de_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when btrim(coalesce(p_name, '')) ~* '^[aeiouyhàâäéèêëîïôöùûü]' then 'd''' || p_name else 'de ' || p_name end;
$$;

-- "Proche · santé : toujours · urgences : pendant vos gardes · jusqu'au 16/11"
create function private.circle_access_text(
  p_role text, p_health text, p_emergency text, p_ends timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select case p_role when 'close' then 'Proche' when 'guest' then 'Invité' else 'Entourage' end
    || ' · santé : ' || case p_health when 'always' then 'toujours' when 'during_care' then 'pendant vos gardes' else 'non' end
    || ' · urgences : ' || case p_emergency when 'always' then 'toujours' when 'during_care' then 'pendant vos gardes' else 'non' end
    || coalesce(' · jusqu''au ' || to_char((p_ends - interval '1 second') at time zone 'Europe/Paris', 'DD/MM'), '');
$$;

create function private.dog_circle_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.dog_circle := case when tg_op = 'DELETE' then old else new end;
  v_actor uuid := auth.uid();
  v_dog text;
  v_name text;
  v_owner record;
begin
  -- account or dog deletion: nothing to tell
  if not exists (select 1 from auth.users where id = v_row.user_id)
     or not exists (select 1 from public.dogs where id = v_row.dog_id) then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.role, new.health_access, new.emergency_access, new.starts_at, new.ends_at)
         is not distinct from (old.role, old.health_access, old.emergency_access, old.starts_at, old.ends_at) then
    return null;
  end if;
  v_dog := (select name from public.dogs where id = v_row.dog_id);
  v_name := coalesce(private.display_name(v_row.user_id), 'Quelqu''un');

  if v_actor is not distinct from v_row.user_id then
    -- the person acted: accepted an invitation, or left
    for v_owner in select user_id from public.dog_caretakers where dog_id = v_row.dog_id loop
      perform private.notify(v_owner.user_id, null, 'circle_update',
        case when tg_op = 'DELETE' then v_name || ' a quitté le cercle ' || private.de_name(v_dog)
             else v_name || ' a rejoint le cercle ' || private.de_name(v_dog) end,
        case when tg_op = 'DELETE' then 'Ses gardes à venir pour ' || v_dog || ' sont annulées s''il en avait.'
             else private.circle_access_text(new.role, new.health_access, new.emergency_access, new.ends_at) end,
        null, v_actor);
    end loop;
  elsif tg_op = 'DELETE' then
    if exists (
      select 1 from public.group_dogs gd join public.group_members gm on gm.group_id = gd.group_id
      where gd.dog_id = old.dog_id and gm.user_id = old.user_id
    ) then
      perform private.notify(old.user_id, null, 'circle_update',
        'Vos accès à ' || v_dog || ' ont changé',
        private.circle_access_text('entourage', 'during_care', 'during_care', null), null, v_actor);
    else
      perform private.notify(old.user_id, null, 'circle_update',
        'Votre accès au passeport ' || private.de_name(v_dog) || ' est terminé',
        'Un responsable vous a retiré de son cercle.', null, v_actor);
    end if;
  else
    perform private.notify(v_row.user_id, null, 'circle_update',
      coalesce(private.display_name(v_actor), 'Un responsable')
        || case when tg_op = 'INSERT' then ' vous a ajouté au cercle ' || private.de_name(v_dog) else ' a modifié vos accès à ' || v_dog end,
      private.circle_access_text(new.role, new.health_access, new.emergency_access, new.ends_at),
      null, v_actor);
  end if;
  return null;
end;
$$;

create trigger dog_circle_notify after insert or update or delete on public.dog_circle
  for each row execute function private.dog_circle_notify();

-- ---------------------------------------------------------------------------
-- Daily reminders (server, secret key)
-- ---------------------------------------------------------------------------
create table public.reminder_log (
  kind text not null,
  ref_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  for_date date not null,
  created_at timestamptz not null default now(),
  primary key (kind, ref_id, user_id, for_date)
);

create index reminder_log_user_idx on public.reminder_log (user_id);

alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;
-- no policy: written and read by run_daily_reminders only

-- true the first time (kind, ref, user, day) is seen
create function private.reminder_first(p_kind text, p_ref uuid, p_user uuid, p_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.reminder_log (kind, ref_id, user_id, for_date)
  values (p_kind, p_ref, p_user, p_date)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- Sends tomorrow's reminders (Paris days); returns how many notifications were created.
create function public.run_daily_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tomorrow date := (p_now at time zone 'Europe/Paris')::date + 1;
  v_from timestamptz := v_tomorrow::timestamp at time zone 'Europe/Paris';
  v_to timestamptz := (v_tomorrow + 1)::timestamp at time zone 'Europe/Paris';
  v_count integer := 0;
  v_r record;
  v_owner record;
begin
  -- confirmed gardes starting tomorrow: the helper and the caretakers
  for v_r in
    select a.id, a.assigned_user_id, a.starts_at, a.ends_at, r.id as request_id, r.group_id, r.dog_id, d.name as dog
    from public.care_assignments a
    join public.care_requests r on r.id = a.request_id
    join public.dogs d on d.id = r.dog_id
    where a.status = 'confirmed' and r.lifecycle_status = 'active'
      and a.starts_at >= v_from and a.starts_at < v_to
  loop
    if private.reminder_first('garde_helper', v_r.id, v_r.assigned_user_id, v_tomorrow) then
      perform private.notify(v_r.assigned_user_id, v_r.group_id, 'care_reminder',
        'Demain : garde ' || private.de_name(v_r.dog),
        private.fmt_period(v_r.starts_at, v_r.ends_at)
          || coalesce(' · pour ' || (
            select string_agg(private.display_name(dc.user_id), ', ') from public.dog_caretakers dc where dc.dog_id = v_r.dog_id
          ), ''),
        v_r.request_id, null);
      v_count := v_count + 1;
    end if;
    for v_owner in select user_id from public.dog_caretakers where dog_id = v_r.dog_id loop
      if v_owner.user_id <> v_r.assigned_user_id
         and private.reminder_first('garde_owner', v_r.id, v_owner.user_id, v_tomorrow) then
        perform private.notify(v_owner.user_id, v_r.group_id, 'care_reminder',
          'Demain : ' || coalesce(private.display_name(v_r.assigned_user_id), 'quelqu''un') || ' garde ' || v_r.dog,
          private.fmt_period(v_r.starts_at, v_r.ends_at), v_r.request_id, null);
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;

  -- required needs starting tomorrow, not fully covered: the caretakers
  for v_r in
    select r.id, r.group_id, r.dog_id, r.starts_at, r.ends_at, d.name as dog,
      coalesce((
        select sum(extract(epoch from least(a.ends_at, r.ends_at) - greatest(a.starts_at, r.starts_at)))
        from public.care_assignments a
        where a.request_id = r.id and a.status = 'confirmed' and a.ends_at > r.starts_at and a.starts_at < r.ends_at
      ), 0) as covered_s
    from public.care_requests r
    join public.dogs d on d.id = r.dog_id
    where r.lifecycle_status = 'active' and r.necessity = 'required'
      and r.starts_at >= v_from and r.starts_at < v_to
  loop
    -- confirmed assignments of a request never overlap: the sum is the covered time
    continue when v_r.covered_s >= extract(epoch from v_r.ends_at - v_r.starts_at);
    for v_owner in select user_id from public.dog_caretakers where dog_id = v_r.dog_id loop
      if private.reminder_first('uncovered', v_r.id, v_owner.user_id, v_tomorrow) then
        perform private.notify(v_owner.user_id, v_r.group_id, 'care_reminder',
          'Demain : ' || v_r.dog || case when v_r.covered_s > 0 then ' n''est que partiellement couvert' else ' n''est pas encore couvert' end,
          private.fmt_period(v_r.starts_at, v_r.ends_at) || ' · relancez le groupe ou votre cercle.',
          v_r.id, null);
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;

  -- guests whose access ends tomorrow evening
  for v_r in
    select c.dog_id, c.user_id, c.ends_at, d.name as dog
    from public.dog_circle c
    join public.dogs d on d.id = c.dog_id
    where c.role = 'guest' and d.archived_at is null
      and c.ends_at > v_from and c.ends_at <= v_to
  loop
    if private.reminder_first('guest_end', v_r.dog_id, v_r.user_id, v_tomorrow) then
      perform private.notify(v_r.user_id, null, 'circle_update',
        'Votre accès à ' || v_r.dog || ' se termine demain soir',
        'Après demain, vous ne verrez plus son passeport. Demandez à ses responsables de prolonger si besoin.',
        null, null);
      v_count := v_count + 1;
    end if;
  end loop;

  delete from public.reminder_log where for_date < v_tomorrow - 30;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function private.circle_access_text(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function private.de_name(text) from public, anon, authenticated;
revoke all on function private.dog_circle_notify() from public, anon, authenticated;
revoke all on function private.reminder_first(text, uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.run_daily_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.run_daily_reminders(timestamptz) to service_role;
