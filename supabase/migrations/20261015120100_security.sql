-- Dogcare — access helpers, Row Level Security and privileges
-- Helpers are SECURITY DEFINER to avoid recursive policies, live in the
-- non-exposed "private" schema, and only ever answer about the current user.

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
create function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = (select auth.uid())
  );
$$;

create function private.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = (select auth.uid()) and role = 'admin'
  );
$$;

create function private.is_dog_caretaker(p_dog_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dog_caretakers
    where dog_id = p_dog_id and user_id = (select auth.uid())
  );
$$;

create function private.can_view_dog(p_dog_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dog_caretakers
    where dog_id = p_dog_id and user_id = (select auth.uid())
  ) or exists (
    select 1
    from public.group_dogs gd
    join public.group_members gm on gm.group_id = gd.group_id
    where gd.dog_id = p_dog_id and gm.user_id = (select auth.uid())
  );
$$;

create function private.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members me
    join public.group_members other on other.group_id = me.group_id
    where me.user_id = (select auth.uid()) and other.user_id = p_user_id
  );
$$;

-- Availability is visible to members of groups where its owner shares it.
create function private.can_view_availability_of(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id = (select auth.uid()) or exists (
    select 1
    from public.group_members me
    join public.group_members owner on owner.group_id = me.group_id
    where me.user_id = (select auth.uid())
      and owner.user_id = p_user_id
      and owner.share_availability
  );
$$;

create function private.can_access_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.care_requests r
    join public.group_members gm on gm.group_id = r.group_id
    where r.id = p_request_id and gm.user_id = (select auth.uid())
  );
$$;

-- A member can answer an active, future, non-informational request of their
-- group, unless they are one of the dog's caretakers.
create function private.can_respond(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.care_requests r
    join public.group_members gm on gm.group_id = r.group_id and gm.user_id = (select auth.uid())
    where r.id = p_request_id
      and r.lifecycle_status = 'active'
      and r.necessity <> 'info'
      and r.ends_at > now()
      and not exists (
        select 1 from public.dog_caretakers dc
        where dc.dog_id = r.dog_id and dc.user_id = (select auth.uid())
      )
  );
$$;

create function private.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invitations enable row level security;
alter table public.dogs enable row level security;
alter table public.dog_caretakers enable row level security;
alter table public.group_dogs enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_entries enable row level security;
alter table public.care_requests enable row level security;
alter table public.request_responses enable row level security;
alter table public.care_assignments enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.audit_events enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges: anon gets nothing; writes are limited to the columns a
-- user may legitimately change. Everything else goes through RPCs.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
revoke select on public.audit_events from authenticated;

grant update (display_name, avatar_path, timezone, onboarded_at) on public.profiles to authenticated;
grant update (name) on public.groups to authenticated;
grant delete on public.groups to authenticated;
grant update (share_availability) on public.group_members to authenticated;
grant delete on public.group_members to authenticated;
grant update (name, breed, birth_date, photo_path, care_notes, special_needs, archived_at) on public.dogs to authenticated;
grant delete on public.dog_caretakers to authenticated;
grant insert, delete on public.group_dogs to authenticated;
grant insert, update, delete on public.availability_rules to authenticated;
grant insert, update, delete on public.availability_entries to authenticated;
grant insert (group_id, dog_id, request_type, necessity, starts_at, ends_at, description, splittable)
  on public.care_requests to authenticated;
grant update (request_type, necessity, starts_at, ends_at, description, splittable, lifecycle_status, cancellation_reason)
  on public.care_requests to authenticated;
grant insert (request_id, response_status, proposed_starts_at, proposed_ends_at, note)
  on public.request_responses to authenticated;
grant update (request_id, response_status, proposed_starts_at, proposed_ends_at, note)
  on public.request_responses to authenticated;
grant update (read_at), delete on public.notifications to authenticated;
grant insert, update on public.notification_preferences to authenticated;
grant insert, update, delete on public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- profiles
create policy "profiles: read self and group mates" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_group_with(id));
create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- groups
create policy "groups: members read" on public.groups
  for select to authenticated using (private.is_group_member(id));
