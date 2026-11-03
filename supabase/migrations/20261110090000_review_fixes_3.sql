-- Dogcare — fixes from the review of 2026-11-03
-- 1. Medication routines follow the circle's health access (like the Santé section).
-- 2. A routine occurrence is a whole minute and is checked once, even under a race.
-- 3. Answering a proposal locks the request (no "Oui" left on old dates).
-- 4. send_proposals: one line per person, slices stored as checked.
-- 5. Refusal notice to the owners names the person, not "vous".
-- 6. confirm_plan keeps a known place when a slice has none.
-- 7. The limit of 12 routines holds under concurrency.
-- 8. The day-before reminder lists routines from the start of the garde.
-- 9. Indexes on foreign keys used by deletions.
-- 10. Realtime on proposals, the care log and routines.

-- 1. ------------------------------------------------------------------------
drop policy "dog_routines: visible with the dog" on public.dog_routines;
create policy "dog_routines: visible with the dog, medication with health" on public.dog_routines
  for select to authenticated
  using (private.can_view_dog(dog_id) and (kind <> 'medication' or private.can_view_dog_section(dog_id, 'health')));

-- 2. ------------------------------------------------------------------------
alter table public.care_log_entries
  add constraint care_log_entries_routine_minute check (routine_at is null or routine_at = date_trunc('minute', routine_at));

