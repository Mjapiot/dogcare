-- Dogcare — circle of trust around each dog
-- Roles:
-- - owner / co-owner: the dog's caretakers (public.dog_caretakers), full rights;
--   a co-owner cannot remove the owner;
-- - "close" (proche): health and emergency always visible by default; may be
--   a group member or someone invited directly to the dog;
-- - "entourage": default role of the members of the dog's groups (no row
--   needed); health and emergency only around a confirmed assignment;
-- - "guest" (invité): invited directly to the dog, between two dates.
-- Close, entourage and guest have per-person settings for health and
-- emergency: always / during_care / never. Only caretakers edit the passport
-- and manage the circle. Guests and close people outside the groups see the
-- dog's passport only (not the groups, requests or planning).

create table public.dog_circle (
  dog_id uuid not null references public.dogs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('close', 'entourage', 'guest')),
  health_access text not null check (health_access in ('always', 'during_care', 'never')),
  emergency_access text not null check (emergency_access in ('always', 'during_care', 'never')),
  starts_at timestamptz,
  ends_at timestamptz,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (dog_id, user_id),
  -- only guests have dates, and a guest always has an end
  check ((role = 'guest') = (ends_at is not null)),
  check (role = 'guest' or starts_at is null),
  check (starts_at is null or ends_at > starts_at)
);

create index dog_circle_user_idx on public.dog_circle (user_id);
create index dog_circle_added_by_idx on public.dog_circle (added_by);

