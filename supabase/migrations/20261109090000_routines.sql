-- Dogcare — routines (off by default)
-- A dog's caretakers can turn routines on and list them: meals, walks,
-- medication or anything else, at set times, every day or some days. During a
-- garde the helper checks each occurrence off in the care log (once); the
-- owner sees what was done. The reminder of the day before lists tomorrow's
-- routines. No push at the time of a routine.

alter table public.dogs add column routines_enabled boolean not null default false;
grant update (routines_enabled) on public.dogs to authenticated;

create table public.dog_routines (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references public.dogs (id) on delete cascade,
  kind text not null check (kind in ('meal', 'walk', 'medication', 'other')),
  label text not null check (char_length(label) between 1 and 60),
  -- local times in Paris, "HH:MM", sorted, distinct
  times text[] not null check (cardinality(times) between 1 and 6),
  -- ISO weekdays (1 = Monday); null = every day
  weekdays smallint[] check (weekdays is null or (cardinality(weekdays) between 1 and 7 and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])),
  instructions text check (char_length(instructions) <= 140),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index dog_routines_dog_idx on public.dog_routines (dog_id);

alter table public.dog_routines enable row level security;

-- whoever sees the dog sees its routines (like its habits); writes through the functions below
create policy "dog_routines: visible with the dog" on public.dog_routines
  for select to authenticated using (private.can_view_dog(dog_id));

revoke insert, update, delete on public.dog_routines from authenticated, anon;
grant select on public.dog_routines to authenticated;

-- an entry of the care log may check off one occurrence of a routine
alter table public.care_log_entries
  add column routine_id uuid references public.dog_routines (id) on delete set null,
  add column routine_at timestamptz,
  add constraint care_log_entries_routine_pair check ((routine_id is null) = (routine_at is null) or routine_id is null);

create unique index care_log_entries_routine_once on public.care_log_entries (assignment_id, routine_id, routine_at)
  where routine_id is not null;

-- ---------------------------------------------------------------------------
-- Writing routines (caretakers)
-- ---------------------------------------------------------------------------
create function public.set_dog_routine(
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

create function public.delete_dog_routine(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dog uuid;
begin
  select dog_id into v_dog from public.dog_routines where id = p_id;
  if v_dog is null or not private.is_dog_caretaker(v_dog) then
    raise exception 'Routine introuvable.' using errcode = 'P0001';
  end if;
  -- entries already in the care log stay (routine_id set to null)
  delete from public.dog_routines where id = p_id;
end;
$$;

revoke all on function public.set_dog_routine(uuid, uuid, text, text, text[], smallint[], text) from public, anon;
revoke all on function public.delete_dog_routine(uuid) from public, anon;
grant execute on function public.set_dog_routine(uuid, uuid, text, text, text[], smallint[], text) to authenticated;
grant execute on function public.delete_dog_routine(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Checking an occurrence off: add_care_log gains the routine
-- ---------------------------------------------------------------------------
drop function public.add_care_log(uuid, text, timestamptz, text, text);

create function public.add_care_log(
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

  insert into public.care_log_entries (assignment_id, request_id, dog_id, author_id, kind, occurred_at, note, photo_path, routine_id, routine_at)
  values (v_a.id, v_req.id, v_req.dog_id, v_uid, v_kind, v_at, v_note, p_photo_path, p_routine_id, p_routine_at)
  returning id into v_id;

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

revoke all on function public.add_care_log(uuid, text, timestamptz, text, text, uuid, timestamptz) from public, anon;
grant execute on function public.add_care_log(uuid, text, timestamptz, text, text, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Tomorrow's routines in the reminder of the day before
-- ---------------------------------------------------------------------------
-- "repas 08:00 et 19:00, médicament 20:00", or null (off, none that day)
create function private.routines_text(p_dog_id uuid, p_day date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(lower(r.label) || ' ' || array_to_string(r.times, ' et '), ', ' order by r.times[1], r.label)
  from public.dog_routines r
  join public.dogs d on d.id = r.dog_id
  where r.dog_id = p_dog_id and d.routines_enabled
    and (r.weekdays is null or extract(isodow from p_day)::smallint = any (r.weekdays));
$$;

revoke all on function private.routines_text(uuid, date) from public, anon, authenticated;

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
          || coalesce(' · routines : ' || private.routines_text(v_r.dog_id, v_tomorrow), ''),
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
