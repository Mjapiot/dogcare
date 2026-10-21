-- Dogcare — review fixes (2026-10-21), part 2: business rules
--  * preferences only control push: every notification reaches the in-app bell
--  * a helper can cancel one of several slots on the same request
--  * an answer can never be moved to another request / user
--  * a confirmed helper's offer always contains their assignment
--  * an "information" that becomes a real need is announced to the group
--  * switching a request to non-splittable is checked and partial offers reset
--  * a request that has ended can no longer be confirmed

-- ---------------------------------------------------------------------------
-- Notifications: always stored; preferences decide whether to push
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
begin
  if p_user_id is null or p_user_id is not distinct from p_actor_id then
    return;
  end if;

  select case p_type
           when 'new_request' then np.new_requests_enabled
           when 'response_reset' then np.new_requests_enabled
           when 'new_volunteer' then np.responses_enabled
           when 'assignment_confirmed' then np.confirmations_enabled
           when 'reconfirmation_needed' then np.confirmations_enabled
           when 'request_updated' then np.confirmations_enabled
           when 'assignment_cancelled' then np.cancellations_enabled
           when 'request_cancelled' then np.cancellations_enabled
           else true
         end
    into v_enabled
  from public.notification_preferences np
  where np.user_id = p_user_id;

  insert into public.notifications (user_id, group_id, notification_type, title, body, request_id, actor_id, push_state)
  values (p_user_id, p_group_id, p_type, p_title, p_body, p_request_id, p_actor_id,
          case when v_enabled is false then 'skipped' else 'pending' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Announcing a request to eligible members (insert, or info → real need)
-- ---------------------------------------------------------------------------
create function private.announce_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.care_requests%rowtype;
  v_member record;
  v_title text;
begin
  select * into v_req from public.care_requests where id = p_request_id;
  if not found or v_req.necessity = 'info' or v_req.lifecycle_status <> 'active' then
    return;
  end if;
  v_title := 'Nouvelle demande pour ' || (select name from public.dogs where id = v_req.dog_id);
  for v_member in
    select gm.user_id from public.group_members gm
    where gm.group_id = v_req.group_id
      and not exists (select 1 from public.dog_caretakers dc where dc.dog_id = v_req.dog_id and dc.user_id = gm.user_id)
  loop
    perform private.notify(v_member.user_id, v_req.group_id, 'new_request', v_title,
      private.fmt_period(v_req.starts_at, v_req.ends_at), v_req.id, coalesce(auth.uid(), v_req.created_by));
  end loop;
end;
$$;

create or replace function private.care_requests_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.announce_request(new.id);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Request updates: validation before, consequences after
-- ---------------------------------------------------------------------------
create or replace function private.care_requests_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.ends_at <= now() then
      raise exception 'La période demandée est déjà passée.' using errcode = 'P0001';
    end if;
    if (select archived_at from public.dogs where id = new.dog_id) is not null then
      raise exception 'Ce chien est archivé.' using errcode = 'P0001';
    end if;
    new.lifecycle_status := 'active';
    new.revision := 1;
    return new;
  end if;

  if old.lifecycle_status = 'cancelled' then
    -- technical updates (e.g. author set to null on account deletion) are fine
    if (new.request_type, new.necessity, new.starts_at, new.ends_at, new.description, new.splittable, new.lifecycle_status)
       is distinct from
       (old.request_type, old.necessity, old.starts_at, old.ends_at, old.description, old.splittable, old.lifecycle_status) then
      raise exception 'Cette demande est annulée et ne peut plus être modifiée.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  new.updated_at := now();
  if new.lifecycle_status = 'cancelled' then
    new.cancelled_at := now();
  end if;
  if new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.request_type is distinct from old.request_type then
    if new.ends_at <= now() then
      raise exception 'La nouvelle période est déjà passée.' using errcode = 'P0001';
    end if;
    new.revision := old.revision + 1;
  end if;
  if old.splittable and not new.splittable and new.lifecycle_status = 'active' and exists (
    select 1 from public.care_assignments a
    where a.request_id = new.id and a.status <> 'cancelled'
      and (a.starts_at > new.starts_at or a.ends_at < new.ends_at)
  ) then
    raise exception 'Des gardes partielles sont déjà confiées : retirez-les ou laissez la demande partageable.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

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
          'Votre garde de ' || v_dog || ' a été déplacée',
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
          'Merci de reconfirmer la garde de ' || v_dog,
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
        'La garde de ' || v_dog || ' doit être assurée en entier',
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

-- ---------------------------------------------------------------------------
-- Responses
-- ---------------------------------------------------------------------------
create or replace function private.request_responses_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.care_requests%rowtype;
begin
  if tg_op = 'UPDATE' and (new.request_id <> old.request_id or new.user_id <> old.user_id) then
    raise exception 'Une réponse ne peut pas être déplacée vers une autre demande.' using errcode = 'P0001';
  end if;

  select * into v_req from public.care_requests where id = new.request_id;
  new.updated_at := now();
  new.responded_at := now();

  if new.response_status = 'no' then
    new.proposed_starts_at := null;
    new.proposed_ends_at := null;
    if exists (
      select 1 from public.care_assignments
      where request_id = new.request_id and assigned_user_id = new.user_id and status <> 'cancelled'
    ) then
      raise exception 'Cette garde vous est confiée : annulez-la explicitement pour prévenir le propriétaire.'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.proposed_starts_at is not null then
    if new.proposed_starts_at < v_req.starts_at or new.proposed_ends_at > v_req.ends_at then
      raise exception 'Le créneau proposé doit être compris dans la demande.' using errcode = 'P0001';
    end if;
    if not v_req.splittable
       and (new.proposed_starts_at <> v_req.starts_at or new.proposed_ends_at <> v_req.ends_at) then
      raise exception 'Cette garde ne peut pas être partagée : proposez-vous pour toute la période.'
        using errcode = 'P0001';
    end if;
    if new.proposed_starts_at = v_req.starts_at and new.proposed_ends_at = v_req.ends_at then
      new.proposed_starts_at := null;
      new.proposed_ends_at := null;
    end if;
  end if;

  if exists (
    select 1 from public.care_assignments a
    where a.request_id = new.request_id and a.assigned_user_id = new.user_id and a.status <> 'cancelled'
      and (a.starts_at < coalesce(new.proposed_starts_at, v_req.starts_at)
           or a.ends_at > coalesce(new.proposed_ends_at, v_req.ends_at))
  ) then
    raise exception 'Votre proposition doit inclure la garde confirmée qui vous est confiée.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------------
create or replace function public.confirm_assignment(
  p_request_id uuid,
  p_user_id uuid,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.care_requests%rowtype;
  v_resp public.request_responses%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  -- lock the request: confirmations of the same request are serialized
  select * into v_req from public.care_requests where id = p_request_id for update;
  if not found or not private.is_group_member(v_req.group_id) then
    raise exception 'Demande introuvable.' using errcode = 'P0001';
  end if;
  if not private.is_dog_caretaker(v_req.dog_id) then
    raise exception 'Seul un responsable du chien peut confirmer une garde.' using errcode = 'P0001';
  end if;
  if v_req.lifecycle_status <> 'active' then
    raise exception 'Cette demande est annulée.' using errcode = 'P0001';
  end if;
  if v_req.ends_at <= now() then
    raise exception 'Cette demande est terminée.' using errcode = 'P0001';
  end if;
  if v_req.necessity = 'info' then
    raise exception 'Une information ne se confirme pas.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.group_members where group_id = v_req.group_id and user_id = p_user_id) then
    raise exception 'Cette personne ne fait plus partie du groupe.' using errcode = 'P0001';
  end if;
  select * into v_resp from public.request_responses where request_id = p_request_id and user_id = p_user_id;
  if not found or v_resp.response_status <> 'yes' then
    raise exception 'Cette personne n''a pas proposé son aide.' using errcode = 'P0001';
  end if;

  v_start := coalesce(p_starts_at, v_resp.proposed_starts_at, v_req.starts_at);
  v_end := coalesce(p_ends_at, v_resp.proposed_ends_at, v_req.ends_at);
  if v_start >= v_end or v_start < v_req.starts_at or v_end > v_req.ends_at then
    raise exception 'Le créneau confirmé doit être compris dans la demande.' using errcode = 'P0001';
  end if;
  if v_resp.proposed_starts_at is not null
     and (v_start < v_resp.proposed_starts_at or v_end > v_resp.proposed_ends_at) then
    raise exception 'Le créneau dépasse ce que cette personne a proposé.' using errcode = 'P0001';
  end if;
  if not v_req.splittable and (v_start <> v_req.starts_at or v_end <> v_req.ends_at) then
    raise exception 'Cette garde ne peut pas être partagée : elle doit être confiée en entier.' using errcode = 'P0001';
  end if;

  begin
    insert into public.care_assignments (request_id, assigned_user_id, starts_at, ends_at, confirmed_by)
    values (p_request_id, p_user_id, v_start, v_end, v_uid)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Une partie de ce créneau est déjà confiée à quelqu''un.' using errcode = 'P0001';
  end;

  perform private.notify(p_user_id, v_req.group_id, 'assignment_confirmed',
    'Garde confirmée : ' || (select name from public.dogs where id = v_req.dog_id),
    private.fmt_period(v_start, v_end), p_request_id, v_uid);
  perform private.audit('assignment_confirmed', v_req.group_id, v_id,
    jsonb_build_object('request_id', p_request_id, 'user_id', p_user_id));
  return v_id;
end;
$$;

-- the helper's "yes" is withdrawn only when none of their slots remain
create function private.withdraw_offer_if_no_slot_left(p_request_id uuid, p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.request_responses set response_status = 'no'
  where request_id = p_request_id and user_id = p_user_id
    and not exists (
      select 1 from public.care_assignments
      where request_id = p_request_id and assigned_user_id = p_user_id and status <> 'cancelled'
    );
$$;

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
      'Votre garde de ' || v_dog || ' est annulée',
      private.fmt_period(v_a.starts_at, v_a.ends_at)
        || coalesce(' — ' || nullif(btrim(coalesce(p_reason, '')), ''), ''),
      v_req.id, v_uid);
  end if;
  perform private.audit('assignment_cancelled', v_req.group_id, p_assignment_id,
    jsonb_build_object('by_helper', v_a.assigned_user_id = v_uid));
end;
$$;

create or replace function public.answer_reconfirmation(p_assignment_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_a public.care_assignments%rowtype;
  v_req public.care_requests%rowtype;
  v_owner record;
  v_dog text;
begin
  select * into v_a from public.care_assignments where id = p_assignment_id for update;
  if not found or v_a.assigned_user_id is distinct from v_uid then
    raise exception 'Garde introuvable.' using errcode = 'P0001';
  end if;
  if v_a.status <> 'pending_reconfirmation' then
    raise exception 'Cette garde n''attend pas de reconfirmation.' using errcode = 'P0001';
  end if;
  select * into v_req from public.care_requests where id = v_a.request_id;
  v_dog := (select name from public.dogs where id = v_req.dog_id);

  if p_accept then
    update public.care_assignments
      set status = 'confirmed', confirmed_at = now(), previous_starts_at = null, previous_ends_at = null
      where id = p_assignment_id;
  else
    update public.care_assignments
      set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
          cancellation_reason = 'Nouveaux horaires refusés'
      where id = p_assignment_id;
    perform private.withdraw_offer_if_no_slot_left(v_a.request_id, v_uid);
  end if;

  for v_owner in select user_id from public.dog_caretakers where dog_id = v_req.dog_id loop
    perform private.notify(v_owner.user_id, v_req.group_id,
      case when p_accept then 'assignment_confirmed'::public.notification_type else 'assignment_cancelled'::public.notification_type end,
      private.display_name(v_uid) || case when p_accept then ' confirme les nouveaux horaires pour ' else ' ne peut pas aux nouveaux horaires pour ' end || v_dog,
      private.fmt_period(v_a.starts_at, v_a.ends_at), v_req.id, v_uid);
  end loop;
  perform private.audit('assignment_reconfirmation', v_req.group_id, p_assignment_id, jsonb_build_object('accepted', p_accept));
end;
$$;

revoke all on function private.announce_request(uuid) from public, anon, authenticated;
revoke all on function private.withdraw_offer_if_no_slot_left(uuid, uuid) from public, anon, authenticated;
revoke all on function private.notify(uuid, uuid, public.notification_type, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function private.care_requests_after_insert() from public, anon, authenticated;
revoke all on function private.care_requests_after_update() from public, anon, authenticated;
revoke all on function private.care_requests_before() from public, anon, authenticated;
revoke all on function private.request_responses_before() from public, anon, authenticated;
revoke all on function public.confirm_assignment(uuid, uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.cancel_assignment(uuid, text) from public, anon;
revoke all on function public.answer_reconfirmation(uuid, boolean) from public, anon;
grant execute on function public.confirm_assignment(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.cancel_assignment(uuid, text) to authenticated;
grant execute on function public.answer_reconfirmation(uuid, boolean) to authenticated;