create policy "groups: admins rename" on public.groups
  for update to authenticated
  using (private.is_group_admin(id)) with check (private.is_group_admin(id));
create policy "groups: admins delete" on public.groups
  for delete to authenticated using (private.is_group_admin(id));

-- group_members
create policy "group_members: members read" on public.group_members
  for select to authenticated using (private.is_group_member(group_id));
create policy "group_members: update own sharing" on public.group_members
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "group_members: leave or admin removes" on public.group_members
  for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_group_admin(group_id));

-- group_invitations (writes through RPCs only)
create policy "group_invitations: admins read" on public.group_invitations
  for select to authenticated using (private.is_group_admin(group_id));

-- dogs (creation through RPC)
create policy "dogs: visible to caretakers and group members" on public.dogs
  for select to authenticated using (private.can_view_dog(id));
create policy "dogs: caretakers update" on public.dogs
  for update to authenticated
  using (private.is_dog_caretaker(id)) with check (private.is_dog_caretaker(id));

-- dog_caretakers (additions through RPC)
create policy "dog_caretakers: visible with the dog" on public.dog_caretakers
  for select to authenticated using (private.can_view_dog(dog_id));
create policy "dog_caretakers: caretakers remove" on public.dog_caretakers
  for delete to authenticated using (private.is_dog_caretaker(dog_id));

-- group_dogs
create policy "group_dogs: members read" on public.group_dogs
  for select to authenticated using (private.is_group_member(group_id));
create policy "group_dogs: caretakers share into their groups" on public.group_dogs
  for insert to authenticated
  with check (private.is_dog_caretaker(dog_id) and private.is_group_member(group_id));
create policy "group_dogs: caretakers or admins unshare" on public.group_dogs
  for delete to authenticated
  using (private.is_dog_caretaker(dog_id) or private.is_group_admin(group_id));

-- availability
create policy "availability_rules: read shared" on public.availability_rules
  for select to authenticated using (private.can_view_availability_of(user_id));
create policy "availability_rules: insert own" on public.availability_rules
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "availability_rules: update own" on public.availability_rules
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "availability_rules: delete own" on public.availability_rules
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "availability_entries: read shared" on public.availability_entries
  for select to authenticated using (private.can_view_availability_of(user_id));
create policy "availability_entries: insert own" on public.availability_entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "availability_entries: update own" on public.availability_entries
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "availability_entries: delete own" on public.availability_entries
  for delete to authenticated using (user_id = (select auth.uid()));

-- care_requests
create policy "care_requests: members read" on public.care_requests
  for select to authenticated using (private.is_group_member(group_id));
create policy "care_requests: caretakers create" on public.care_requests
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_group_member(group_id)
    and private.is_dog_caretaker(dog_id)
  );
create policy "care_requests: caretakers update" on public.care_requests
  for update to authenticated
  using (private.is_dog_caretaker(dog_id) and private.is_group_member(group_id))
  with check (private.is_dog_caretaker(dog_id) and private.is_group_member(group_id));

-- request_responses
create policy "request_responses: members read" on public.request_responses
  for select to authenticated using (private.can_access_request(request_id));
create policy "request_responses: answer for oneself" on public.request_responses
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_respond(request_id));
create policy "request_responses: update own answer" on public.request_responses
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.can_respond(request_id));

-- care_assignments (writes through RPCs only)
create policy "care_assignments: members read" on public.care_assignments
  for select to authenticated using (private.can_access_request(request_id));

-- notifications
create policy "notifications: read own" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: mark own read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: delete own" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

-- notification_preferences
create policy "notification_preferences: read own" on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notification_preferences: insert own" on public.notification_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "notification_preferences: update own" on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- push_subscriptions
create policy "push_subscriptions: read own" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "push_subscriptions: insert own" on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "push_subscriptions: update own" on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "push_subscriptions: delete own" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

-- audit_events: RLS enabled with no policy = no client access.
