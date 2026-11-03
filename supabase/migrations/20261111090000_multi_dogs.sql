-- Dogcare — several dogs at once
-- 1. A dog can be marked "kept alone" (never with another dog at the same
--    time); each person says how many dogs they keep at once (default 2,
--    null = no limit). The planning engine follows both (src/domain).
-- 2. An absence of several dogs is one request per dog, linked by
--    absence_id: same creator, same group, same dates (checked here). A
--    request whose dates change leaves its absence.
-- 3. One notice per person for an absence (new request, proposal, offer of
--    help), and one answer to a proposal answers it for all the dogs.

-- 1. ------------------------------------------------------------------------
alter table public.dogs add column alone_only boolean not null default false;
grant update (alone_only) on public.dogs to authenticated;

alter table public.profiles add column max_dogs_at_once smallint default 2 check (max_dogs_at_once between 1 and 5);
grant update (max_dogs_at_once) on public.profiles to authenticated;

-- 2. ------------------------------------------------------------------------
alter table public.care_requests add column absence_id uuid;
create index care_requests_absence_idx on public.care_requests (absence_id) where absence_id is not null;
-- set when the requests are created together; never changed afterwards by a client
grant insert (absence_id) on public.care_requests to authenticated;

create function private.care_requests_check_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- other dates: it is no longer the same absence (no answer for all on old dates)
    if new.starts_at <> old.starts_at or new.ends_at <> old.ends_at then
      new.absence_id := null;
    end if;
    return new;
  end if;
  if new.absence_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.absence_id::text, 0));
    if exists (
      select 1 from public.care_requests r
      where r.absence_id = new.absence_id
        and (r.created_by is distinct from new.created_by or r.group_id <> new.group_id
             or r.starts_at <> new.starts_at or r.ends_at <> new.ends_at or r.dog_id = new.dog_id)
    ) then
      raise exception 'Les demandes d''une même absence doivent avoir les mêmes dates, le même groupe et des chiens différents.'
        using errcode = 'P0001';
    end if;
    if (select count(*) from public.care_requests r where r.absence_id = new.absence_id) >= 5 then
      raise exception 'Une absence concerne 5 chiens au plus.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger care_requests_absence before insert or update on public.care_requests
  for each row execute function private.care_requests_check_absence();

