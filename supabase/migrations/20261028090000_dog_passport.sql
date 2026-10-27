-- Dogcare — digital passport
-- A dog's passport has four sections:
-- - identity and habits: columns of public.dogs, visible like the dog itself;
-- - health and emergency: separate tables, visible only to the dog's
--   caretakers and to members with a live assignment for it (from 7 days
--   before until its end). Keeping them apart lets a future "circle of
--   trust" grant access section by section.
-- Caretakers can share the passport through a temporary secret link
-- (only its SHA-256 hash is stored), choosing whether health and emergency
-- are included. The link opens a read-only page without an account.

-- ---------------------------------------------------------------------------
-- Identity and habits
-- ---------------------------------------------------------------------------
alter table public.dogs
  add column sex text check (sex in ('female', 'male')),
  add column sterilized boolean,
  add column weight_kg numeric(4, 1) check (weight_kg > 0 and weight_kg < 150),
  add column identification text check (char_length(identification) <= 30),
  add column distinctive_marks text check (char_length(distinctive_marks) <= 300),
  add column meals text check (char_length(meals) <= 500),
  add column walks text check (char_length(walks) <= 500),
  add column sleep text check (char_length(sleep) <= 500),
  add column behavior text check (char_length(behavior) <= 1000);

grant update (sex, sterilized, weight_kg, identification, distinctive_marks, meals, walks, sleep, behavior)
  on public.dogs to authenticated;

-- ---------------------------------------------------------------------------
-- Health and emergency
-- ---------------------------------------------------------------------------
create table public.dog_health (
  dog_id uuid primary key references public.dogs (id) on delete cascade,
  allergies text check (char_length(allergies) <= 500),
  treatments text check (char_length(treatments) <= 1000),
  vet_name text check (char_length(vet_name) <= 80),
  vet_clinic text check (char_length(vet_clinic) <= 80),
  vet_phone text check (vet_phone ~ '^[0-9+() .-]{4,30}$'),
  vet_address text check (char_length(vet_address) <= 200),
  notes text check (char_length(notes) <= 1000),
  updated_at timestamptz not null default now()
);

-- [{ "name": "…", "relation": "…", "phone": "…" }], at most 5
create function private.valid_emergency_contacts(p_contacts jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_contacts) = 'array'
    and jsonb_array_length(p_contacts) <= 5
    and not exists (
      select 1 from jsonb_array_elements(p_contacts) c
      where jsonb_typeof(c) <> 'object'
         or (select count(*) from jsonb_object_keys(c) k where k not in ('name', 'relation', 'phone')) > 0
         or jsonb_typeof(c -> 'name') is distinct from 'string'
         or char_length(btrim(c ->> 'name')) not between 1 and 60
         or (c ? 'relation' and (jsonb_typeof(c -> 'relation') <> 'string' or char_length(c ->> 'relation') > 40))
         or jsonb_typeof(c -> 'phone') is distinct from 'string'
         or (c ->> 'phone') !~ '^[0-9+() .-]{4,30}$'
    );
$$;

create table public.dog_emergency (
  dog_id uuid primary key references public.dogs (id) on delete cascade,
  contacts jsonb not null default '[]'::jsonb check (private.valid_emergency_contacts(contacts)),
  instructions text check (char_length(instructions) <= 1000),
  updated_at timestamptz not null default now()
);

