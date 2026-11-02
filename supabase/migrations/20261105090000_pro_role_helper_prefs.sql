-- Dogcare — "Professionnel" circle role and per-person garde preferences
-- - "pro": a paid pet-sitter in the dog's circle, invited by link, kept
--   until removed (like a close person); health and emergency default to
--   "during their gardes". Proposed first for holes in a plan.
-- - Since circle people can now have gardes, "during their gardes" is
--   offered for every circle person, invitations included.
-- - dog_helper_prefs: what the dog's caretakers set for one person: where
--   the dog stays (at the person's or at the owner's), the maximum
--   consecutive nights there (0 = never at night), and a short note
--   ("ils ont un chat"). Caretakers only.

-- ---------------------------------------------------------------------------
-- Role "pro"
-- ---------------------------------------------------------------------------
alter table public.dog_circle drop constraint dog_circle_role_check;
alter table public.dog_circle add constraint dog_circle_role_check check (role in ('close', 'entourage', 'guest', 'pro'));

alter table public.dog_circle_invitations drop constraint dog_circle_invitations_role_check;
alter table public.dog_circle_invitations add constraint dog_circle_invitations_role_check check (role in ('close', 'guest', 'pro'));
alter table public.dog_circle_invitations drop constraint dog_circle_invitations_health_access_check;
alter table public.dog_circle_invitations
  add constraint dog_circle_invitations_health_access_check check (health_access in ('always', 'during_care', 'never'));
alter table public.dog_circle_invitations drop constraint dog_circle_invitations_emergency_access_check;
alter table public.dog_circle_invitations
  add constraint dog_circle_invitations_emergency_access_check check (emergency_access in ('always', 'during_care', 'never'));

-- a close person or a pro opens the dog by itself; a guest within its dates
create or replace function private.has_direct_circle_access(p_dog_id uuid)
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
        c.role in ('close', 'pro')
        or (c.role = 'guest' and (c.starts_at is null or c.starts_at <= now()) and c.ends_at > now())
      )
  );
$$;

create or replace function private.circle_covers(p_dog_id uuid, p_user_id uuid, p_starts timestamptz, p_ends timestamptz)
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
        c.role in ('close', 'pro')
        or (c.role = 'guest' and (c.starts_at is null or c.starts_at <= p_starts) and c.ends_at >= p_ends)
      )
  );
$$;

create or replace function public.my_circle_dogs()
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
    and c.role in ('close', 'guest', 'pro')
    and d.archived_at is null
    and (c.role <> 'guest' or c.ends_at > now())
    and not exists (select 1 from public.dog_caretakers dc where dc.dog_id = d.id and dc.user_id = c.user_id)
  order by d.name;
$$;

create or replace function private.check_circle_settings(
  p_role text, p_health text, p_emergency text, p_starts timestamptz, p_ends timestamptz
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_role not in ('close', 'entourage', 'guest', 'pro') then
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

create or replace function public.create_circle_invitation(
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
  if p_role not in ('close', 'guest', 'pro') then
    raise exception 'On invite un proche, un invité ou un professionnel.' using errcode = 'P0001';
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

create or replace function public.request_invitee_candidates(p_group_id uuid)
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
    and c.role in ('close', 'guest', 'pro')
    and (c.role <> 'guest' or c.ends_at > now())
    and not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = c.user_id)
    and not exists (select 1 from public.dog_caretakers dc where dc.dog_id = c.dog_id and dc.user_id = c.user_id)
  order by 3;
$$;

-- "Professionnel · santé : pendant vos gardes · …" in circle notifications
create or replace function private.circle_access_text(
  p_role text, p_health text, p_emergency text, p_ends timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select case p_role when 'close' then 'Proche' when 'guest' then 'Invité' when 'pro' then 'Professionnel' else 'Entourage' end
    || ' · santé : ' || case p_health when 'always' then 'toujours' when 'during_care' then 'pendant vos gardes' else 'non' end
    || ' · urgences : ' || case p_emergency when 'always' then 'toujours' when 'during_care' then 'pendant vos gardes' else 'non' end
    || coalesce(' · jusqu''au ' || to_char((p_ends - interval '1 second') at time zone 'Europe/Paris', 'DD/MM'), '');
$$;

-- ---------------------------------------------------------------------------
-- Per-person garde preferences (set by the dog's caretakers)
-- ---------------------------------------------------------------------------
create table public.dog_helper_prefs (
  dog_id uuid not null references public.dogs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'helper': at the person's; 'owner': at the owner's
  place text not null default 'helper' check (place in ('helper', 'owner')),
  -- null: the dog's rule; 0: never at night
  max_nights smallint check (max_nights between 0 and 14),
  note text check (char_length(note) <= 140),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (dog_id, user_id)
);

create index dog_helper_prefs_user_idx on public.dog_helper_prefs (user_id);
create index dog_helper_prefs_updated_by_idx on public.dog_helper_prefs (updated_by);

alter table public.dog_helper_prefs enable row level security;
revoke all on public.dog_helper_prefs from anon, authenticated;
grant select on public.dog_helper_prefs to authenticated;
create policy "dog_helper_prefs: caretakers read" on public.dog_helper_prefs
  for select to authenticated using (private.is_dog_caretaker(dog_id));

create function public.set_helper_pref(p_dog_id uuid, p_user_id uuid, p_place text, p_max_nights integer, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.is_dog_caretaker(p_dog_id) then
    raise exception 'Seul un responsable du chien peut régler ses gardes.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.dog_caretakers dc where dc.dog_id = p_dog_id and dc.user_id = p_user_id) then
    raise exception 'Un responsable du chien n''a pas de préférences de garde.' using errcode = 'P0001';
  end if;
  -- someone of the dog's groups or of its circle
  if not exists (
    select 1 from public.group_dogs gd join public.group_members gm on gm.group_id = gd.group_id
    where gd.dog_id = p_dog_id and gm.user_id = p_user_id
  ) and not exists (select 1 from public.dog_circle c where c.dog_id = p_dog_id and c.user_id = p_user_id) then
    raise exception 'Cette personne ne fait pas partie de l''entourage du chien.' using errcode = 'P0001';
  end if;
  if p_place not in ('helper', 'owner') then
    raise exception 'Lieu de garde invalide.' using errcode = 'P0001';
  end if;
  if p_max_nights is not null and (p_max_nights < 0 or p_max_nights > 14) then
    raise exception 'Nombre de nuits invalide.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(v_note, '')) > 140 then
    raise exception '140 caractères maximum.' using errcode = 'P0001';
  end if;

  insert into public.dog_helper_prefs as p (dog_id, user_id, place, max_nights, note, updated_by)
  values (p_dog_id, p_user_id, p_place, p_max_nights, v_note, auth.uid())
  on conflict (dog_id, user_id) do update set
    place = excluded.place, max_nights = excluded.max_nights, note = excluded.note,
    updated_by = excluded.updated_by, updated_at = now();
end;
$$;

revoke all on function public.set_helper_pref(uuid, uuid, text, integer, text) from public, anon;
grant execute on function public.set_helper_pref(uuid, uuid, text, integer, text) to authenticated;
