-- Dogcare — review fixes (2026-10-29)
-- 1. A block between two members only silences "social" notifications; a
--    confirmed commitment is never changed silently (rule 6). Confirming
--    someone you are blocked with is refused.
-- 2. confirm_assignment locks the helper's answer: a "no" sent at the same
--    moment can no longer leave a confirmed garde with a "no" answer.
-- 3. Groups are deleted through delete_group, which cancels the gardes still
--    ahead and tells helpers and caretakers first (no direct delete).
-- 4. claim_push_batch also returns group_id: the app links someone outside
--    the group (a circle invitee) to their own request page.
-- 5. A dog's photo must be in the dog's own folder (a link can only publish
--    that dog's photo).
-- 6. The old "special needs" column (now in dog_health) is no longer written.

-- ---------------------------------------------------------------------------
-- 1. Notifications: blocks silence social messages only
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
  -- blocked members do not solicit each other; commitments are always told
  if p_type::text in ('new_request', 'new_volunteer', 'response_reset', 'member_joined')
     and private.is_blocked_pair(p_user_id, p_actor_id) then
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
-- 1 & 2. Confirmation: refused between blocked members; the answer is locked
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
  v_member boolean;
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
  if private.is_blocked_pair(v_uid, p_user_id) then
    raise exception 'Vous ne pouvez pas confier cette garde à cette personne.' using errcode = 'P0001';
  end if;
  v_member := exists (select 1 from public.group_members where group_id = v_req.group_id and user_id = p_user_id);
  if not v_member and not private.is_request_invitee(p_request_id, p_user_id) then
    raise exception 'Cette personne ne fait plus partie du groupe.' using errcode = 'P0001';
  end if;
  -- lock the answer: a simultaneous switch to "no" waits, then sees this garde
  select * into v_resp from public.request_responses where request_id = p_request_id and user_id = p_user_id for update;
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
  if not v_member and not private.circle_covers(v_req.dog_id, p_user_id, v_start, v_end) then
    raise exception 'Ce créneau sort des dates d''accès de cette personne.' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- 3. Deleting a group: gardes ahead are cancelled and everyone is told first
-- ---------------------------------------------------------------------------
drop policy "groups: admins delete" on public.groups;
revoke delete on public.groups from authenticated;

create function public.delete_group(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group text;
  v_a record;
  v_owner record;
  v_count integer := 0;
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Seul un administrateur peut supprimer le groupe.' using errcode = 'P0001';
  end if;
  select name into v_group from public.groups where id = p_group_id for update;

  for v_a in
    select a.id, a.assigned_user_id, a.starts_at, a.ends_at, r.dog_id, d.name as dog
    from public.care_assignments a
    join public.care_requests r on r.id = a.request_id
    join public.dogs d on d.id = r.dog_id
    where r.group_id = p_group_id and r.lifecycle_status = 'active'
      and a.status <> 'cancelled' and a.ends_at > now()
    for update of a
  loop
    update public.care_assignments
      set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
          cancellation_reason = 'Le groupe a été supprimé'
      where id = v_a.id;
    -- no group nor request link: both disappear with the group
    perform private.notify(v_a.assigned_user_id, null, 'assignment_cancelled',
      'Votre garde ' || private.de_name(v_a.dog) || ' est annulée',
      private.fmt_period(v_a.starts_at, v_a.ends_at) || ' — le groupe « ' || v_group || ' » a été supprimé.',
      null, v_uid);
    for v_owner in select user_id from public.dog_caretakers where dog_id = v_a.dog_id loop
      perform private.notify(v_owner.user_id, null, 'assignment_cancelled',
        'Garde ' || private.de_name(v_a.dog) || ' annulée',
        private.fmt_period(v_a.starts_at, v_a.ends_at) || ' — le groupe « ' || v_group || ' » a été supprimé.',
        null, v_uid);
    end loop;
    v_count := v_count + 1;
  end loop;

  perform private.audit('group_deleted', null, p_group_id, jsonb_build_object('cancelled', v_count));
  delete from public.groups where id = p_group_id;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Push delivery knows whether the person is in the request's group
-- ---------------------------------------------------------------------------
drop function public.claim_push_batch(integer);
create function public.claim_push_batch(p_limit integer default 100)
returns table (
  id uuid,
  user_id uuid,
  notification_type public.notification_type,
  title text,
  body text,
  request_id uuid,
  group_id uuid
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
  returning n.id, n.user_id, n.notification_type, n.title, n.body, n.request_id, n.group_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A dog's photo lives in its own folder
-- ---------------------------------------------------------------------------
-- new writes only: existing paths were all written by the app in the right folder
alter table public.dogs
  add constraint dogs_photo_in_own_folder check (photo_path is null or photo_path like id::text || '/%') not valid;

create or replace function private.dog_photo_shared(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.dogs d
    join public.dog_share_links l on l.dog_id = d.id
    where d.photo_path = p_name
      and p_name like d.id::text || '/%'
      and d.archived_at is null
      and l.revoked_at is null
      and l.expires_at > now()
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. Health notes live in dog_health only
-- ---------------------------------------------------------------------------
revoke update (special_needs) on public.dogs from authenticated;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.delete_group(uuid) from public, anon;
grant execute on function public.delete_group(uuid) to authenticated;
revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;