-- The current user may read a dog's health and emergency sections
create function private.can_view_dog_private(p_dog_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_dog_caretaker(p_dog_id) or exists (
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

alter table public.dog_health enable row level security;
alter table public.dog_emergency enable row level security;
revoke all on public.dog_health, public.dog_emergency from anon, authenticated;
grant select on public.dog_health, public.dog_emergency to authenticated;
-- writes go through save_dog_health / save_dog_emergency
create policy "dog_health: caretakers and live sitters read" on public.dog_health
  for select to authenticated using (private.can_view_dog_private(dog_id));
create policy "dog_emergency: caretakers and live sitters read" on public.dog_emergency
  for select to authenticated using (private.can_view_dog_private(dog_id));

-- For the UI: whether the current user may see the private sections
create function public.can_view_dog_private(p_dog_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_view_dog_private(p_dog_id);
$$;

create function public.save_dog_health(
  p_dog_id uuid,
  p_allergies text,
  p_treatments text,
  p_vet_name text,
  p_vet_clinic text,
  p_vet_phone text,
  p_vet_address text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_dog_caretaker(p_dog_id) then
    raise exception 'Seul un responsable du chien peut modifier sa fiche.' using errcode = 'P0001';
  end if;
  insert into public.dog_health as h (dog_id, allergies, treatments, vet_name, vet_clinic, vet_phone, vet_address, notes)
  values (
    p_dog_id,
    nullif(btrim(p_allergies), ''),
    nullif(btrim(p_treatments), ''),
    nullif(btrim(p_vet_name), ''),
    nullif(btrim(p_vet_clinic), ''),
    nullif(btrim(p_vet_phone), ''),
    nullif(btrim(p_vet_address), ''),
    nullif(btrim(p_notes), '')
  )
  on conflict (dog_id) do update set
    allergies = excluded.allergies,
    treatments = excluded.treatments,
    vet_name = excluded.vet_name,
    vet_clinic = excluded.vet_clinic,
    vet_phone = excluded.vet_phone,
    vet_address = excluded.vet_address,
    notes = excluded.notes,
    updated_at = now();
end;
$$;

create function public.save_dog_emergency(p_dog_id uuid, p_contacts jsonb, p_instructions text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_dog_caretaker(p_dog_id) then
    raise exception 'Seul un responsable du chien peut modifier sa fiche.' using errcode = 'P0001';
  end if;
  if p_contacts is null or not private.valid_emergency_contacts(p_contacts) then
    raise exception 'Contacts d''urgence invalides.' using errcode = 'P0001';
  end if;
  insert into public.dog_emergency as e (dog_id, contacts, instructions)
  values (p_dog_id, p_contacts, nullif(btrim(p_instructions), ''))
  on conflict (dog_id) do update set
    contacts = excluded.contacts,
    instructions = excluded.instructions,
    updated_at = now();
end;
$$;

-- "Besoins particuliers" now belong to the health section (no longer visible
-- to every group member). The column stays, unused, for older deployments.
insert into public.dog_health (dog_id, notes)
select id, special_needs from public.dogs where special_needs is not null and btrim(special_needs) <> ''
on conflict (dog_id) do nothing;
update public.dogs set special_needs = null where special_needs is not null;

-- ---------------------------------------------------------------------------
-- Share links
-- ---------------------------------------------------------------------------
create table public.dog_share_links (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references public.dogs (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  include_health boolean not null default false,
  include_emergency boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index dog_share_links_dog_idx on public.dog_share_links (dog_id);
create index dog_share_links_created_by_idx on public.dog_share_links (created_by);

alter table public.dog_share_links enable row level security;
revoke all on public.dog_share_links from anon, authenticated;
grant select on public.dog_share_links to authenticated;
-- caretakers see the dog's links (never the token); writes through RPCs
create policy "dog_share_links: caretakers read" on public.dog_share_links
  for select to authenticated using (private.is_dog_caretaker(dog_id));

-- Returns the raw token once. Only its SHA-256 hash is stored.
create function public.create_dog_share_link(
  p_dog_id uuid,
  p_expires_in_hours integer,
  p_include_health boolean default false,
  p_include_emergency boolean default false
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
    raise exception 'Seul un responsable du chien peut partager sa fiche.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.dogs d where d.id = p_dog_id and d.archived_at is not null) then
    raise exception 'Ce chien est archivé.' using errcode = 'P0001';
  end if;
  if p_expires_in_hours is null or p_expires_in_hours not between 1 and 720 then
    raise exception 'La durée de validité doit être comprise entre 1 heure et 30 jours.' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.dog_share_links l
    where l.dog_id = p_dog_id and l.revoked_at is null and l.expires_at > now()
  ) >= 10 then
    raise exception 'Trop de liens actifs. Révoquez-en un avant.' using errcode = 'P0001';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.dog_share_links (dog_id, token_hash, created_by, include_health, include_emergency, expires_at)
  values (
    p_dog_id, private.hash_token(v_token), auth.uid(),
    coalesce(p_include_health, false), coalesce(p_include_emergency, false),
    now() + make_interval(hours => p_expires_in_hours)
  );
  perform private.audit('passport_shared', null, p_dog_id,
    jsonb_build_object('expires_in_hours', p_expires_in_hours, 'health', p_include_health, 'emergency', p_include_emergency));
  return v_token;
end;
$$;

create function public.revoke_dog_share_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dog_id uuid;
begin
  select dog_id into v_dog_id from public.dog_share_links where id = p_link_id;
  if v_dog_id is null or not private.is_dog_caretaker(v_dog_id) then
    raise exception 'Lien introuvable.' using errcode = 'P0001';
  end if;
  update public.dog_share_links set revoked_at = now() where id = p_link_id and revoked_at is null;
  perform private.audit('passport_share_revoked', null, v_dog_id);
end;
$$;

-- Public page (no session): the shared sections, or null when the link is
-- unknown, expired, revoked or the dog archived. Each call counts a view.
create function public.shared_passport(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_link public.dog_share_links;
  v_dog public.dogs;
  v_health public.dog_health;
  v_emergency public.dog_emergency;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  select * into v_link from public.dog_share_links l
  where l.token_hash = private.hash_token(p_token) and l.revoked_at is null and l.expires_at > now();
  if v_link.id is null then
    return null;
  end if;
  select * into v_dog from public.dogs d where d.id = v_link.dog_id and d.archived_at is null;
  if v_dog.id is null then
    return null;
  end if;

  update public.dog_share_links
  set view_count = view_count + 1, last_viewed_at = now()
  where id = v_link.id;

  if v_link.include_health then
    select * into v_health from public.dog_health h where h.dog_id = v_dog.id;
  end if;
  if v_link.include_emergency then
    select * into v_emergency from public.dog_emergency e where e.dog_id = v_dog.id;
  end if;

  return jsonb_build_object(
    'expires_at', v_link.expires_at,
    'dog', jsonb_build_object(
      'name', v_dog.name,
      'breed', v_dog.breed,
      'birth_date', v_dog.birth_date,
      'photo_path', v_dog.photo_path,
      'sex', v_dog.sex,
      'sterilized', v_dog.sterilized,
      'weight_kg', v_dog.weight_kg,
      'identification', v_dog.identification,
      'distinctive_marks', v_dog.distinctive_marks,
      'meals', v_dog.meals,
      'walks', v_dog.walks,
      'sleep', v_dog.sleep,
      'behavior', v_dog.behavior,
      'care_notes', v_dog.care_notes
    ),
    'health', case when v_link.include_health then jsonb_build_object(
      'allergies', v_health.allergies,
      'treatments', v_health.treatments,
      'vet_name', v_health.vet_name,
      'vet_clinic', v_health.vet_clinic,
      'vet_phone', v_health.vet_phone,
      'vet_address', v_health.vet_address,
      'notes', v_health.notes
    ) end,
    'emergency', case when v_link.include_emergency then jsonb_build_object(
      'contacts', coalesce(v_emergency.contacts, '[]'::jsonb),
      'instructions', v_emergency.instructions
    ) end
  );
end;
$$;

-- The public page signs the dog's current photo while a link is live
create function private.dog_photo_shared(p_name text)
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
      and d.archived_at is null
      and l.revoked_at is null
      and l.expires_at > now()
  );
$$;

grant usage on schema private to anon;
create policy "dog-photos: read while shared" on storage.objects
  for select to anon
  using (bucket_id = 'dog-photos' and private.dog_photo_shared(name));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function private.valid_emergency_contacts(jsonb) from public, anon, authenticated;
revoke all on function private.can_view_dog_private(uuid) from public, anon;
revoke all on function private.dog_photo_shared(text) from public, authenticated;
-- RLS helpers run as the caller
grant execute on function private.can_view_dog_private(uuid) to authenticated;
grant execute on function private.dog_photo_shared(text) to anon;

revoke all on function public.can_view_dog_private(uuid) from public, anon;
revoke all on function public.save_dog_health(uuid, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.save_dog_emergency(uuid, jsonb, text) from public, anon;
revoke all on function public.create_dog_share_link(uuid, integer, boolean, boolean) from public, anon;
revoke all on function public.revoke_dog_share_link(uuid) from public, anon;
revoke all on function public.shared_passport(text) from public;
grant execute on function public.can_view_dog_private(uuid) to authenticated;
grant execute on function public.save_dog_health(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.save_dog_emergency(uuid, jsonb, text) to authenticated;
grant execute on function public.create_dog_share_link(uuid, integer, boolean, boolean) to authenticated;
grant execute on function public.revoke_dog_share_link(uuid) to authenticated;
-- called by the public page with the publishable key (no session)
grant execute on function public.shared_passport(text) to anon, authenticated;
