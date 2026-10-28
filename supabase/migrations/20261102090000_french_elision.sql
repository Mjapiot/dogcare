-- Dogcare — French elision in database messages: "d'Aston", "de Moka"
-- Same bodies as the latest definitions of these functions; only the texts
-- with a dog's name after "de" now go through private.de_name.

-- private.care_requests_after_update (from 20261021100000_review_fixes_rules.sql)
create or replace function private.care_requests_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_dog text := (select name from public.dogs where id = new.dog_id);
  v_a record;
  v_r record;
  v_start timestamptz;
  v_end timestamptz;
  v_period_changed boolean := new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at;
  v_type_changed boolean := new.request_type is distinct from old.request_type;
begin
  if new.lifecycle_status = 'cancelled' and old.lifecycle_status = 'active' then
    for v_a in
      select * from public.care_assignments where request_id = new.id and status <> 'cancelled'
    loop
      update public.care_assignments
        set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor,
            cancellation_reason = 'Demande annulée par le propriétaire'
        where id = v_a.id;
      perform private.notify(v_a.assigned_user_id, new.group_id, 'request_cancelled',
        'Garde annulée : ' || v_dog, private.fmt_period(v_a.starts_at, v_a.ends_at), new.id, v_actor);
    end loop;
    for v_r in
      select rr.user_id from public.request_responses rr
      where rr.request_id = new.id and rr.response_status = 'yes'
        and not exists (select 1 from public.care_assignments ca where ca.request_id = new.id and ca.assigned_user_id = rr.user_id)
    loop
      perform private.notify(v_r.user_id, new.group_id, 'request_cancelled',
        'Demande annulée : ' || v_dog, private.fmt_period(old.starts_at, old.ends_at), new.id, v_actor);
    end loop;
    perform private.audit('request_cancelled', new.group_id, new.id);
    return null;
  end if;

  if v_period_changed or v_type_changed then
    for v_a in
      select * from public.care_assignments where request_id = new.id and status <> 'cancelled'
    loop
      v_start := greatest(v_a.starts_at, new.starts_at);
      v_end := least(v_a.ends_at, new.ends_at);
      if v_start >= v_end then
        update public.care_assignments
          set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor,
              cancellation_reason = 'La demande a été déplacée hors de votre créneau'
          where id = v_a.id;
        perform private.notify(v_a.assigned_user_id, new.group_id, 'assignment_cancelled',
          'Votre garde ' || private.de_name(v_dog) || ' a été déplacée',
          'Ancien créneau : ' || private.fmt_period(v_a.starts_at, v_a.ends_at)
            || '. Nouvelle demande : ' || private.fmt_period(new.starts_at, new.ends_at) || '.',
          new.id, v_actor);
      elsif v_type_changed or v_start <> v_a.starts_at or v_end <> v_a.ends_at then
        update public.care_assignments
          set status = 'pending_reconfirmation',
              previous_starts_at = coalesce(v_a.previous_starts_at, v_a.starts_at),
              previous_ends_at = coalesce(v_a.previous_ends_at, v_a.ends_at),
              starts_at = v_start, ends_at = v_end
          where id = v_a.id;
        perform private.notify(v_a.assigned_user_id, new.group_id, 'reconfirmation_needed',
          'Merci de reconfirmer la garde ' || private.de_name(v_dog),
          'Avant : ' || private.fmt_period(v_a.starts_at, v_a.ends_at)
            || '. Désormais : ' || private.fmt_period(v_start, v_end) || '.',
          new.id, v_actor);
      else
        perform private.notify(v_a.assigned_user_id, new.group_id, 'request_updated',
          'La demande pour ' || v_dog || ' a changé',
          'Votre créneau ne change pas : ' || private.fmt_period(v_a.starts_at, v_a.ends_at) || '.',
          new.id, v_actor);
      end if;
    end loop;

    if v_period_changed then
      -- assignees keep their answer, clamped to the new period
      update public.request_responses rr
        set proposed_starts_at = greatest(rr.proposed_starts_at, new.starts_at),
            proposed_ends_at = least(rr.proposed_ends_at, new.ends_at)
        where rr.request_id = new.id and rr.proposed_starts_at is not null
          and exists (
            select 1 from public.care_assignments ca
            where ca.request_id = new.id and ca.assigned_user_id = rr.user_id and ca.status <> 'cancelled'
          );
      -- everybody else is asked again
      for v_r in
        delete from public.request_responses rr
        where rr.request_id = new.id
          and not exists (
            select 1 from public.care_assignments ca
            where ca.request_id = new.id and ca.assigned_user_id = rr.user_id and ca.status <> 'cancelled'
          )
        returning rr.user_id
      loop
        perform private.notify(v_r.user_id, new.group_id, 'response_reset',
          'Les horaires pour ' || v_dog || ' ont changé',
          'Nouvelle période : ' || private.fmt_period(new.starts_at, new.ends_at) || '. Merci de répondre à nouveau.',
          new.id, v_actor);
      end loop;
    end if;
    perform private.audit('request_updated', new.group_id, new.id, jsonb_build_object(
      'old_starts_at', old.starts_at, 'old_ends_at', old.ends_at,
      'new_starts_at', new.starts_at, 'new_ends_at', new.ends_at,
      'old_type', old.request_type, 'new_type', new.request_type));
  elsif new.description is distinct from old.description or new.necessity is distinct from old.necessity then
    for v_a in
      select * from public.care_assignments where request_id = new.id and status <> 'cancelled'
    loop
      perform private.notify(v_a.assigned_user_id, new.group_id, 'request_updated',
        'La demande pour ' || v_dog || ' a été précisée', new.description, new.id, v_actor);
    end loop;
  end if;

  -- no longer splittable: partial offers no longer fit
  if old.splittable and not new.splittable then
    for v_r in
      delete from public.request_responses rr
      where rr.request_id = new.id and rr.proposed_starts_at is not null
        and not exists (
          select 1 from public.care_assignments ca
          where ca.request_id = new.id and ca.assigned_user_id = rr.user_id and ca.status <> 'cancelled'
        )
      returning rr.user_id
    loop
      perform private.notify(v_r.user_id, new.group_id, 'response_reset',
        'La garde ' || private.de_name(v_dog) || ' doit être assurée en entier',
        'Votre proposition partielle ne convient plus : ' || private.fmt_period(new.starts_at, new.ends_at)
          || '. Merci de répondre à nouveau.',
        new.id, v_actor);
    end loop;
  end if;

  -- an information that becomes a real need is announced like a new request
  if old.necessity = 'info' and new.necessity <> 'info' then
    perform private.announce_request(new.id);
  end if;
  return null;