create table public.dog_circle_invitations (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references public.dogs (id) on delete cascade,
  token_hash text not null unique,
  role text not null check (role in ('close', 'guest')),
  health_access text not null check (health_access in ('always', 'never')),
  emergency_access text not null check (emergency_access in ('always', 'never')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check ((role = 'guest') = (ends_at is not null)),
  check (role = 'guest' or starts_at is null),
  check (starts_at is null or ends_at > starts_at)
);

create index dog_circle_invitations_dog_idx on public.dog_circle_invitations (dog_id);
create index dog_circle_invitations_created_by_idx on public.dog_circle_invitations (created_by);
create index dog_circle_invitations_used_by_idx on public.dog_circle_invitations (used_by);

-- ---------------------------------------------------------------------------
-- Access helpers (run as the signed-in user)
-- ---------------------------------------------------------------------------
create function private.is_dog_group_member(p_dog_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_dogs gd
    join public.group_members gm on gm.group_id = gd.group_id
    where gd.dog_id = p_dog_id and gm.user_id = (select auth.uid())
  );
$$;

-- A circle row that opens the dog by itself: "close", or a guest within its dates
create function private.has_direct_circle_access(p_dog_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dog_circle c
    where c.dog_id = p_dog_id
      and c.user_id = (select auth.uid())
      and (
        c.role = 'close'
        or (c.role = 'guest' and (c.starts_at is null or c.starts_at <= now()) and c.ends_at > now())
      )
  );
$$;

create or replace function private.can_view_dog(p_dog_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_dog_caretaker(p_dog_id)
    or private.is_dog_group_member(p_dog_id)
    or private.has_direct_circle_access(p_dog_id);
$$;

-- 'always' | 'during_care' | 'never' for the current user and a section
create function private.dog_section_level(p_dog_id uuid, p_section text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.dog_circle;
begin
  if private.is_dog_caretaker(p_dog_id) then
    return 'always';
  end if;
  select * into v_row from public.dog_circle c where c.dog_id = p_dog_id and c.user_id = (select auth.uid());
  if v_row.role = 'guest' then
    if (v_row.starts_at is not null and v_row.starts_at > now()) or v_row.ends_at <= now() then
      return 'never';
    end if;
  elsif v_row.role is null or v_row.role = 'entourage' then
    if not private.is_dog_group_member(p_dog_id) then
      return 'never';
    end if;
    if v_row.role is null then
      return 'during_care';
    end if;
  end if;
  return case p_section when 'health' then v_row.health_access when 'emergency' then v_row.emergency_access else 'never' end;
end;
$$;

-- live assignment for the dog, from 7 days before until its end
create function private.has_live_care(p_dog_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.care_assignments a
    join public.care_requests r on r.id = a.request_id
    where r.dog_id = p_dog_id
      and a.assigned_user_id = (select auth.uid())
      and a.status <> 'cancelled'
      and r.lifecycle_status = 'active'
      and a.starts_at < now() + interval '7 days'
      and a.ends_at > now()
  );
$$;

create function private.can_view_dog_section(p_dog_id uuid, p_section text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.dog_section_level(p_dog_id, p_section)
    when 'always' then true
    when 'during_care' then private.has_live_care(p_dog_id)
    else false
  end;
$$;

-- kept for compatibility: either private section
create or replace function private.can_view_dog_private(p_dog_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_view_dog_section(p_dog_id, 'health') or private.can_view_dog_section(p_dog_id, 'emergency');
$$;

drop policy "dog_health: caretakers and live sitters read" on public.dog_health;
drop policy "dog_emergency: caretakers and live sitters read" on public.dog_emergency;
create policy "dog_health: allowed by the circle" on public.dog_health
  for select to authenticated using (private.can_view_dog_section(dog_id, 'health'));
create policy "dog_emergency: allowed by the circle" on public.dog_emergency
  for select to authenticated using (private.can_view_dog_section(dog_id, 'emergency'));

-- For the UI: which private sections the current user may see
create function public.dog_section_access(p_dog_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'health', private.can_view_dog_section(p_dog_id, 'health'),
    'emergency', private.can_view_dog_section(p_dog_id, 'emergency')
  );
$$;

-- a co-owner cannot remove the owner (the owner may still step down)
drop policy "dog_caretakers: caretakers remove" on public.dog_caretakers;
create policy "dog_caretakers: caretakers remove" on public.dog_caretakers
  for delete to authenticated
  using (private.is_dog_caretaker(dog_id) and (role <> 'owner' or user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Circle: reads
-- ---------------------------------------------------------------------------
alter table public.dog_circle enable row level security;
alter table public.dog_circle_invitations enable row level security;
revoke all on public.dog_circle, public.dog_circle_invitations from anon, authenticated;
grant select on public.dog_circle, public.dog_circle_invitations to authenticated;
-- writes go through the functions below
create policy "dog_circle: caretakers and the person read" on public.dog_circle
  for select to authenticated using (user_id = (select auth.uid()) or private.is_dog_caretaker(dog_id));
create policy "dog_circle_invitations: caretakers read" on public.dog_circle_invitations
  for select to authenticated using (private.is_dog_caretaker(dog_id));

-- The circle as shown on the passport. Caretakers get everyone (caretakers,
-- members of the dog's groups, close people and guests); other viewers only
-- the caretakers.
create function public.dog_circle_list(p_dog_id uuid)
returns table (
  user_id uuid,
  display_name text,
  kind text,
  health_access text,
  emergency_access text,
  starts_at timestamptz,
  ends_at timestamptz,
  in_group boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_full boolean := private.is_dog_caretaker(p_dog_id);
begin
  if not private.can_view_dog(p_dog_id) then
    return;
  end if;
  return query
  with members as (
    select distinct gm.user_id
    from public.group_dogs gd
    join public.group_members gm on gm.group_id = gd.group_id
    where gd.dog_id = p_dog_id
  ),
  people as (
    select dc.user_id from public.dog_caretakers dc where dc.dog_id = p_dog_id
    union
    select m.user_id from members m where v_full
    union
    select c.user_id from public.dog_circle c where c.dog_id = p_dog_id and v_full
  )
  select
    p.user_id,
    private.display_name(p.user_id),
    case
      when dc.role = 'owner' then 'owner'
      when dc.role = 'caretaker' then 'co_owner'
      else coalesce(c.role, 'entourage')
    end,
    case when dc.user_id is not null then 'always' else coalesce(c.health_access, 'during_care') end,
    case when dc.user_id is not null then 'always' else coalesce(c.emergency_access, 'during_care') end,
    c.starts_at,
    c.ends_at,
    exists (select 1 from members m where m.user_id = p.user_id)
  from people p
  left join public.dog_caretakers dc on dc.dog_id = p_dog_id and dc.user_id = p.user_id
  left join public.dog_circle c on c.dog_id = p_dog_id and c.user_id = p.user_id
  order by
    case when dc.role = 'owner' then 0 when dc.role is not null then 1 when c.role = 'close' then 2 when c.role = 'guest' then 4 else 3 end,
    2;
end;
$$;

-- Dogs opened to the current user by the circle only (not as caretaker or group member)
create function public.my_circle_dogs()
returns table (dog_id uuid, name text, photo_path text, role text, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.name, d.photo_path, c.role, c.starts_at, c.ends_at
  from public.dog_circle c
  join public.dogs d on d.id = c.dog_id
  where c.user_id = (select auth.uid())
    and c.role in ('close', 'guest')
    and d.archived_at is null
    and (c.role = 'close' or c.ends_at > now())
    and not exists (select 1 from public.dog_caretakers dc where dc.dog_id = d.id and dc.user_id = c.user_id)
  order by d.name;
$$;

-- ---------------------------------------------------------------------------
-- Circle: changes (caretakers only)
-- ---------------------------------------------------------------------------
create function private.check_circle_settings(
  p_role text, p_health text, p_emergency text, p_starts timestamptz, p_ends timestamptz
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_role not in ('close', 'entourage', 'guest') then
    raise exception 'Rôle invalide.' using errcode = 'P0001';
  end if;
  if p_health not in ('always', 'during_care', 'never') or p_emergency not in ('always', 'during_care', 'never') then
    raise exception 'Accès invalide.' using errcode = 'P0001';
  end if;
  if p_role = 'guest' then
    if p_ends is null then
      raise exception 'Indiquez jusqu''à quand l''invité a accès.' using errcode = 'P0001';
    end if;
    if p_starts is not null and p_ends <= p_starts then
      raise exception 'La fin de l''accès doit être après son début.' using errcode = 'P0001';
    end if;
    if p_ends > now() + interval '1 year' then
      raise exception 'Un accès invité dure au plus un an.' using errcode = 'P0001';
    end if;
  end if;
end;
$$;

create function public.set_circle_member(
  p_dog_id uuid,
  p_user_id uuid,
  p_role text,
  p_health_access text,
  p_emergency_access text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_dog_caretaker(p_dog_id) then
    raise exception 'Seul un responsable du chien peut gérer son cercle.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.dog_caretakers dc where dc.dog_id = p_dog_id and dc.user_id = p_user_id) then
    raise exception 'Cette personne est déjà responsable du chien.' using errcode = 'P0001';
  end if;
  -- people outside the circle join it through an invitation, not by id
  if not exists (
    select 1 from public.group_dogs gd
    join public.group_members gm on gm.group_id = gd.group_id
    where gd.dog_id = p_dog_id and gm.user_id = p_user_id
  ) and not exists (
    select 1 from public.dog_circle c where c.dog_id = p_dog_id and c.user_id = p_user_id
  ) then
    raise exception 'Cette personne ne fait pas partie du cercle. Invitez-la avec un lien.' using errcode = 'P0001';
  end if;
  perform private.check_circle_settings(p_role, p_health_access, p_emergency_access, p_starts_at, p_ends_at);
  if p_role = 'entourage' and not exists (
    select 1 from public.group_dogs gd
    join public.group_members gm on gm.group_id = gd.group_id
    where gd.dog_id = p_dog_id and gm.user_id = p_user_id
  ) then
    raise exception 'Seuls les membres d''un groupe du chien font partie de son entourage.' using errcode = 'P0001';
  end if;

  insert into public.dog_circle as c (dog_id, user_id, role, health_access, emergency_access, starts_at, ends_at, added_by)
  values (
    p_dog_id, p_user_id, p_role, p_health_access, p_emergency_access,
    case when p_role = 'guest' then p_starts_at end,
    case when p_role = 'guest' then p_ends_at end,
    auth.uid()
  )
  on conflict (dog_id, user_id) do update set
    role = excluded.role,
    health_access = excluded.health_access,
    emergency_access = excluded.emergency_access,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    updated_at = now();
  perform private.audit('circle_member_set', null, p_dog_id,
    jsonb_build_object('user_id', p_user_id, 'role', p_role, 'health', p_health_access, 'emergency', p_emergency_access));
end;
$$;

-- Removes a person's settings: a group member goes back to "entourage",
-- someone outside the groups loses access.
create function public.remove_circle_member(p_dog_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_dog_caretaker(p_dog_id) then
    raise exception 'Seul un responsable du chien peut gérer son cercle.' using errcode = 'P0001';
  end if;
  delete from public.dog_circle where dog_id = p_dog_id and user_id = p_user_id;
  perform private.audit('circle_member_removed', null, p_dog_id, jsonb_build_object('user_id', p_user_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Circle invitations (single use, valid 7 days; only the hash is stored)
-- ---------------------------------------------------------------------------
create function public.create_circle_invitation(
  p_dog_id uuid,
  p_role text,
  p_health_access text,
  p_emergency_access text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not private.is_dog_caretaker(p_dog_id) then
    raise exception 'Seul un responsable du chien peut gérer son cercle.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.dogs d where d.id = p_dog_id and d.archived_at is not null) then
    raise exception 'Ce chien est archivé.' using errcode = 'P0001';
  end if;
  if p_role not in ('close', 'guest') then
    raise exception 'On invite un proche ou un invité.' using errcode = 'P0001';
  end if;
  if p_health_access not in ('always', 'never') or p_emergency_access not in ('always', 'never') then
    raise exception 'Accès invalide.' using errcode = 'P0001';
  end if;
  perform private.check_circle_settings(p_role, p_health_access, p_emergency_access, p_starts_at, p_ends_at);
  if p_role = 'guest' and p_ends_at <= now() then
    raise exception 'La fin de l''accès est déjà passée.' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.dog_circle_invitations i
    where i.dog_id = p_dog_id and i.revoked_at is null and i.used_at is null and i.expires_at > now()
  ) >= 10 then
    raise exception 'Trop d''invitations en attente. Révoquez-en une avant.' using errcode = 'P0001';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.dog_circle_invitations
    (dog_id, token_hash, role, health_access, emergency_access, starts_at, ends_at, created_by, expires_at)
  values (
    p_dog_id, private.hash_token(v_token), p_role, p_health_access, p_emergency_access,
    case when p_role = 'guest' then p_starts_at end,
    case when p_role = 'guest' then p_ends_at end,
    auth.uid(), now() + interval '7 days'
  );
  perform private.audit('circle_invitation_created', null, p_dog_id, jsonb_build_object('role', p_role));
  return v_token;
end;
$$;

create function public.revoke_circle_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dog_id uuid;
begin
  select dog_id into v_dog_id from public.dog_circle_invitations where id = p_invitation_id;
  if v_dog_id is null or not private.is_dog_caretaker(v_dog_id) then
    raise exception 'Invitation introuvable.' using errcode = 'P0001';
  end if;
  update public.dog_circle_invitations set revoked_at = now() where id = p_invitation_id and revoked_at is null;
  perform private.audit('circle_invitation_revoked', null, v_dog_id);
end;
$$;

-- Invitation preview for the person who opens the link (signed in)
create function public.get_circle_invitation(p_token text)
returns table (dog_id uuid, dog_name text, inviter_name text, role text, ends_at timestamptz, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.dog_circle_invitations;
  v_dog public.dogs;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return query select null::uuid, null::text, null::text, null::text, null::timestamptz, 'invalid'::text;
    return;
  end if;
  select * into v_inv from public.dog_circle_invitations i where i.token_hash = private.hash_token(p_token);
  if v_inv.id is null then
    return query select null::uuid, null::text, null::text, null::text, null::timestamptz, 'invalid'::text;
    return;
  end if;
  select * into v_dog from public.dogs d where d.id = v_inv.dog_id;
  return query select
    v_dog.id, v_dog.name, private.display_name(v_inv.created_by), v_inv.role, v_inv.ends_at,
    case
      when v_dog.archived_at is not null then 'invalid'
      when v_inv.used_by = auth.uid() then 'accepted'
      when v_inv.revoked_at is not null then 'revoked'
      when v_inv.used_at is not null then 'used'
      when v_inv.expires_at <= now() then 'expired'
      when v_inv.role = 'guest' and v_inv.ends_at <= now() then 'expired'
      else 'valid'
    end;
end;
$$;

create function public.accept_circle_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.dog_circle_invitations;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  select * into v_inv from public.dog_circle_invitations i
  where i.token_hash = private.hash_token(coalesce(p_token, ''))
  for update;
  if v_inv.id is null or exists (select 1 from public.dogs d where d.id = v_inv.dog_id and d.archived_at is not null) then
    raise exception 'Ce lien d''invitation n''est pas valide.' using errcode = 'P0001';
  end if;
  if v_inv.used_by = v_uid then
    return v_inv.dog_id;
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'Ce lien d''invitation a été révoqué.' using errcode = 'P0001';
  end if;
  if v_inv.used_at is not null then
    raise exception 'Ce lien d''invitation a déjà été utilisé.' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() or (v_inv.role = 'guest' and v_inv.ends_at <= now()) then
    raise exception 'Ce lien d''invitation a expiré. Demandez-en un nouveau.' using errcode = 'P0001';
  end if;

  update public.dog_circle_invitations set used_by = v_uid, used_at = now() where id = v_inv.id;
  -- a caretaker keeps full rights: nothing to add
  if not exists (select 1 from public.dog_caretakers dc where dc.dog_id = v_inv.dog_id and dc.user_id = v_uid) then
    insert into public.dog_circle as c (dog_id, user_id, role, health_access, emergency_access, starts_at, ends_at, added_by)
    values (v_inv.dog_id, v_uid, v_inv.role, v_inv.health_access, v_inv.emergency_access, v_inv.starts_at, v_inv.ends_at, v_inv.created_by)
    on conflict (dog_id, user_id) do update set
      role = excluded.role,
      health_access = excluded.health_access,
      emergency_access = excluded.emergency_access,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      updated_at = now();
  end if;
  perform private.audit('circle_invitation_accepted', null, v_inv.dog_id);
  return v_inv.dog_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function private.is_dog_group_member(uuid) from public, anon;
revoke all on function private.has_direct_circle_access(uuid) from public, anon;
revoke all on function private.dog_section_level(uuid, text) from public, anon;
revoke all on function private.has_live_care(uuid) from public, anon;
revoke all on function private.can_view_dog_section(uuid, text) from public, anon;
revoke all on function private.check_circle_settings(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
-- RLS helpers run as the caller
grant execute on function private.is_dog_group_member(uuid) to authenticated;
grant execute on function private.has_direct_circle_access(uuid) to authenticated;
grant execute on function private.dog_section_level(uuid, text) to authenticated;
grant execute on function private.has_live_care(uuid) to authenticated;
grant execute on function private.can_view_dog_section(uuid, text) to authenticated;

revoke all on function public.dog_section_access(uuid) from public, anon;
revoke all on function public.dog_circle_list(uuid) from public, anon;
revoke all on function public.my_circle_dogs() from public, anon;
revoke all on function public.set_circle_member(uuid, uuid, text, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.remove_circle_member(uuid, uuid) from public, anon;
revoke all on function public.create_circle_invitation(uuid, text, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.revoke_circle_invitation(uuid) from public, anon;
revoke all on function public.get_circle_invitation(text) from public, anon;
revoke all on function public.accept_circle_invitation(text) from public, anon;
grant execute on function public.dog_section_access(uuid) to authenticated;
grant execute on function public.dog_circle_list(uuid) to authenticated;
grant execute on function public.my_circle_dogs() to authenticated;
grant execute on function public.set_circle_member(uuid, uuid, text, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.remove_circle_member(uuid, uuid) to authenticated;
grant execute on function public.create_circle_invitation(uuid, text, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.revoke_circle_invitation(uuid) to authenticated;
grant execute on function public.get_circle_invitation(text) to authenticated;
grant execute on function public.accept_circle_invitation(text) to authenticated;
