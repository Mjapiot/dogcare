-- Dogcare — business rules enforced by the database
-- User-facing errors are raised with SQLSTATE 'P0001' and a French message the
-- app can display as-is. Any other error is shown as a generic message.

-- ---------------------------------------------------------------------------
-- Formatting & notification helpers
-- ---------------------------------------------------------------------------
create function private.fmt_ts(p_ts timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select (array['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'])
           [extract(isodow from p_ts at time zone 'Europe/Paris')::int]
         || ' ' || to_char(p_ts at time zone 'Europe/Paris', 'DD/MM HH24:MI');
$$;

create function private.fmt_period(p_starts timestamptz, p_ends timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select private.fmt_ts(p_starts) || ' → ' || private.fmt_ts(p_ends);
$$;

create function private.display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(display_name), ''), 'Un membre')
  from public.profiles where id = p_user_id;
$$;

create function private.notify(
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

  -- no preference row means defaults (enabled)
  if v_enabled is false then
    return;
  end if;

  insert into public.notifications (user_id, group_id, notification_type, title, body, request_id, actor_id)
  values (p_user_id, p_group_id, p_type, p_title, p_body, p_request_id, p_actor_id);
end;
$$;

create function private.audit(p_event text, p_group_id uuid, p_entity_id uuid, p_data jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (actor_id, event_type, group_id, entity_id, data)
  values ((select auth.uid()), p_event, p_group_id, p_entity_id, coalesce(p_data, '{}'::jsonb));
$$;

create function private.request_label(p_request_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.name || ' · ' || private.fmt_period(r.starts_at, r.ends_at)
  from public.care_requests r join public.dogs d on d.id = r.dog_id
  where r.id = p_request_id;
$$;

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------
create function public.create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then
    raise exception 'Le nom du groupe doit faire entre 1 et 60 caractères.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.group_members where user_id = v_uid and role = 'admin') >= 20 then
    raise exception 'Vous administrez déjà trop de groupes.' using errcode = 'P0001';
  end if;

  insert into public.groups (name, created_by) values (btrim(p_name), v_uid) returning id into v_group_id;
  insert into public.group_members (group_id, user_id, role) values (v_group_id, v_uid, 'admin');
  perform private.audit('group_created', v_group_id, v_group_id);
  return v_group_id;
end;
$$;

create function public.set_member_role(p_group_id uuid, p_user_id uuid, p_role public.member_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Seul un administrateur peut changer les rôles.' using errcode = 'P0001';
  end if;
  update public.group_members set role = p_role where group_id = p_group_id and user_id = p_user_id;
  if not found then
    raise exception 'Ce membre ne fait pas partie du groupe.' using errcode = 'P0001';
  end if;
  perform private.audit('member_role_changed', p_group_id, p_user_id, jsonb_build_object('role', p_role));
end;
$$;

-- A group always keeps at least one admin; an empty group is deleted.
create function private.group_members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := coalesce(new.group_id, old.group_id);
begin
  if not exists (select 1 from public.groups where id = v_group_id) then
    return null; -- the group itself is being deleted
  end if;
  if not exists (select 1 from public.group_members where group_id = v_group_id) then
    delete from public.groups where id = v_group_id;
    return null;
  end if;
  if not exists (select 1 from public.group_members where group_id = v_group_id and role = 'admin') then
    if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then
      -- the last admin deleted their account: promote the longest-standing member
      update public.group_members set role = 'admin'
      where (group_id, user_id) = (
        select group_id, user_id from public.group_members
        where group_id = v_group_id order by joined_at limit 1
      );
      return null;
    end if;
    raise exception 'Le groupe doit garder au moins un administrateur. Nommez-en un autre avant.'
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger group_members_guard after update or delete on public.group_members
  for each row execute function private.group_members_guard();

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create function private.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

-- Returns the raw token once. Only its SHA-256 hash is stored.
create function public.create_invitation(
  p_group_id uuid,
  p_expires_in_hours integer default 168,
  p_max_uses integer default 10
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Seul un administrateur peut inviter.' using errcode = 'P0001';
  end if;
  if p_expires_in_hours not between 1 and 720 then
    raise exception 'La durée de validité doit être comprise entre 1 heure et 30 jours.' using errcode = 'P0001';
  end if;
  if p_max_uses not between 1 and 50 then
    raise exception 'Le nombre d''utilisations doit être compris entre 1 et 50.' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.group_invitations
    where group_id = p_group_id and revoked_at is null and expires_at > now() and use_count < max_uses
  ) >= 10 then
    raise exception 'Trop d''invitations actives. Révoquez-en une avant.' using errcode = 'P0001';
  end if;

  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.group_invitations (group_id, token_hash, created_by, expires_at, max_uses)
  values (p_group_id, private.hash_token(v_token), auth.uid(), now() + make_interval(hours => p_expires_in_hours), p_max_uses);
  perform private.audit('invitation_created', p_group_id, null,
    jsonb_build_object('expires_in_hours', p_expires_in_hours, 'max_uses', p_max_uses));
  return v_token;
end;
$$;

create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from public.group_invitations where id = p_invitation_id;
  if v_group_id is null or not private.is_group_admin(v_group_id) then
    raise exception 'Invitation introuvable.' using errcode = 'P0001';
  end if;
  update public.group_invitations set revoked_at = now() where id = p_invitation_id and revoked_at is null;
  perform private.audit('invitation_revoked', v_group_id, p_invitation_id);
end;
$$;

-- Preview shown before joining. Requires authentication and reveals only the
-- group name and inviter, never group data.
create function public.get_invitation(p_token text)
returns table (group_id uuid, group_name text, inviter_name text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.group_invitations%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  select * into v_inv from public.group_invitations where token_hash = private.hash_token(coalesce(p_token, ''));
  if not found then
    return query select null::uuid, null::text, null::text, 'invalid'::text;
    return;
  end if;
  return query
    select g.id, g.name, private.display_name(v_inv.created_by),
      case
        when exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = v_uid) then 'already_member'
        when v_inv.revoked_at is not null then 'revoked'
        when v_inv.expires_at <= now() then 'expired'
        when v_inv.use_count >= v_inv.max_uses then 'exhausted'
        else 'valid'
      end
    from public.groups g where g.id = v_inv.group_id;
end;
$$;

create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.group_invitations%rowtype;
  v_admin record;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  select * into v_inv from public.group_invitations
  where token_hash = private.hash_token(coalesce(p_token, ''))
  for update;
  if not found then
    raise exception 'Ce lien d''invitation n''est pas valide.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.group_members where group_id = v_inv.group_id and user_id = v_uid) then
    return v_inv.group_id;
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'Ce lien d''invitation a été révoqué.' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'Ce lien d''invitation a expiré. Demandez-en un nouveau.' using errcode = 'P0001';
  end if;
  if v_inv.use_count >= v_inv.max_uses then
    raise exception 'Ce lien d''invitation a déjà été utilisé le nombre maximum de fois.' using errcode = 'P0001';
  end if;

  insert into public.group_members (group_id, user_id, role) values (v_inv.group_id, v_uid, 'member');
  update public.group_invitations set use_count = use_count + 1 where id = v_inv.id;
  perform private.audit('invitation_accepted', v_inv.group_id, v_inv.id);

  for v_admin in
    select user_id from public.group_members where group_id = v_inv.group_id and role = 'admin'
  loop
    perform private.notify(v_admin.user_id, v_inv.group_id, 'member_joined',
      private.display_name(v_uid) || ' a rejoint le groupe', null, null, v_uid);
  end loop;
  return v_inv.group_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dogs
-- ---------------------------------------------------------------------------
create function public.create_dog(
  p_name text,
  p_group_ids uuid[],
  p_breed text default null,
  p_birth_date date default null,
  p_care_notes text default null,
  p_special_needs text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_dog_id uuid;
  v_group_id uuid;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  if p_birth_date is not null and p_birth_date > current_date then
    raise exception 'La date de naissance ne peut pas être dans le futur.' using errcode = 'P0001';
  end if;
  foreach v_group_id in array coalesce(p_group_ids, '{}') loop
    if not private.is_group_member(v_group_id) then
      raise exception 'Vous ne faites pas partie de ce groupe.' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.dogs (name, breed, birth_date, care_notes, special_needs, created_by)
  values (btrim(p_name), nullif(btrim(p_breed), ''), p_birth_date, nullif(btrim(p_care_notes), ''),
          nullif(btrim(p_special_needs), ''), v_uid)
  returning id into v_dog_id;
  insert into public.dog_caretakers (dog_id, user_id, role) values (v_dog_id, v_uid, 'owner');
  insert into public.group_dogs (group_id, dog_id)
  select distinct g, v_dog_id from unnest(coalesce(p_group_ids, '{}')) as g;
  return v_dog_id;
end;
$$;

-- A caretaker can add another person who already sees the dog in a group.
create function public.add_dog_caretaker(p_dog_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_dog_caretaker(p_dog_id) then
    raise exception 'Seul un responsable du chien peut ajouter un responsable.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.group_dogs gd
    join public.group_members gm on gm.group_id = gd.group_id
    where gd.dog_id = p_dog_id and gm.user_id = p_user_id
  ) then
    raise exception 'Cette personne doit faire partie d''un groupe où le chien est visible.' using errcode = 'P0001';
  end if;
  insert into public.dog_caretakers (dog_id, user_id, role) values (p_dog_id, p_user_id, 'caretaker')
  on conflict do nothing;
  perform private.audit('caretaker_added', null, p_dog_id, jsonb_build_object('user_id', p_user_id));
end;
$$;

-- A dog keeps at least one caretaker, unless its last caretaker deleted their
-- account: the dog is then archived (history is kept).
create function private.dog_caretakers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.dogs where id = old.dog_id) then
    return null;
  end if;
  if exists (select 1 from public.dog_caretakers where dog_id = old.dog_id) then
    return null;
  end if;
  if not exists (select 1 from auth.users where id = old.user_id) then
    update public.dogs set archived_at = coalesce(archived_at, now()) where id = old.dog_id;
    return null;
  end if;
  raise exception 'Un chien doit garder au moins un responsable.' using errcode = 'P0001';
end;
$$;

create trigger dog_caretakers_guard after delete on public.dog_caretakers
  for each row execute function private.dog_caretakers_guard();

-- ---------------------------------------------------------------------------
-- Care requests
-- ---------------------------------------------------------------------------
create function private.care_requests_before()
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
  return new;
end;
$$;

create trigger care_requests_before before insert or update on public.care_requests
  for each row execute function private.care_requests_before();

create function private.care_requests_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_title text;
begin
  if new.necessity = 'info' then
    return null;
  end if;
  v_title := 'Nouvelle demande pour ' || (select name from public.dogs where id = new.dog_id);
  for v_member in
    select gm.user_id from public.group_members gm
    where gm.group_id = new.group_id
      and not exists (select 1 from public.dog_caretakers dc where dc.dog_id = new.dog_id and dc.user_id = gm.user_id)
  loop
    perform private.notify(v_member.user_id, new.group_id, 'new_request', v_title,
      private.fmt_period(new.starts_at, new.ends_at), new.id, new.created_by);
  end loop;
  return null;
end;
$$;

create trigger care_requests_after_insert after insert on public.care_requests
  for each row execute function private.care_requests_after_insert();

-- Never modify a confirmed commitment silently:
--  * cancellation cancels live assignments and informs everyone involved
--  * a change of period/type puts impacted assignments in reconfirmation
--  * answers given for the old period are reset (people are asked again)
create function private.care_requests_after_update()
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
  return null;
end;
$$;

create trigger care_requests_after_update after update on public.care_requests
  for each row execute function private.care_requests_after_update();

-- ---------------------------------------------------------------------------
-- Responses
-- ---------------------------------------------------------------------------
create function private.request_responses_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.care_requests%rowtype;
begin
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
  return new;
end;
$$;

create trigger request_responses_before before insert or update on public.request_responses
  for each row execute function private.request_responses_before();

create function private.request_responses_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.care_requests%rowtype;
  v_owner record;
begin
  if new.response_status <> 'yes' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.response_status = 'yes'
     and old.proposed_starts_at is not distinct from new.proposed_starts_at
     and old.proposed_ends_at is not distinct from new.proposed_ends_at then
    return null;
  end if;
  select * into v_req from public.care_requests where id = new.request_id;
  for v_owner in select user_id from public.dog_caretakers where dog_id = v_req.dog_id loop
    perform private.notify(v_owner.user_id, v_req.group_id, 'new_volunteer',
      private.display_name(new.user_id) || ' peut aider pour ' || (select name from public.dogs where id = v_req.dog_id),
      case when new.proposed_starts_at is null
        then 'Toute la période : ' || private.fmt_period(v_req.starts_at, v_req.ends_at)
        else 'Proposition : ' || private.fmt_period(new.proposed_starts_at, new.proposed_ends_at)
      end,
      v_req.id, new.user_id);
  end loop;
  return null;
end;
$$;

create trigger request_responses_after after insert or update on public.request_responses
  for each row execute function private.request_responses_after();

-- ---------------------------------------------------------------------------
-- Assignments (confirmations)
-- ---------------------------------------------------------------------------
create function public.confirm_assignment(
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

create function public.cancel_assignment(p_assignment_id uuid, p_reason text default null)
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
    -- the helper withdraws: their offer no longer stands
    update public.request_responses set response_status = 'no'
      where request_id = v_a.request_id and user_id = v_uid;
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

create function public.answer_reconfirmation(p_assignment_id uuid, p_accept boolean)
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
    update public.request_responses set response_status = 'no'
      where request_id = v_a.request_id and user_id = v_uid;
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

-- ---------------------------------------------------------------------------
-- Account deletion: personal data is removed; dogs whose last caretaker
-- leaves are archived; requests keep their history without an author.
-- ---------------------------------------------------------------------------
create function public.delete_my_account()
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
  -- groups where the user is the only admin but not alone: promote the oldest member
  update public.group_members gm set role = 'admin'
  where (gm.group_id, gm.user_id) in (
    select distinct on (m.group_id) m.group_id, m.user_id
    from public.group_members m
    where m.user_id <> v_uid
      and m.group_id in (select group_id from public.group_members where user_id = v_uid and role = 'admin')
      and not exists (
        select 1 from public.group_members a
        where a.group_id = m.group_id and a.role = 'admin' and a.user_id <> v_uid
      )
    order by m.group_id, m.joined_at
  );
  perform private.audit('account_deleted', null, v_uid);
  delete from auth.users where id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC privileges: authenticated users only
-- ---------------------------------------------------------------------------
revoke all on function public.create_group(text) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, public.member_role) from public, anon;
revoke all on function public.create_invitation(uuid, integer, integer) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.get_invitation(text) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.create_dog(text, uuid[], text, date, text, text) from public, anon;
revoke all on function public.add_dog_caretaker(uuid, uuid) from public, anon;
revoke all on function public.confirm_assignment(uuid, uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.cancel_assignment(uuid, text) from public, anon;
revoke all on function public.answer_reconfirmation(uuid, boolean) from public, anon;
revoke all on function public.delete_my_account() from public, anon;

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.member_role) to authenticated;
grant execute on function public.create_invitation(uuid, integer, integer) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.get_invitation(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.create_dog(text, uuid[], text, date, text, text) to authenticated;
grant execute on function public.add_dog_caretaker(uuid, uuid) to authenticated;
grant execute on function public.confirm_assignment(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.cancel_assignment(uuid, text) to authenticated;
grant execute on function public.answer_reconfirmation(uuid, boolean) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- Private functions are only callable by their owner (triggers, RPCs), except
-- the read-only helpers used inside RLS policies.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_group_member(uuid),
  private.is_group_admin(uuid),
  private.is_dog_caretaker(uuid),
  private.can_view_dog(uuid),
  private.shares_group_with(uuid),
  private.can_view_availability_of(uuid),
  private.can_access_request(uuid),
  private.can_respond(uuid),
  private.try_uuid(text)
to authenticated;