end;
$$;

-- public.cancel_assignment (from 20261021100000_review_fixes_rules.sql)
create or replace function public.cancel_assignment(p_assignment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_a public.care_assignments%rowtype;
  v_req public.care_requests%rowtype;
  v_is_caretaker boolean;
  v_owner record;
  v_dog text;
begin
  select * into v_a from public.care_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'Garde introuvable.' using errcode = 'P0001';
  end if;
  select * into v_req from public.care_requests where id = v_a.request_id;
  v_is_caretaker := private.is_dog_caretaker(v_req.dog_id);
  if v_uid is null or (v_a.assigned_user_id <> v_uid and not v_is_caretaker) then
    raise exception 'Vous ne pouvez pas annuler cette garde.' using errcode = 'P0001';
  end if;
  if v_a.status = 'cancelled' then
    raise exception 'Cette garde est déjà annulée.' using errcode = 'P0001';
  end if;

  update public.care_assignments
    set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
        cancellation_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
    where id = p_assignment_id;

  v_dog := (select name from public.dogs where id = v_req.dog_id);
  if v_a.assigned_user_id = v_uid then
    perform private.withdraw_offer_if_no_slot_left(v_a.request_id, v_uid);
    for v_owner in select user_id from public.dog_caretakers where dog_id = v_req.dog_id loop
      perform private.notify(v_owner.user_id, v_req.group_id, 'assignment_cancelled',
        private.display_name(v_uid) || ' ne peut plus garder ' || v_dog,
        private.fmt_period(v_a.starts_at, v_a.ends_at)
          || coalesce(' — ' || nullif(btrim(coalesce(p_reason, '')), ''), ''),
        v_req.id, v_uid);
    end loop;
  else
    perform private.notify(v_a.assigned_user_id, v_req.group_id, 'assignment_cancelled',
      'Votre garde ' || private.de_name(v_dog) || ' est annulée',
      private.fmt_period(v_a.starts_at, v_a.ends_at)
        || coalesce(' — ' || nullif(btrim(coalesce(p_reason, '')), ''), ''),
      v_req.id, v_uid);
  end if;
  perform private.audit('assignment_cancelled', v_req.group_id, p_assignment_id,
    jsonb_build_object('by_helper', v_a.assigned_user_id = v_uid));
end;
$$;

-- private.prune_request_invitee (from 20261030090000_request_invitees.sql)
create or replace function private.prune_request_invitee(p_request_id uuid, p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.care_requests%rowtype;
  v_dog text;
  v_name text := coalesce(private.display_name(p_user_id), 'Un invité');
  v_a record;
  v_owner record;
begin
  select * into v_req from public.care_requests where id = p_request_id;
  if not found or v_req.lifecycle_status <> 'active' or v_req.ends_at <= now() then
    return;
  end if;
  v_dog := (select name from public.dogs where id = v_req.dog_id);

  for v_a in
    select * from public.care_assignments a
    where a.request_id = p_request_id and a.assigned_user_id = p_user_id
      and a.status <> 'cancelled' and a.ends_at > now()
      and not private.circle_covers(v_req.dog_id, p_user_id, a.starts_at, a.ends_at)
    for update
  loop
    update public.care_assignments
      set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
          cancellation_reason = left(p_reason, 500)
      where id = v_a.id;
    perform private.notify(p_user_id, v_req.group_id, 'assignment_cancelled',
      'Votre garde ' || private.de_name(v_dog) || ' est annulée',
      private.fmt_period(v_a.starts_at, v_a.ends_at) || ' — ' || p_reason || '.',
      v_req.id, auth.uid());
    for v_owner in select user_id from public.dog_caretakers where dog_id = v_req.dog_id loop
      perform private.notify(v_owner.user_id, v_req.group_id, 'assignment_cancelled',
        v_name || ' ne peut plus garder ' || v_dog,
        private.fmt_period(v_a.starts_at, v_a.ends_at) || ' — ' || p_reason || '. Le créneau est à réorganiser.',
        v_req.id, auth.uid());
    end loop;
  end loop;

  if not exists (
    select 1 from public.care_assignments a
    where a.request_id = p_request_id and a.assigned_user_id = p_user_id and a.status <> 'cancelled'
  ) and not private.circle_covers(v_req.dog_id, p_user_id, v_req.starts_at, v_req.ends_at) then
    delete from public.request_responses where request_id = p_request_id and user_id = p_user_id;
    delete from public.care_request_invitees where request_id = p_request_id and user_id = p_user_id;
  end if;
end;
$$;

-- public.add_care_log (from 20261031090000_care_log.sql)
create or replace function public.add_care_log(
  p_assignment_id uuid,
  p_kind text,
  p_occurred_at timestamptz default null,
  p_note text default null,
  p_photo_path text default null
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
  perform private.check_care_log_entry(v_a, p_kind, v_at, v_note);
  if p_kind = 'photo' and p_photo_path is null then
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

  select * into v_req from public.care_requests where id = v_a.request_id;
  insert into public.care_log_entries (assignment_id, request_id, dog_id, author_id, kind, occurred_at, note, photo_path)
  values (v_a.id, v_req.id, v_req.dog_id, v_uid, p_kind, v_at, v_note, p_photo_path)
  returning id into v_id;

  -- key moments and photos reach the caretakers' phones
  if p_kind in ('drop_off', 'pick_up', 'photo') then
    v_dog := (select name from public.dogs where id = v_req.dog_id);
    v_name := coalesce(private.display_name(v_uid), 'Le gardien');
    v_title := case p_kind
      when 'drop_off' then v_name || ' a pris en charge ' || v_dog
      when 'pick_up' then v_dog || ' a été récupéré'
      else 'Nouvelle photo ' || private.de_name(v_dog)
    end;
    v_body := case p_kind
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

-- public.report_content (from 20261031090000_care_log.sql)
create or replace function public.report_content(p_group_id uuid, p_target_type text, p_target_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_what text;
  v_request uuid;
  v_admin record;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  if not private.is_group_member(p_group_id)
     and not (p_target_type = 'request' and private.is_request_invitee(p_target_id, v_uid)) then
    raise exception 'Vous ne faites pas partie de ce groupe.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.content_reports c
      where c.reporter_id = v_uid and c.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Trop de signalements. Réessayez plus tard.' using errcode = 'P0001';
  end if;

  case p_target_type
    when 'request' then
      select 'une demande pour ' || d.name, r.id into v_what, v_request
      from public.care_requests r join public.dogs d on d.id = r.dog_id
      where r.id = p_target_id and r.group_id = p_group_id;
    when 'dog' then
      select 'la fiche ' || private.de_name(d.name) into v_what
      from public.group_dogs gd join public.dogs d on d.id = gd.dog_id
      where gd.dog_id = p_target_id and gd.group_id = p_group_id;
    when 'member' then
      select private.display_name(m.user_id) into v_what
      from public.group_members m
      where m.user_id = p_target_id and m.group_id = p_group_id and m.user_id <> v_uid;
    when 'care_log' then
      select 'une entrée du carnet de garde ' || private.de_name(d.name), e.request_id into v_what, v_request
      from public.care_log_entries e
      join public.care_requests r on r.id = e.request_id
      join public.dogs d on d.id = e.dog_id
      where e.id = p_target_id and r.group_id = p_group_id
        and e.author_id <> v_uid and private.is_dog_caretaker(e.dog_id);
    else
      v_what := null;
  end case;
  if v_what is null then
    raise exception 'Élément introuvable dans ce groupe.' using errcode = 'P0001';
  end if;

  insert into public.content_reports (reporter_id, group_id, target_type, target_id, reason)
  values (v_uid, p_group_id, p_target_type, p_target_id, nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_id;
  perform private.audit('content_reported', p_group_id, null);

  -- the group's admins are told what was reported, not by whom
  for v_admin in
    select m.user_id from public.group_members m
    where m.group_id = p_group_id and m.role = 'admin' and m.user_id <> v_uid
  loop
    perform private.notify(v_admin.user_id, p_group_id, 'content_reported',
      'Signalement : ' || v_what,
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Un membre a signalé ce contenu.'),
      v_request,
      null);
  end loop;
  return v_id;
end;
$$;
