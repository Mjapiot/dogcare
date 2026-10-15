-- Dogcare — core schema
-- Conventions:
--   * every instant is timestamptz; periods are half-open [starts_at, ends_at)
--   * local dates/slots (availability) are interpreted in Europe/Paris
--   * RLS is enabled on every table; privileged logic lives in the "private"
--     schema (not exposed by the API) or in explicit RPCs below.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'member');
create type public.caretaker_role as enum ('owner', 'caretaker');
create type public.slot_key as enum ('morning', 'afternoon', 'evening', 'night');
create type public.availability_status as enum ('available', 'unavailable');
create type public.request_type as enum ('alone_info', 'visit', 'care', 'partial_care');
create type public.necessity_level as enum ('info', 'nice_to_have', 'required');
create type public.request_lifecycle as enum ('active', 'cancelled');
create type public.response_status as enum ('yes', 'no');
create type public.assignment_status as enum ('confirmed', 'pending_reconfirmation', 'cancelled');
create type public.notification_type as enum (
  'new_request',
  'new_volunteer',
  'assignment_confirmed',
  'assignment_cancelled',
  'reconfirmation_needed',
  'request_updated',
  'request_cancelled',
  'response_reset',
  'member_joined'
);

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  avatar_path text,
  timezone text not null default 'Europe/Paris',
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 40))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Groups, members, invitations
-- ---------------------------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger groups_touch before update on public.groups
  for each row execute function private.touch_updated_at();

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'member',
  share_availability boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_idx on public.group_members (user_id);

create table public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  max_uses integer not null default 10 check (max_uses between 1 and 50),
  use_count integer not null default 0 check (use_count >= 0),
  created_at timestamptz not null default now(),
  check (use_count <= max_uses)
);

create index group_invitations_group_idx on public.group_invitations (group_id);

-- ---------------------------------------------------------------------------
-- Dogs
-- ---------------------------------------------------------------------------
create table public.dogs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  breed text check (char_length(breed) <= 60),
  birth_date date,
  photo_path text check (char_length(photo_path) <= 300),
  care_notes text check (char_length(care_notes) <= 2000),
  special_needs text check (char_length(special_needs) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create trigger dogs_touch before update on public.dogs
  for each row execute function private.touch_updated_at();

create table public.dog_caretakers (
  dog_id uuid not null references public.dogs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.caretaker_role not null default 'caretaker',
  added_at timestamptz not null default now(),
  primary key (dog_id, user_id)
);

create index dog_caretakers_user_idx on public.dog_caretakers (user_id);

create table public.group_dogs (
  group_id uuid not null references public.groups (id) on delete cascade,
  dog_id uuid not null references public.dogs (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, dog_id)
);

create index group_dogs_dog_idx on public.group_dogs (dog_id);

-- ---------------------------------------------------------------------------
-- Availability (per user; shared with groups where share_availability = true)
-- ---------------------------------------------------------------------------
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  slot public.slot_key not null,
  status public.availability_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, weekday, slot)
);

create trigger availability_rules_touch before update on public.availability_rules
  for each row execute function private.touch_updated_at();

create table public.availability_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  slot public.slot_key not null,
  status public.availability_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date, slot)
);

create trigger availability_entries_touch before update on public.availability_entries
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Care requests, responses, assignments
-- ---------------------------------------------------------------------------
create table public.care_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  dog_id uuid not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  request_type public.request_type not null,
  necessity public.necessity_level not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  description text check (char_length(description) <= 1000),
  splittable boolean not null default true,
  lifecycle_status public.request_lifecycle not null default 'active',
  cancelled_at timestamptz,
  cancellation_reason text check (char_length(cancellation_reason) <= 500),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the dog must be visible in the group the request is posted to
  foreign key (group_id, dog_id) references public.group_dogs (group_id, dog_id),
  constraint care_requests_period_valid check (ends_at > starts_at),
  constraint care_requests_period_max check (ends_at - starts_at <= interval '31 days'),
  constraint care_requests_info_type check (request_type <> 'alone_info' or necessity = 'info')
);

create index care_requests_group_period_idx on public.care_requests (group_id, starts_at, ends_at);
create index care_requests_dog_idx on public.care_requests (dog_id);
create index care_requests_created_by_idx on public.care_requests (created_by);

create table public.request_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.care_requests (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  response_status public.response_status not null,
  proposed_starts_at timestamptz,
  proposed_ends_at timestamptz,
  note text check (char_length(note) <= 500),
  responded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, user_id),
  check ((proposed_starts_at is null) = (proposed_ends_at is null)),
  check (proposed_ends_at is null or proposed_ends_at > proposed_starts_at)
);

create index request_responses_user_idx on public.request_responses (user_id);

create table public.care_assignments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.care_requests (id) on delete cascade,
  assigned_user_id uuid not null references auth.users (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.assignment_status not null default 'confirmed',
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancellation_reason text check (char_length(cancellation_reason) <= 500),
  previous_starts_at timestamptz,
  previous_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Two live assignments of the same request can never overlap: prevents
  -- concurrent, incompatible confirmations of the same slot.
  constraint care_assignments_no_overlap exclude using gist (
    request_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled')
);

create index care_assignments_request_idx on public.care_assignments (request_id);
create index care_assignments_user_idx on public.care_assignments (assigned_user_id, starts_at);

create trigger care_assignments_touch before update on public.care_assignments
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  notification_type public.notification_type not null,
  title text not null,
  body text,
  request_id uuid references public.care_requests (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.notification_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  new_requests_enabled boolean not null default true,
  responses_enabled boolean not null default true,
  confirmations_enabled boolean not null default true,
  cancellations_enabled boolean not null default true,
  reminders_enabled boolean not null default true,
  summary_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_touch before update on public.notification_preferences
  for each row execute function private.touch_updated_at();

-- Prepared for Web Push (phase 2). Not used by the MVP yet.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Minimal audit trail of critical events. No client access at all.
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  event_type text not null,
  group_id uuid,
  entity_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
