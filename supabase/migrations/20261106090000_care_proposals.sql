-- Dogcare — targeted garde proposals (holiday planning, delivery 2)
-- The owner plans an absence: the app splits it among the people around the
-- dog from what they declared (src/domain/planner.ts), then the owner sends
-- each person their part. Accepting is a "Oui" on that part, which the owner
-- confirms afterwards (confirm_plan): a proposal never confirms a garde alone.
-- People of the dog's circle outside the group are asked on the request at the
-- same time. Where the dog stays (at the helper's or at the owner's) is kept
-- on the confirmed garde.

alter type public.notification_type add value if not exists 'care_proposal';

create table public.care_proposals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.care_requests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- [{"starts_at": timestamptz, "ends_at": timestamptz}, …], sorted, disjoint
  slices jsonb not null check (jsonb_typeof(slices) = 'array' and jsonb_array_length(slices) between 1 and 20),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  place text not null default 'helper' check (place in ('helper', 'owner')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (request_id, user_id),
  check (ends_at > starts_at)
);

create index care_proposals_user_idx on public.care_proposals (user_id, status);

alter table public.care_proposals enable row level security;

-- the person, and the dog's caretakers; writes go through the functions below
create policy "care_proposals: person and caretakers read" on public.care_proposals
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.care_requests r
      where r.id = request_id and private.is_dog_caretaker(r.dog_id)
    )
  );

revoke insert, update, delete on public.care_proposals from authenticated, anon;
grant select on public.care_proposals to authenticated;

alter table public.care_assignments
  add column place text check (place in ('helper', 'owner'));

-- ---------------------------------------------------------------------------
-- Notifications: the preference for proposals is the one for new requests
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
  if p_type::text in ('new_request', 'new_volunteer', 'response_reset', 'member_joined', 'care_proposal')
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
           when 'care_proposal' then np.new_requests_enabled
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

-- someone asked through a proposal gets the proposal, not a second notice
create or replace function private.care_request_invitees_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.care_requests%rowtype;
begin
  select * into v_req from public.care_requests where id = new.request_id;
  if v_req.necessity <> 'info' and v_req.lifecycle_status = 'active' and v_req.ends_at > now()
     and not exists (
       select 1 from public.care_proposals p
       where p.request_id = new.request_id and p.user_id = new.user_id and p.status = 'pending'
     ) then
    perform private.notify(new.user_id, v_req.group_id, 'new_request',
      'Nouvelle demande pour ' || (select name from public.dogs where id = v_req.dog_id),
      private.fmt_period(v_req.starts_at, v_req.ends_at), v_req.id, coalesce(auth.uid(), v_req.created_by));
  end if;
  return null;
end;
$$;

-- "ven. 13 nov. 18:00 → dim. 15 nov. 10:00 · chez vous", or "2 créneaux, …"
create function private.proposal_text(p_slices jsonb, p_starts timestamptz, p_ends timestamptz, p_place text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_array_length(p_slices) > 1
           then jsonb_array_length(p_slices) || ' créneaux, ' else '' end
         || private.fmt_period(p_starts, p_ends)
         || case p_place when 'owner' then ' · chez le propriétaire' else ' · chez vous' end;
$$;

revoke all on function private.proposal_text(jsonb, timestamptz, timestamptz, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Sending proposals
-- p_proposals: [{"user_id": uuid, "place": "helper"|"owner",
--                "slices": [{"starts_at": …, "ends_at": …}, …]}, …]
-- ---------------------------------------------------------------------------
create function public.send_proposals(p_request_id uuid, p_proposals jsonb)
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
    values (v_req.id, v_user, v_slices, v_first, v_last, v_place, 'pending', v_uid, now(), null)
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
      private.proposal_text(v_slices, v_first, v_last, v_place), v_req.id, v_uid);
    v_count := v_count + 1;
  end loop;

  perform private.audit('proposals_sent', v_req.group_id, v_req.id, jsonb_build_object('count', v_count));
  return v_count;
end;
$$;

revoke all on function public.send_proposals(uuid, jsonb) from public, anon;
grant execute on function public.send_proposals(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Answering: accepting is a "Oui" on that part; the owner confirms afterwards
-- ---------------------------------------------------------------------------
create function public.answer_proposal(p_proposal_id uuid, p_accept boolean)
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
        private.proposal_text(v_prop.slices, v_prop.starts_at, v_prop.ends_at, v_prop.place),
        v_req.id, v_uid);
    end loop;
  end if;
end;
$$;

revoke all on function public.answer_proposal(uuid, boolean) from public, anon;
grant execute on function public.answer_proposal(uuid, boolean) to authenticated;

-- the owner takes back a proposal not answered yet
create function public.withdraw_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop public.care_proposals%rowtype;
  v_req public.care_requests%rowtype;
begin
  select * into v_prop from public.care_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'Proposition introuvable.' using errcode = 'P0001';
  end if;
  select * into v_req from public.care_requests where id = v_prop.request_id;
  if not private.is_dog_caretaker(v_req.dog_id) then
    raise exception 'Seul un responsable du chien peut retirer une proposition.' using errcode = 'P0001';
  end if;
  if v_prop.status <> 'pending' then
    raise exception 'Seule une proposition sans réponse peut être retirée.' using errcode = 'P0001';
  end if;
  update public.care_proposals set status = 'withdrawn', answered_at = now() where id = v_prop.id;
  perform private.notify(v_prop.user_id, v_req.group_id, 'care_proposal',
    'Proposition retirée : ' || (select name from public.dogs where id = v_req.dog_id),
    private.proposal_text(v_prop.slices, v_prop.starts_at, v_prop.ends_at, v_prop.place) || ' — plus besoin, merci !',
    v_req.id, auth.uid());
end;
$$;

revoke all on function public.withdraw_proposal(uuid) from public, anon;
grant execute on function public.withdraw_proposal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirming a plan keeps where the dog stays
-- p_slices: [{"user_id", "starts_at", "ends_at", "place"?}, …]
-- ---------------------------------------------------------------------------
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
    update public.care_assignments set place = v_slice ->> 'place' where id = v_id;
    v_count := v_count + 1;
  end loop;
  perform private.audit('plan_confirmed', (select group_id from public.care_requests where id = p_request_id), p_request_id,
    jsonb_build_object('slices', v_count));
  return v_count;
end;
$$;

-- a request whose dates change, or that is cancelled, drops its open proposals
-- (people are already told by the request's own notices)
create function private.care_requests_close_proposals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lifecycle_status <> 'active' or new.starts_at <> old.starts_at or new.ends_at <> old.ends_at
     or new.splittable <> old.splittable then
    update public.care_proposals
    set status = 'withdrawn', answered_at = now()
    where request_id = new.id and status in ('pending', 'accepted');
  end if;
  return null;
end;
$$;

create trigger care_requests_b_close_proposals after update on public.care_requests
  for each row execute function private.care_requests_close_proposals();
