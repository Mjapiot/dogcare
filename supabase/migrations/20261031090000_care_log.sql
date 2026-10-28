-- Dogcare — care log ("carnet de garde")
-- During a confirmed garde, its helper notes what happens: meal, walk,
-- medication, drop-off, pick-up, a photo or a note.
-- - Only the helper of a confirmed assignment writes, from 2 hours before it
--   starts until 24 hours after it ends; they edit or delete their own
--   entries during that window only.
-- - The helper and the dog's caretakers read it (not the rest of the group).
-- - Drop-off, pick-up and photos notify the caretakers ("care_log", which
--   they can switch off for push); other entries stay in the app.
-- - Photos live in a private bucket, readable by those who read the log;
--   they are deleted 90 days after the garde ends (the text stays).
-- - Caretakers can report an entry.

alter type public.notification_type add value if not exists 'care_log';

alter table public.notification_preferences
  add column care_log_enabled boolean not null default true;

create table public.care_log_entries (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.care_assignments (id) on delete cascade,
  request_id uuid not null references public.care_requests (id) on delete cascade,
  dog_id uuid not null references public.dogs (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('meal', 'walk', 'medication', 'drop_off', 'pick_up', 'photo', 'note')),
  occurred_at timestamptz not null,
  note text check (char_length(note) <= 500),
  photo_path text,
  photo_removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'note' or note is not null),
  check (kind <> 'photo' or photo_path is not null or photo_removed_at is not null)
);

create index care_log_entries_assignment_idx on public.care_log_entries (assignment_id, occurred_at);
create index care_log_entries_request_idx on public.care_log_entries (request_id, occurred_at);
create index care_log_entries_dog_idx on public.care_log_entries (dog_id);
create index care_log_entries_author_idx on public.care_log_entries (author_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The current user may write in this assignment's log right now
create function private.care_log_open(p_assignment_id uuid)
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
    where a.id = p_assignment_id
      and a.assigned_user_id = (select auth.uid())
      and a.status = 'confirmed'
      and r.lifecycle_status = 'active'
      and now() >= a.starts_at - interval '2 hours'
      and now() < a.ends_at + interval '24 hours'
  );
$$;

-- The current user may read this assignment's log: its helper or a caretaker of the dog
create function private.can_read_care_log(p_assignment_id uuid)
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
    where a.id = p_assignment_id
      and (
        a.assigned_user_id = (select auth.uid())
        or exists (select 1 from public.dog_caretakers dc where dc.dog_id = r.dog_id and dc.user_id = (select auth.uid()))
      )
  );
$$;

-- Validates an entry's time and note for an assignment; raises user-facing errors
create function private.check_care_log_entry(
  p_assignment public.care_assignments,
  p_kind text,
  p_occurred_at timestamptz,
  p_note text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_kind not in ('meal', 'walk', 'medication', 'drop_off', 'pick_up', 'photo', 'note') then
    raise exception 'Type d''entrée invalide.' using errcode = 'P0001';
  end if;
  if p_kind = 'note' and p_note is null then
    raise exception 'Écrivez un mot.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception '500 caractères maximum.' using errcode = 'P0001';
  end if;
  if p_occurred_at < p_assignment.starts_at - interval '2 hours'
     or p_occurred_at >= p_assignment.ends_at + interval '24 hours' then
    raise exception 'L''heure doit correspondre à la garde.' using errcode = 'P0001';
  end if;
  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'Cette heure n''est pas encore passée.' using errcode = 'P0001';
  end if;
end;
$$;

-- Why the log is closed, for the current user (null when open)
create function private.care_log_closed_reason(p_assignment public.care_assignments)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_assignment.id is null or p_assignment.assigned_user_id is distinct from auth.uid() then
    return 'Seul le gardien de cette garde peut écrire dans son carnet.';
  end if;
  if p_assignment.status = 'pending_reconfirmation' then
    return 'Reconfirmez d''abord les nouveaux horaires de cette garde.';
  end if;
  if p_assignment.status <> 'confirmed'
     or (select lifecycle_status from public.care_requests where id = p_assignment.request_id) <> 'active' then
    return 'Cette garde est annulée.';
  end if;
  if now() < p_assignment.starts_at - interval '2 hours' then
    return 'Le carnet s''ouvre 2 heures avant le début de la garde.';
  end if;
  if now() >= p_assignment.ends_at + interval '24 hours' then
    return 'Le carnet de cette garde est fermé.';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads (writes go through the functions below)
-- ---------------------------------------------------------------------------
alter table public.care_log_entries enable row level security;
revoke all on public.care_log_entries from anon, authenticated;
grant select on public.care_log_entries to authenticated;
create policy "care_log_entries: helper and caretakers read" on public.care_log_entries
  for select to authenticated
  using (author_id = (select auth.uid()) or private.is_dog_caretaker(dog_id));

-- ---------------------------------------------------------------------------
-- Photos: private bucket, "<assignment_id>/<file>"
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('care-logs', 'care-logs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "care-logs: read with the log" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'care-logs'
    and private.can_read_care_log(private.try_uuid((storage.foldername(name))[1]))
  );

create policy "care-logs: helper uploads while open" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'care-logs'
    and private.care_log_open(private.try_uuid((storage.foldername(name))[1]))
  );