-- "Aston", "Aston et Nala", "Aston, Nala et Rex"
create function private.join_names(p_names text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case coalesce(array_length(p_names, 1), 0)
           when 0 then ''
           when 1 then p_names[1]
           else array_to_string(p_names[1:array_length(p_names, 1) - 1], ', ') || ' et ' || p_names[array_length(p_names, 1)]
         end;
$$;

revoke all on function private.join_names(text[]) from public, anon;

-- 3. ------------------------------------------------------------------------
-- The unread, not yet pushed notices of one kind, from one person, about the
-- dogs of one absence, become a single notice.
create function private.merge_absence_notices(p_absence_id uuid, p_user_id uuid, p_type public.notification_type, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_first uuid;
  v_group uuid;
  v_names text[];
  v_bodies integer;
  v_body text;
  v_pending boolean;
  v_starts timestamptz;
  v_ends timestamptz;
  v_title text;
begin
  select array_agg(n.id order by r.created_at, d.name),
         (array_agg(n.request_id order by r.created_at, d.name))[1],
         (array_agg(n.group_id order by r.created_at, d.name))[1],
         array_agg(d.name order by r.created_at, d.name),
         count(distinct coalesce(n.body, '')),
         min(n.body),
         bool_or(n.push_state = 'pending'),
         min(r.starts_at),
         max(r.ends_at)
    into v_ids, v_first, v_group, v_names, v_bodies, v_body, v_pending, v_starts, v_ends
  from public.notifications n
  join public.care_requests r on r.id = n.request_id
  join public.dogs d on d.id = r.dog_id
  where n.user_id = p_user_id and n.notification_type = p_type and n.actor_id is not distinct from p_actor_id
    and r.absence_id = p_absence_id and n.read_at is null and n.push_state in ('pending', 'skipped');
  if coalesce(array_length(v_ids, 1), 0) < 2 then
    return;
  end if;

  v_title := case p_type::text
               when 'new_request' then 'Nouvelle demande pour ' || private.join_names(v_names)
               when 'care_proposal' then 'Pouvez-vous garder ' || private.join_names(v_names) || ' ?'
               else coalesce(private.display_name(p_actor_id), 'Quelqu''un') || ' peut aider pour ' || private.join_names(v_names)
             end;
  if v_bodies > 1 then
    v_body := 'Créneaux selon le chien · ' || private.fmt_period(v_starts, v_ends);
  end if;

  delete from public.notifications where id = any (v_ids);
  insert into public.notifications (user_id, group_id, notification_type, title, body, request_id, actor_id, push_state)
  values (p_user_id, v_group, p_type, v_title, v_body, v_first, p_actor_id, case when v_pending then 'pending' else 'skipped' end);
end;
$$;

revoke all on function private.merge_absence_notices(uuid, uuid, public.notification_type, uuid) from public, anon, authenticated;

create function private.notifications_merge_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_absence uuid;
  v_creator uuid;
begin
  select r.absence_id, r.created_by into v_absence, v_creator from public.care_requests r where r.id = new.request_id;
  if v_absence is null then
    return null;
  end if;
  -- requests and proposals come from the owner; an offer of help from someone else
  -- (a refusal, also a 'care_proposal' notice, comes from the helper: never merged)
  if (new.notification_type::text in ('new_request', 'care_proposal') and new.actor_id is not distinct from v_creator)
     or (new.notification_type::text = 'new_volunteer' and new.actor_id is distinct from v_creator) then
    perform private.merge_absence_notices(v_absence, new.user_id, new.notification_type, new.actor_id);
  end if;
  return null;
end;
$$;

create trigger notifications_merge_absence after insert on public.notifications
  for each row
  when (new.request_id is not null and new.notification_type::text in ('new_request', 'care_proposal', 'new_volunteer'))
  execute function private.notifications_merge_absence();

-- One answer for all the dogs of the absence: the proposals still waiting for
-- this person on the other requests of the absence get the same answer.
create or replace function public.answer_proposal(p_proposal_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_asked public.care_proposals%rowtype;
  v_prop public.care_proposals%rowtype;
  v_req public.care_requests%rowtype;
  v_ids uuid[];
  v_id uuid;
  v_declined uuid[] := '{}';
  v_owner record;
begin
  select * into v_asked from public.care_proposals where id = p_proposal_id and user_id = v_uid for update;
  if not found then
    raise exception 'Proposition introuvable.' using errcode = 'P0001';
  end if;
  if v_asked.status <> 'pending' then
    raise exception 'Cette proposition a déjà une réponse ou a été retirée.' using errcode = 'P0001';
  end if;
  select * into v_req from public.care_requests where id = v_asked.request_id;
  select array_agg(p.id order by r.created_at, r.id) into v_ids
  from public.care_proposals p
  join public.care_requests r on r.id = p.request_id
  where p.user_id = v_uid and p.status = 'pending'
    and (p.id = v_asked.id or (v_req.absence_id is not null and r.absence_id = v_req.absence_id));

  foreach v_id in array v_ids loop
    select * into v_prop from public.care_proposals where id = v_id and status = 'pending' for update;
    continue when not found;
    -- the request cannot change dates while the answer is written (no silent "Oui" on old dates)
    perform 1 from public.care_requests where id = v_prop.request_id for share;
    if not private.can_respond(v_prop.request_id) then
      if v_id = v_asked.id then
        raise exception 'Cette demande n''attend plus de réponse.' using errcode = 'P0001';
      end if;
      continue;
    end if;

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
      v_declined := v_declined || v_prop.request_id;
    end if;
  end loop;

  if cardinality(v_declined) > 0 then
    -- one notice per caretaker, naming every dog declined
    for v_owner in
      select dc.user_id,
             array_agg(d.name order by r.created_at, d.name) as names,
             (array_agg(r.id order by r.created_at, d.name))[1] as request_id,
             (array_agg(r.group_id order by r.created_at, d.name))[1] as group_id
      from public.care_requests r
      join public.dogs d on d.id = r.dog_id
      join public.dog_caretakers dc on dc.dog_id = r.dog_id
      where r.id = any (v_declined)
      group by dc.user_id
    loop
      perform private.notify(v_owner.user_id, v_owner.group_id, 'care_proposal',
        coalesce(private.display_name(v_uid), 'Quelqu''un') || ' ne peut pas garder ' || private.join_names(v_owner.names),
        private.fmt_period(v_asked.starts_at, v_asked.ends_at)
          || case v_asked.place when 'owner' then ' · chez le propriétaire' else ' · chez ' || coalesce(private.display_name(v_uid), 'cette personne') end,
        v_owner.request_id, v_uid);
    end loop;
  end if;
end;
$$;

-- "Planifier une absence" for one or several dogs, in one transaction: one
-- request per dog (linked when there are several), then each person's part
-- for each dog. p_proposals: [{"dog_id", "user_id", "place", "slices"}, …]
create function public.plan_absence_multi(
  p_group_id uuid,
  p_dog_ids uuid[],
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_description text,
  p_proposals jsonb
)
returns uuid[]
language plpgsql
-- runs as the caller: the request inserts go through RLS and their triggers
security invoker
set search_path = ''
as $$
declare
  v_absence uuid;
  v_dog uuid;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_for_dog jsonb;
begin
  if p_dog_ids is null or cardinality(p_dog_ids) not between 1 and 5
     or cardinality(p_dog_ids) <> (select count(distinct x) from unnest(p_dog_ids) x) then
    raise exception 'Choisissez de 1 à 5 chiens.' using errcode = 'P0001';
  end if;
  if p_proposals is not null and jsonb_typeof(p_proposals) <> 'array' then
    raise exception 'Propositions invalides.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb)) e
    where private.try_uuid(e ->> 'dog_id') is null or not (private.try_uuid(e ->> 'dog_id') = any (p_dog_ids))
  ) then
    raise exception 'Une proposition concerne un autre chien.' using errcode = 'P0001';
  end if;
  v_absence := case when cardinality(p_dog_ids) > 1 then gen_random_uuid() end;

  foreach v_dog in array p_dog_ids loop
    insert into public.care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at, description, splittable, absence_id)
    values (p_group_id, v_dog, 'care', 'required', p_starts_at, p_ends_at, nullif(btrim(p_description), ''), true, v_absence)
    returning id into v_id;
    v_ids := v_ids || v_id;
    select jsonb_agg(e - 'dog_id') into v_for_dog
    from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb)) e
    where private.try_uuid(e ->> 'dog_id') = v_dog;
    if v_for_dog is not null then
      perform public.send_proposals(v_id, v_for_dog);
    end if;
  end loop;
  return v_ids;
end;
$$;

revoke all on function public.plan_absence_multi(uuid, uuid[], timestamptz, timestamptz, text, jsonb) from public, anon;
grant execute on function public.plan_absence_multi(uuid, uuid[], timestamptz, timestamptz, text, jsonb) to authenticated;
