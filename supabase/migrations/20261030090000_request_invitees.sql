-- Dogcare — people of a dog's circle on its care requests
-- A caretaker can ask, request by request, close people and guests of the
-- dog's circle who are not in the request's group ("Demander aussi à").
-- An invitee:
-- - sees the request (not the group, its members or their answers);
-- - answers it like a member and counts as eligible ("no answer" is never a
--   refusal, "Sans solution" waits for them too);
-- - can be confirmed on it, within their guest dates;
-- - only reads their own answer and assignments, plus the confirmed slots of
--   the request without names (to show whether it is already covered).
-- Leaving the circle, or guest dates that no longer cover an assignment,
-- cancels it with notifications (never silently).

create table public.care_request_invitees (
  request_id uuid not null references public.care_requests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

create index care_request_invitees_user_idx on public.care_request_invitees (user_id);
create index care_request_invitees_invited_by_idx on public.care_request_invitees (invited_by);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- the dog's circle lets this person help over [p_starts, p_ends)
create function private.circle_covers(p_dog_id uuid, p_user_id uuid, p_starts timestamptz, p_ends timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dog_circle c
    where c.dog_id = p_dog_id
      and c.user_id = p_user_id
      and (
        c.role = 'close'
        or (c.role = 'guest' and (c.starts_at is null or c.starts_at <= p_starts) and c.ends_at >= p_ends)
      )
  );
$$;

create function private.is_request_invitee(p_request_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.care_request_invitees i
    where i.request_id = p_request_id and i.user_id = p_user_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
alter table public.care_request_invitees enable row level security;
revoke all on public.care_request_invitees from anon, authenticated;
grant select on public.care_request_invitees to authenticated;
-- writes go through set_request_invitees
create policy "care_request_invitees: request members and the person read" on public.care_request_invitees
  for select to authenticated
  using (user_id = (select auth.uid()) or private.can_access_request(request_id));

-- invitees see the requests they are asked on; can_access_request (answers,
-- assignments of everybody) stays reserved to the group's members
drop policy "care_requests: members read" on public.care_requests;
create policy "care_requests: members and invitees read" on public.care_requests
  for select to authenticated
  using (
    private.request_visible(id, group_id, created_by)
    or private.is_request_invitee(id, (select auth.uid()))
  );

drop policy "request_responses: members read" on public.request_responses;
create policy "request_responses: members and own read" on public.request_responses
  for select to authenticated
  using (user_id = (select auth.uid()) or private.can_access_request(request_id));

drop policy "care_assignments: members read" on public.care_assignments;
create policy "care_assignments: members and own read" on public.care_assignments
  for select to authenticated
  using (assigned_user_id = (select auth.uid()) or private.can_access_request(request_id));

-- a member, or an invitee, can answer an active, future, non-informational
-- request, unless they are one of the dog's caretakers
create or replace function private.can_respond(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.care_requests r
    where r.id = p_request_id
      and r.lifecycle_status = 'active'
      and r.necessity <> 'info'
      and r.ends_at > now()
      and (
        exists (select 1 from public.group_members gm where gm.group_id = r.group_id and gm.user_id = (select auth.uid()))
        or private.is_request_invitee(r.id, (select auth.uid()))
      )
      and not private.is_blocked_pair((select auth.uid()), r.created_by)
      and not exists (
        select 1 from public.dog_caretakers dc
        where dc.dog_id = r.dog_id and dc.user_id = (select auth.uid())
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Notifications: someone outside the group gets them without the group
-- (their link then leads to their circle space, not to a group screen)
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
  values (p_user_id, v_group, p_type, p_title, p_body, p_request_id, p_actor_id,
          case when v_enabled is false then 'skipped' else 'pending' end);
end;
$$;

-- an information that becomes a real need is announced to invitees too
create or replace function private.announce_request(p_request_id uuid)
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
    union
    select i.user_id from public.care_request_invitees i
    where i.request_id = v_req.id
  loop
    if not exists (select 1 from public.dog_caretakers dc where dc.dog_id = v_req.dog_id and dc.user_id = v_member.user_id) then
      perform private.notify(v_member.user_id, v_req.group_id, 'new_request', v_title,
        private.fmt_period(v_req.starts_at, v_req.ends_at), v_req.id, coalesce(auth.uid(), v_req.created_by));
    end if;
  end loop;
end;
$$;

-- a person newly asked on a live request is told about it
create function private.care_request_invitees_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.care_requests%rowtype;
begin
  select * into v_req from public.care_requests where id = new.request_id;
  if v_req.necessity <> 'info' and v_req.lifecycle_status = 'active' and v_req.ends_at > now() then
    perform private.notify(new.user_id, v_req.group_id, 'new_request',
      'Nouvelle demande pour ' || (select name from public.dogs where id = v_req.dog_id),
      private.fmt_period(v_req.starts_at, v_req.ends_at), v_req.id, coalesce(auth.uid(), v_req.created_by));
  end if;
  return null;
end;
$$;

create trigger care_request_invitees_after_insert after insert on public.care_request_invitees
  for each row execute function private.care_request_invitees_after_insert();

-- ---------------------------------------------------------------------------
-- Keeping invitations consistent with the circle
-- ---------------------------------------------------------------------------
-- Cancels the person's live assignments on the request that the circle no
-- longer allows, then drops the invitation (and the answer) unless a
-- commitment remains or the circle still covers the whole request.
create function private.prune_request_invitee(p_request_id uuid, p_user_id uuid, p_reason text)
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
      'Votre garde de ' || v_dog || ' est annulée',
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

-- removed from the circle, left it, or guest dates changed
create function private.dog_circle_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i record;
begin
  if tg_op = 'UPDATE' and (new.role, new.starts_at, new.ends_at) is not distinct from (old.role, old.starts_at, old.ends_at) then
    return null;
  end if;
  -- account or dog deletion: commitments are handled by those paths
  if not exists (select 1 from auth.users where id = old.user_id)
     or not exists (select 1 from public.dogs where id = old.dog_id) then
    return null;
  end if;
  for v_i in
    select i.request_id from public.care_request_invitees i
    join public.care_requests r on r.id = i.request_id
    where i.user_id = old.user_id and r.dog_id = old.dog_id
  loop
    perform private.prune_request_invitee(v_i.request_id, old.user_id,
      case when tg_op = 'DELETE' then 'ne fait plus partie du cercle' else 'ses dates d''accès ont changé' end);
  end loop;
  return null;
end;
$$;

create trigger dog_circle_after_change after update or delete on public.dog_circle
  for each row execute function private.dog_circle_after_change();

-- A request moved outside a guest's dates: an invitee without commitment
-- on it is no longer asked. Fires before care_requests_after_update
-- (alphabetical order), so they do not get "please answer again".
create function private.care_requests_prune_invitees()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i record;
begin
  if new.lifecycle_status <> 'active'
     or (new.starts_at = old.starts_at and new.ends_at = old.ends_at) then
    return null;
  end if;
  for v_i in
    delete from public.care_request_invitees i
    where i.request_id = new.id
      and not private.circle_covers(new.dog_id, i.user_id, new.starts_at, new.ends_at)
      and not exists (
        select 1 from public.care_assignments a
        where a.request_id = new.id and a.assigned_user_id = i.user_id and a.status <> 'cancelled'
      )
    returning i.user_id
  loop
    delete from public.request_responses where request_id = new.id and user_id = v_i.user_id;
    perform private.notify(v_i.user_id, new.group_id, 'request_updated',
      'La demande pour ' || (select name from public.dogs where id = new.dog_id) || ' a changé',
      'Nouvelle période : ' || private.fmt_period(new.starts_at, new.ends_at)
        || '. Elle ne correspond plus à vos dates : vous n''êtes plus sollicité.',
      new.id, auth.uid());
  end loop;
  return null;
end;
$$;

create trigger care_requests_a_prune_invitees after update on public.care_requests
  for each row execute function private.care_requests_prune_invitees();

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------
-- Replaces the list of circle people asked on a request (caretakers only).
create function public.set_request_invitees(p_request_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.care_requests%rowtype;
  v_ids uuid[] := array(select distinct u from unnest(coalesce(p_user_ids, '{}'::uuid[])) u where u is not null);
  v_id uuid;
  v_gone record;
begin
  select * into v_req from public.care_requests where id = p_request_id for update;
  if not found or not private.is_group_member(v_req.group_id) or not private.is_dog_caretaker(v_req.dog_id) then
    raise exception 'Seul un responsable du chien peut choisir qui solliciter.' using errcode = 'P0001';
  end if;
  if v_req.lifecycle_status <> 'active' or v_req.ends_at <= now() then
    raise exception 'Cette demande ne peut plus être modifiée.' using errcode = 'P0001';
  end if;
  if cardinality(v_ids) > 20 then
    raise exception 'Vous pouvez solliciter 20 personnes au plus.' using errcode = 'P0001';
  end if;

  foreach v_id in array v_ids loop
    if exists (select 1 from public.dog_caretakers dc where dc.dog_id = v_req.dog_id and dc.user_id = v_id) then
      raise exception 'Un responsable du chien ne peut pas être sollicité.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.group_members gm where gm.group_id = v_req.group_id and gm.user_id = v_id) then
      raise exception 'Cette personne fait déjà partie du groupe.' using errcode = 'P0001';
    end if;
    if not private.circle_covers(v_req.dog_id, v_id, v_req.starts_at, v_req.ends_at)
       and not private.is_request_invitee(v_req.id, v_id) then
      raise exception 'Cette personne ne fait pas partie du cercle du chien pour toute cette période.' using errcode = 'P0001';
    end if;
  end loop;

  -- people no longer asked: refused while a commitment remains
  for v_gone in
    select i.user_id from public.care_request_invitees i
    where i.request_id = v_req.id and not (i.user_id = any (v_ids))
  loop
    if exists (
      select 1 from public.care_assignments a
      where a.request_id = v_req.id and a.assigned_user_id = v_gone.user_id and a.status <> 'cancelled'
    ) then
      raise exception '% a une garde confirmée sur cette demande : annulez-la d''abord.',
        coalesce(private.display_name(v_gone.user_id), 'Cette personne') using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.request_responses rr
      where rr.request_id = v_req.id and rr.user_id = v_gone.user_id and rr.response_status = 'yes'
    ) then
      perform private.notify(v_gone.user_id, v_req.group_id, 'request_cancelled',
        'Demande retirée : ' || (select name from public.dogs where id = v_req.dog_id),
        private.fmt_period(v_req.starts_at, v_req.ends_at) || ' — vous n''êtes plus sollicité.',
        v_req.id, auth.uid());
    end if;
    delete from public.request_responses where request_id = v_req.id and user_id = v_gone.user_id;
    delete from public.care_request_invitees where request_id = v_req.id and user_id = v_gone.user_id;
  end loop;

  insert into public.care_request_invitees (request_id, user_id, invited_by)
  select v_req.id, u, auth.uid() from unnest(v_ids) u
  on conflict do nothing;

  perform private.audit('request_invitees_set', v_req.group_id, v_req.id, jsonb_build_object('count', cardinality(v_ids)));
end;
$$;

-- An invitee (not in the group) can be confirmed, within the circle's dates.
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
  v_member := exists (select 1 from public.group_members where group_id = v_req.group_id and user_id = p_user_id);
  if not v_member and not private.is_request_invitee(p_request_id, p_user_id) then
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

-- A person leaves a dog's circle by themselves (also how a guest stops
-- seeing an owner's requests).
create function public.leave_dog_circle(p_dog_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  delete from public.dog_circle where dog_id = p_dog_id and user_id = auth.uid();
  perform private.audit('circle_left', null, p_dog_id);
end;
$$;

-- invitees can report a request they are asked on
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
      select 'une demande pour ' || d.name into v_what
      from public.care_requests r join public.dogs d on d.id = r.dog_id
      where r.id = p_target_id and r.group_id = p_group_id;
    when 'dog' then
      select 'la fiche de ' || d.name into v_what
      from public.group_dogs gd join public.dogs d on d.id = gd.dog_id
      where gd.dog_id = p_target_id and gd.group_id = p_group_id;
    when 'member' then
      select private.display_name(m.user_id) into v_what
      from public.group_members m
      where m.user_id = p_target_id and m.group_id = p_group_id and m.user_id <> v_uid;
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
      case when p_target_type = 'request' then p_target_id end,
      null);
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads for screens
-- ---------------------------------------------------------------------------
-- People of the circle a caretaker may ask on a request of this group:
-- close people and guests of their dogs shared in the group, outside it.
create function public.request_invitee_candidates(p_group_id uuid)
returns table (dog_id uuid, user_id uuid, display_name text, role text, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.dog_id, c.user_id, private.display_name(c.user_id), c.role, c.starts_at, c.ends_at
  from public.dog_circle c
  join public.group_dogs gd on gd.dog_id = c.dog_id and gd.group_id = p_group_id
  where private.is_group_member(p_group_id)
    and private.is_dog_caretaker(c.dog_id)
    and c.role in ('close', 'guest')
    and (c.role = 'close' or c.ends_at > now())
    and not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = c.user_id)
    and not exists (select 1 from public.dog_caretakers dc where dc.dog_id = c.dog_id and dc.user_id = c.user_id)
  order by 3;
$$;

-- Invitees of requests the current user can see as a group member, with
-- their name and role in the dog's circle.
create function public.request_invitees_of(p_request_ids uuid[])
returns table (request_id uuid, user_id uuid, display_name text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.request_id, i.user_id, private.display_name(i.user_id), coalesce(c.role, 'guest')
  from public.care_request_invitees i
  join public.care_requests r on r.id = i.request_id
  left join public.dog_circle c on c.dog_id = r.dog_id and c.user_id = i.user_id
  where i.request_id = any (p_request_ids)
    and private.can_access_request(i.request_id);
$$;

-- Requests the current user is asked on as an invitee: the request, the
-- dog, the caretakers' names, their own answer and assignments, and the
-- confirmed slots without names. Without an id: those still ahead.
create function public.my_invited_requests(p_request_id uuid default null)
returns table (
  id uuid,
  group_id uuid,
  dog_id uuid,
  dog_name text,
  dog_photo_path text,
  owner_names text[],
  request_type public.request_type,
  necessity public.necessity_level,
  starts_at timestamptz,
  ends_at timestamptz,
  description text,
  splittable boolean,
  lifecycle_status public.request_lifecycle,
  cancellation_reason text,
  my_response jsonb,
  my_assignments jsonb,
  confirmed_slots jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id, r.group_id, r.dog_id, d.name, d.photo_path,
    array(
      select private.display_name(dc.user_id) from public.dog_caretakers dc
      where dc.dog_id = r.dog_id order by dc.role, 1
    ),
    r.request_type, r.necessity, r.starts_at, r.ends_at, r.description, r.splittable,
    r.lifecycle_status, r.cancellation_reason,
    (
      select jsonb_build_object(
        'response_status', rr.response_status,
        'proposed_starts_at', rr.proposed_starts_at,
        'proposed_ends_at', rr.proposed_ends_at,
        'note', rr.note
      )
      from public.request_responses rr where rr.request_id = r.id and rr.user_id = i.user_id
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status,
        'previous_starts_at', a.previous_starts_at, 'previous_ends_at', a.previous_ends_at
      ) order by a.starts_at)
      from public.care_assignments a
      where a.request_id = r.id and a.assigned_user_id = i.user_id and a.status <> 'cancelled'
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', a.starts_at, 'ends_at', a.ends_at) order by a.starts_at)
      from public.care_assignments a
      where a.request_id = r.id and a.status = 'confirmed'
    ), '[]'::jsonb)
  from public.care_request_invitees i
  join public.care_requests r on r.id = i.request_id
  join public.dogs d on d.id = r.dog_id
  where i.user_id = (select auth.uid())
    and (
      (p_request_id is null and r.lifecycle_status = 'active' and r.ends_at > now())
      or r.id = p_request_id
    )
  order by r.starts_at;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function private.circle_covers(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.is_request_invitee(uuid, uuid) from public, anon;
grant execute on function private.is_request_invitee(uuid, uuid) to authenticated;
revoke all on function private.care_request_invitees_after_insert() from public, anon, authenticated;
revoke all on function private.prune_request_invitee(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.dog_circle_after_change() from public, anon, authenticated;
revoke all on function private.care_requests_prune_invitees() from public, anon, authenticated;

revoke all on function public.set_request_invitees(uuid, uuid[]) from public, anon;
revoke all on function public.leave_dog_circle(uuid) from public, anon;
revoke all on function public.request_invitee_candidates(uuid) from public, anon;
revoke all on function public.request_invitees_of(uuid[]) from public, anon;
revoke all on function public.my_invited_requests(uuid) from public, anon;
grant execute on function public.set_request_invitees(uuid, uuid[]) to authenticated;
grant execute on function public.leave_dog_circle(uuid) to authenticated;
grant execute on function public.request_invitee_candidates(uuid) to authenticated;
grant execute on function public.request_invitees_of(uuid[]) to authenticated;
grant execute on function public.my_invited_requests(uuid) to authenticated;