create or replace function public.add_care_log(
  p_assignment_id uuid,
  p_kind text,
  p_occurred_at timestamptz default null,
  p_note text default null,
  p_photo_path text default null,
  p_routine_id uuid default null,
  p_routine_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_a public.care_assignments%rowtype;
  v_req public.care_requests%rowtype;
  v_reason text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_kind text := p_kind;
  v_routine public.dog_routines%rowtype;
  v_local timestamp;
  v_id uuid;
  v_dog text;
  v_name text;
  v_owner record;
  v_title text;
  v_body text;
begin
  select * into v_a from public.care_assignments where id = p_assignment_id;
  v_reason := private.care_log_closed_reason(v_a);
  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;
  select * into v_req from public.care_requests where id = v_a.request_id;

  -- a routine occurrence of this dog, during this garde, not checked yet
  if p_routine_id is not null or p_routine_at is not null then
    select * into v_routine from public.dog_routines where id = p_routine_id;
    if not found or v_routine.dog_id <> v_req.dog_id
       or not (select d.routines_enabled from public.dogs d where d.id = v_req.dog_id) then
      raise exception 'Routine introuvable.' using errcode = 'P0001';
    end if;
    v_local := p_routine_at at time zone 'Europe/Paris';
    if p_routine_at is null
       or p_routine_at <> date_trunc('minute', p_routine_at)
       or not (to_char(v_local, 'HH24:MI') = any (v_routine.times))
       or (v_routine.weekdays is not null and not (extract(isodow from v_local)::smallint = any (v_routine.weekdays)))
       or p_routine_at < v_a.starts_at or p_routine_at >= v_a.ends_at then
      raise exception 'Ce moment ne correspond pas à la routine pendant la garde.' using errcode = 'P0001';
    end if;
    if p_routine_at > now() + interval '3 hours' then
      raise exception 'Cette routine est encore à venir.' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.care_log_entries e
      where e.assignment_id = v_a.id and e.routine_id = p_routine_id and e.routine_at = p_routine_at
    ) then
      raise exception 'Déjà coché.' using errcode = 'P0001';
    end if;
    v_kind := case v_routine.kind when 'other' then 'note' else v_routine.kind end;
    v_note := coalesce(v_note, v_routine.label);
  end if;

  perform private.check_care_log_entry(v_a, v_kind, v_at, v_note);
  if v_kind = 'photo' and p_photo_path is null then
    raise exception 'Ajoutez une photo.' using errcode = 'P0001';
  end if;
  if p_photo_path is not null and (
    p_photo_path !~ ('^' || p_assignment_id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$')
    or not exists (select 1 from storage.objects o where o.bucket_id = 'care-logs' and o.name = p_photo_path)
    or exists (select 1 from public.care_log_entries e where e.photo_path = p_photo_path)
  ) then
    raise exception 'Photo introuvable. Réessayez.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.care_log_entries e where e.assignment_id = p_assignment_id) >= 200 then
    raise exception 'Le carnet de cette garde est complet.' using errcode = 'P0001';
  end if;

  begin
    insert into public.care_log_entries (assignment_id, request_id, dog_id, author_id, kind, occurred_at, note, photo_path, routine_id, routine_at)
    values (v_a.id, v_req.id, v_req.dog_id, v_uid, v_kind, v_at, v_note, p_photo_path, p_routine_id, p_routine_at)
    returning id into v_id;
  exception when unique_violation then
    -- the same occurrence checked twice at the same moment
    raise exception 'Déjà coché.' using errcode = 'P0001';
  end;

  -- key moments and photos reach the caretakers' phones
  if v_kind in ('drop_off', 'pick_up', 'photo') then
    v_dog := (select name from public.dogs where id = v_req.dog_id);
    v_name := coalesce(private.display_name(v_uid), 'Le gardien');
    v_title := case v_kind
      when 'drop_off' then v_name || ' a pris en charge ' || v_dog
      when 'pick_up' then v_dog || ' a été récupéré'
      else 'Nouvelle photo ' || private.de_name(v_dog)
    end;
    v_body := case v_kind
      when 'photo' then 'Par ' || v_name || coalesce(' : ' || v_note, '')
      else private.fmt_ts(v_at) || coalesce(' — ' || v_note, '')
    end;
    for v_owner in select user_id from public.dog_caretakers where dog_id = v_req.dog_id loop
      perform private.notify(v_owner.user_id, v_req.group_id, 'care_log', v_title, v_body, v_req.id, v_uid);
    end loop;
  end if;
  return v_id;
end;
$$;

-- 3 & 5. --------------------------------------------------------------------
create or replace function public.answer_proposal(p_proposal_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_prop public.care_proposals%rowtype;
  v_req public.care_requests%rowtype;
  v_owner record;
begin
  select * into v_prop from public.care_proposals where id = p_proposal_id and user_id = v_uid for update;
  if not found then
    raise exception 'Proposition introuvable.' using errcode = 'P0001';
  end if;
  if v_prop.status <> 'pending' then
    raise exception 'Cette proposition a déjà une réponse ou a été retirée.' using errcode = 'P0001';
  end if;
  -- the request cannot change dates while the answer is written (no silent "Oui" on old dates)
  perform 1 from public.care_requests where id = v_prop.request_id for share;
  if not private.can_respond(v_prop.request_id) then
    raise exception 'Cette demande n''attend plus de réponse.' using errcode = 'P0001';
  end if;
  select * into v_req from public.care_requests where id = v_prop.request_id;

  if p_accept then
    -- the whole span; confirm_plan then only confirms the proposed slices
    insert into public.request_responses (request_id, user_id, response_status, proposed_starts_at, proposed_ends_at)
    values (v_prop.request_id, v_uid, 'yes', v_prop.starts_at, v_prop.ends_at)
    on conflict (request_id, user_id) do update
      set response_status = 'yes', proposed_starts_at = excluded.proposed_starts_at,
          proposed_ends_at = excluded.proposed_ends_at, responded_at = now(), updated_at = now();
    update public.care_proposals set status = 'accepted', answered_at = now() where id = v_prop.id;
  else
    -- declining a part is not a "Non" to the whole request
    update public.care_proposals set status = 'declined', answered_at = now() where id = v_prop.id;
    for v_owner in select user_id from public.dog_caretakers where dog_id = v_req.dog_id loop
      perform private.notify(v_owner.user_id, v_req.group_id, 'care_proposal',
        private.display_name(v_uid) || ' ne peut pas garder ' || (select name from public.dogs where id = v_req.dog_id),
        private.fmt_period(v_prop.starts_at, v_prop.ends_at)
          || case v_prop.place when 'owner' then ' · chez le propriétaire' else ' · chez ' || coalesce(private.display_name(v_uid), 'cette personne') end,
        v_req.id, v_uid);
    end loop;
  end if;
end;
$$;

-- 4. ------------------------------------------------------------------------
create or replace function public.send_proposals(p_request_id uuid, p_proposals jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.care_requests%rowtype;
  v_dog text;
  v_prop jsonb;
  v_slice jsonb;
  v_user uuid;
  v_place text;
  v_slices jsonb;
  v_norm jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_end timestamptz;
  v_first timestamptz;
  v_last timestamptz;
  v_member boolean;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  select * into v_req from public.care_requests where id = p_request_id for update;
  if not found or not private.is_group_member(v_req.group_id) or not private.is_dog_caretaker(v_req.dog_id) then
    raise exception 'Seul un responsable du chien peut envoyer des propositions.' using errcode = 'P0001';
  end if;
  if v_req.lifecycle_status <> 'active' or v_req.ends_at <= now() or v_req.necessity = 'info' then
    raise exception 'Cette demande ne peut plus recevoir de propositions.' using errcode = 'P0001';
  end if;
  if p_proposals is null or jsonb_typeof(p_proposals) <> 'array' or jsonb_array_length(p_proposals) = 0 then
    raise exception 'Aucune proposition à envoyer.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_proposals) > 20 then
    raise exception 'Vous pouvez solliciter 20 personnes au plus.' using errcode = 'P0001';
  end if;
  if (select count(*) from jsonb_array_elements(p_proposals)) <> (select count(distinct e ->> 'user_id') from jsonb_array_elements(p_proposals) e) then
    raise exception 'Une même personne apparaît deux fois dans l''envoi.' using errcode = 'P0001';
  end if;
  v_dog := (select name from public.dogs where id = v_req.dog_id);

  for v_prop in select * from jsonb_array_elements(p_proposals) loop
    v_user := private.try_uuid(v_prop ->> 'user_id');
    v_place := coalesce(v_prop ->> 'place', 'helper');
    v_slices := v_prop -> 'slices';
    if v_user is null or v_place not in ('helper', 'owner')
       or v_slices is null or jsonb_typeof(v_slices) <> 'array'
       or jsonb_array_length(v_slices) not between 1 and 20 then
      raise exception 'Proposition invalide.' using errcode = 'P0001';
    end if;

    -- slices: inside the request, in order, never overlapping
    v_prev_end := null;
    v_first := null;
    v_norm := '[]'::jsonb;
    for v_slice in select * from jsonb_array_elements(v_slices) loop
      begin
        v_start := (v_slice ->> 'starts_at')::timestamptz;
        v_end := (v_slice ->> 'ends_at')::timestamptz;
      exception when others then
        raise exception 'Proposition invalide.' using errcode = 'P0001';
      end;
      if v_start is null or v_end is null or v_start >= v_end
         or v_start < v_req.starts_at or v_end > v_req.ends_at
         or (v_prev_end is not null and v_start < v_prev_end) then
        raise exception 'Un créneau proposé sort de la demande ou en chevauche un autre.' using errcode = 'P0001';
      end if;
      v_first := coalesce(v_first, v_start);
      v_prev_end := v_end;
      -- stored as checked: only the two instants, nothing else from the client
      v_norm := v_norm || jsonb_build_array(jsonb_build_object('starts_at', v_start, 'ends_at', v_end));
    end loop;
    v_last := v_prev_end;
    if not v_req.splittable and (jsonb_array_length(v_slices) > 1 or v_first <> v_req.starts_at or v_last <> v_req.ends_at) then
      raise exception 'Cette garde ne peut pas être partagée : proposez-la en entier.' using errcode = 'P0001';
    end if;

    -- who can be asked
    if exists (select 1 from public.dog_caretakers dc where dc.dog_id = v_req.dog_id and dc.user_id = v_user) then
      raise exception 'Un responsable du chien ne peut pas être sollicité.' using errcode = 'P0001';
    end if;
    if private.is_blocked_pair(v_uid, v_user) then
      raise exception 'Vous ne pouvez pas solliciter cette personne.' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.request_responses rr
      where rr.request_id = v_req.id and rr.user_id = v_user and rr.response_status = 'yes'
    ) then
      raise exception '% a déjà proposé son aide : son « Oui » est dans le planning.',
        coalesce(private.display_name(v_user), 'Cette personne') using errcode = 'P0001';
    end if;
    v_member := exists (select 1 from public.group_members gm where gm.group_id = v_req.group_id and gm.user_id = v_user);
    if not v_member
       and not private.circle_covers(v_req.dog_id, v_user, v_first, v_last) then
      raise exception '% ne fait pas partie du cercle du chien pour ces dates.',
        coalesce(private.display_name(v_user), 'Cette personne') using errcode = 'P0001';
    end if;

    -- proposal first: asking a circle person on the request then sends no second notice
    insert into public.care_proposals (request_id, user_id, slices, starts_at, ends_at, place, status, sent_by, sent_at, answered_at)
    values (v_req.id, v_user, v_norm, v_first, v_last, v_place, 'pending', v_uid, now(), null)
    on conflict (request_id, user_id) do update
      set slices = excluded.slices, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
          place = excluded.place, status = 'pending', sent_by = excluded.sent_by, sent_at = now(), answered_at = null;
    if not v_member and not private.is_request_invitee(v_req.id, v_user) then
      insert into public.care_request_invitees (request_id, user_id) values (v_req.id, v_user);
    end if;

    -- the proposal replaces the generic notice of the request, if not seen yet
    delete from public.notifications n
    where n.user_id = v_user and n.request_id = v_req.id and n.notification_type = 'new_request'
      and n.read_at is null and n.push_state in ('pending', 'skipped');
    perform private.notify(v_user, v_req.group_id, 'care_proposal',
      'Pouvez-vous garder ' || v_dog || ' ?',
      private.proposal_text(v_norm, v_first, v_last, v_place), v_req.id, v_uid);
    v_count := v_count + 1;
  end loop;

  perform private.audit('proposals_sent', v_req.group_id, v_req.id, jsonb_build_object('count', v_count));
  return v_count;
end;
$$;

-- 6. ------------------------------------------------------------------------
create or replace function public.confirm_plan(p_request_id uuid, p_slices jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slice jsonb;
  v_id uuid;
  v_count integer := 0;
begin
  if p_slices is null or jsonb_typeof(p_slices) <> 'array' or jsonb_array_length(p_slices) = 0 then
    raise exception 'Le planning est vide.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_slices) > 50 then
    raise exception 'Ce planning a trop de tranches.' using errcode = 'P0001';
  end if;
  for v_slice in select * from jsonb_array_elements(p_slices) loop
    if jsonb_typeof(v_slice) <> 'object'
       or private.try_uuid(v_slice ->> 'user_id') is null
       or (v_slice ->> 'starts_at') is null or (v_slice ->> 'ends_at') is null
       or coalesce(v_slice ->> 'place', 'helper') not in ('helper', 'owner') then
      raise exception 'Tranche de planning invalide.' using errcode = 'P0001';
    end if;
    -- any failure (changed answer, overlap…) cancels the whole plan
    v_id := public.confirm_assignment(
      p_request_id,
      private.try_uuid(v_slice ->> 'user_id'),
      (v_slice ->> 'starts_at')::timestamptz,
      (v_slice ->> 'ends_at')::timestamptz
    );
    update public.care_assignments set place = coalesce(v_slice ->> 'place', place) where id = v_id;
    v_count := v_count + 1;
  end loop;
  perform private.audit('plan_confirmed', (select group_id from public.care_requests where id = p_request_id), p_request_id,
    jsonb_build_object('slices', v_count));
  return v_count;
end;
$$;

-- 7. ------------------------------------------------------------------------
create or replace function public.set_dog_routine(
  p_dog_id uuid,
  p_id uuid,
  p_kind text,
  p_label text,
  p_times text[],
  p_weekdays smallint[],
  p_instructions text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_times text[];
  v_days smallint[];
  v_id uuid;
begin
  if not private.is_dog_caretaker(p_dog_id) then
    raise exception 'Seul un responsable du chien peut modifier ses routines.' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('meal', 'walk', 'medication', 'other') then
    raise exception 'Type de routine invalide.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_label, ''))) = 0 or char_length(btrim(p_label)) > 60 then
    raise exception 'Donnez un nom à la routine (60 caractères au plus).' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_instructions, '')) > 140 then
    raise exception 'Consigne : 140 caractères au plus.' using errcode = 'P0001';
  end if;
  v_times := array(select distinct t from unnest(coalesce(p_times, '{}'::text[])) t order by 1);
  if cardinality(v_times) not between 1 and 6
     or exists (select 1 from unnest(v_times) t where t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'Indiquez de 1 à 6 heures (HH:MM).' using errcode = 'P0001';
  end if;
  v_days := case
    when p_weekdays is null or cardinality(p_weekdays) = 0 or cardinality(p_weekdays) >= 7 then null
    else array(select distinct d from unnest(p_weekdays) d order by 1)
  end;
  if v_days is not null and exists (select 1 from unnest(v_days) d where d not between 1 and 7) then
    raise exception 'Jours invalides.' using errcode = 'P0001';
  end if;

  if p_id is null then
    -- one writer at a time per dog: the limit holds under concurrency
    perform 1 from public.dogs where id = p_dog_id for update;
    if (select count(*) from public.dog_routines where dog_id = p_dog_id) >= 12 then
      raise exception '12 routines au plus par chien.' using errcode = 'P0001';
    end if;
    insert into public.dog_routines (dog_id, kind, label, times, weekdays, instructions, created_by)
    values (p_dog_id, p_kind, btrim(p_label), v_times, v_days, nullif(btrim(coalesce(p_instructions, '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.dog_routines
    set kind = p_kind, label = btrim(p_label), times = v_times, weekdays = v_days,
        instructions = nullif(btrim(coalesce(p_instructions, '')), ''), updated_at = now()
    where id = p_id and dog_id = p_dog_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Routine introuvable.' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end;
$$;

-- 8. ------------------------------------------------------------------------
drop function private.routines_text(uuid, date);

-- "repas 08:00 et 19:00, médicament 20:00" from p_from on, or null (off, none)
create function private.routines_text(p_dog_id uuid, p_day date, p_from time default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(lower(r.label) || ' ' || array_to_string(r.times, ' et '), ', ' order by r.times[1], r.label)
  from (
    select r.label, array(select t from unnest(r.times) t where p_from is null or t::time >= p_from order by t) as times
    from public.dog_routines r
    join public.dogs d on d.id = r.dog_id
    where r.dog_id = p_dog_id and d.routines_enabled
      and (r.weekdays is null or extract(isodow from p_day)::smallint = any (r.weekdays))
  ) r
  where cardinality(r.times) > 0;
$$;

revoke all on function private.routines_text(uuid, date, time) from public, anon, authenticated;

create or replace function public.run_daily_reminders(p_now timestamptz default now())
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
  -- confirmed gardes starting tomorrow: the helper (with tomorrow's routines) and the caretakers
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
          ), '')
          || coalesce(' · routines : ' || private.routines_text(v_r.dog_id, v_tomorrow, (v_r.starts_at at time zone 'Europe/Paris')::time), ''),
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

-- 9. ------------------------------------------------------------------------
create index care_log_entries_routine_idx on public.care_log_entries (routine_id) where routine_id is not null;
create index care_proposals_sent_by_idx on public.care_proposals (sent_by);
create index dog_routines_created_by_idx on public.dog_routines (created_by);

-- 10. -----------------------------------------------------------------------
-- Realtime: proposals, the care log and routines also refresh open screens
-- (the client cache keeps a tab for 30 s); RLS still filters every row.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.care_proposals,
      public.care_log_entries,
      public.dog_routines;
  end if;
end;
$$;