create policy "care-logs: helper deletes while open" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'care-logs'
    and private.care_log_open(private.try_uuid((storage.foldername(name))[1]))
  );

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------
create function public.add_care_log(
  p_assignment_id uuid,
  p_kind text,
  p_occurred_at timestamptz default null,
  p_note text default null,
  p_photo_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_a public.care_assignments%rowtype;
  v_req public.care_requests%rowtype;
  v_reason text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_id uuid;
  v_dog text;
  v_name text;
  v_owner record;
  v_title text;
  v_body text;
begin
  select * into v_a from public.care_assignments where id = p_assignment_id;
  v_reason := private.care_log_closed_reason(v_a);
  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;
  perform private.check_care_log_entry(v_a, p_kind, v_at, v_note);
  if p_kind = 'photo' and p_photo_path is null then
    raise exception 'Ajoutez une photo.' using errcode = 'P0001';
  end if;
  if p_photo_path is not null and (
    p_photo_path !~ ('^' || p_assignment_id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$')
    or not exists (select 1 from storage.objects o where o.bucket_id = 'care-logs' and o.name = p_photo_path)
    or exists (select 1 from public.care_log_entries e where e.photo_path = p_photo_path)
  ) then
    raise exception 'Photo introuvable. Réessayez.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.care_log_entries e where e.assignment_id = p_assignment_id) >= 200 then
    raise exception 'Le carnet de cette garde est complet.' using errcode = 'P0001';
  end if;

  select * into v_req from public.care_requests where id = v_a.request_id;
  insert into public.care_log_entries (assignment_id, request_id, dog_id, author_id, kind, occurred_at, note, photo_path)
  values (v_a.id, v_req.id, v_req.dog_id, v_uid, p_kind, v_at, v_note, p_photo_path)
  returning id into v_id;

  -- key moments and photos reach the caretakers' phones
  if p_kind in ('drop_off', 'pick_up', 'photo') then
    v_dog := (select name from public.dogs where id = v_req.dog_id);
    v_name := coalesce(private.display_name(v_uid), 'Le gardien');
    v_title := case p_kind
      when 'drop_off' then v_name || ' a pris en charge ' || v_dog
      when 'pick_up' then v_dog || ' a été récupéré'
      else 'Nouvelle photo de ' || v_dog
    end;
    v_body := case p_kind
      when 'photo' then 'Par ' || v_name || coalesce(' : ' || v_note, '')
      else private.fmt_ts(v_at) || coalesce(' — ' || v_note, '')
    end;
    for v_owner in select user_id from public.dog_caretakers where dog_id = v_req.dog_id loop
      perform private.notify(v_owner.user_id, v_req.group_id, 'care_log', v_title, v_body, v_req.id, v_uid);
    end loop;
  end if;
  return v_id;
end;
$$;

create function public.update_care_log(p_entry_id uuid, p_occurred_at timestamptz, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.care_log_entries%rowtype;
  v_a public.care_assignments%rowtype;
  v_reason text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_e from public.care_log_entries where id = p_entry_id for update;
  if not found or v_e.author_id is distinct from auth.uid() then
    raise exception 'Entrée introuvable.' using errcode = 'P0001';
  end if;
  select * into v_a from public.care_assignments where id = v_e.assignment_id;
  v_reason := private.care_log_closed_reason(v_a);
  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;
  perform private.check_care_log_entry(v_a, v_e.kind, coalesce(p_occurred_at, v_e.occurred_at), v_note);
  update public.care_log_entries
    set occurred_at = coalesce(p_occurred_at, occurred_at), note = v_note, updated_at = now()
    where id = p_entry_id;
end;
$$;

-- Deletes one's entry; returns its photo path so the app removes the file
create function public.delete_care_log(p_entry_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.care_log_entries%rowtype;
  v_reason text;
begin
  select * into v_e from public.care_log_entries where id = p_entry_id for update;
  if not found or v_e.author_id is distinct from auth.uid() then
    raise exception 'Entrée introuvable.' using errcode = 'P0001';
  end if;
  v_reason := private.care_log_closed_reason((select a from public.care_assignments a where a.id = v_e.assignment_id));
  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;
  delete from public.care_log_entries where id = p_entry_id;
  return v_e.photo_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- Photo retention (server, secret key): 90 days after the garde, and files
-- that no entry references any more (abandoned uploads, deleted accounts)
-- ---------------------------------------------------------------------------
create function public.care_log_photos_to_purge(p_limit integer default 100)
returns table (path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  (
    select e.photo_path
    from public.care_log_entries e
    join public.care_assignments a on a.id = e.assignment_id
    where e.photo_path is not null and a.ends_at < now() - interval '90 days'
    union
    select o.name
    from storage.objects o
    where o.bucket_id = 'care-logs'
      and o.created_at < now() - interval '1 day'
      and not exists (select 1 from public.care_log_entries e where e.photo_path = o.name)
  )
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- after the files are removed: entries keep their text, not the photo
create function public.forget_care_log_photos(p_paths text[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.care_log_entries
    set photo_path = null, photo_removed_at = now()
    where photo_path = any (p_paths);
$$;

-- ---------------------------------------------------------------------------
-- Notifications: "care_log" push can be switched off
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
-- Reports: a caretaker can report an entry of their dog's log
-- ---------------------------------------------------------------------------
alter table public.content_reports drop constraint content_reports_target_type_check;
alter table public.content_reports
  add constraint content_reports_target_type_check check (target_type in ('request', 'dog', 'member', 'care_log'));

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
  v_request uuid;
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
      select 'une demande pour ' || d.name, r.id into v_what, v_request
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
    when 'care_log' then
      select 'une entrée du carnet de garde de ' || d.name, e.request_id into v_what, v_request
      from public.care_log_entries e
      join public.care_requests r on r.id = e.request_id
      join public.dogs d on d.id = e.dog_id
      where e.id = p_target_id and r.group_id = p_group_id
        and e.author_id <> v_uid and private.is_dog_caretaker(e.dog_id);
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
      v_request,
      null);
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function private.care_log_open(uuid) from public, anon;
revoke all on function private.can_read_care_log(uuid) from public, anon;
grant execute on function private.care_log_open(uuid) to authenticated;
grant execute on function private.can_read_care_log(uuid) to authenticated;
revoke all on function private.check_care_log_entry(public.care_assignments, text, timestamptz, text) from public, anon, authenticated;
revoke all on function private.care_log_closed_reason(public.care_assignments) from public, anon, authenticated;

revoke all on function public.add_care_log(uuid, text, timestamptz, text, text) from public, anon;
revoke all on function public.update_care_log(uuid, timestamptz, text) from public, anon;
revoke all on function public.delete_care_log(uuid) from public, anon;
grant execute on function public.add_care_log(uuid, text, timestamptz, text, text) to authenticated;
grant execute on function public.update_care_log(uuid, timestamptz, text) to authenticated;
grant execute on function public.delete_care_log(uuid) to authenticated;

revoke all on function public.care_log_photos_to_purge(integer) from public, anon, authenticated;
revoke all on function public.forget_care_log_photos(text[]) from public, anon, authenticated;
grant execute on function public.care_log_photos_to_purge(integer) to service_role;
grant execute on function public.forget_care_log_photos(text[]) to service_role;
