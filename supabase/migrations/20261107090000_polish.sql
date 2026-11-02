-- Dogcare — polish batch (minor review items)
-- 1. Deleting the account of a dog's last caretaker cancels the dog's
--    requests ahead: helpers are told (instead of gardes left active).
-- 2. Care log photos: at most 30 files per garde, and a file still used by an
--    entry cannot be deleted.

-- ---------------------------------------------------------------------------
-- 1. Account deletion
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  -- groups where the user is the only admin but not alone: promote the oldest member
  update public.group_members gm set role = 'admin'
  where (gm.group_id, gm.user_id) in (
    select distinct on (m.group_id) m.group_id, m.user_id
    from public.group_members m
    where m.user_id <> v_uid
      and m.group_id in (select group_id from public.group_members where user_id = v_uid and role = 'admin')
      and not exists (
        select 1 from public.group_members a
        where a.group_id = m.group_id and a.role = 'admin' and a.user_id <> v_uid
      )
    order by m.group_id, m.joined_at
  );
  -- dogs left without a caretaker: their needs ahead are cancelled, which
  -- cancels the gardes and tells helpers and volunteers (care_requests trigger)
  update public.care_requests r
  set lifecycle_status = 'cancelled'
  where r.lifecycle_status = 'active'
    and r.ends_at > now()
    and r.dog_id in (
      select dc.dog_id from public.dog_caretakers dc
      where dc.user_id = v_uid
        and not exists (select 1 from public.dog_caretakers o where o.dog_id = dc.dog_id and o.user_id <> v_uid)
    );
  perform private.audit('account_deleted', null, v_uid);
  delete from auth.users where id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Care log photos
-- ---------------------------------------------------------------------------
create function private.care_log_photo_count(p_assignment_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from storage.objects o
  where o.bucket_id = 'care-logs' and (storage.foldername(o.name))[1] = p_assignment_id::text;
$$;

create function private.care_log_photo_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.care_log_entries e where e.photo_path = p_name);
$$;

revoke all on function private.care_log_photo_count(uuid) from public, anon;
revoke all on function private.care_log_photo_in_use(text) from public, anon;
grant execute on function private.care_log_photo_count(uuid) to authenticated;
grant execute on function private.care_log_photo_in_use(text) to authenticated;

drop policy "care-logs: helper uploads while open" on storage.objects;
create policy "care-logs: helper uploads while open" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'care-logs'
    and private.care_log_open(private.try_uuid((storage.foldername(name))[1]))
    and private.care_log_photo_count(private.try_uuid((storage.foldername(name))[1])) < 30
  );

drop policy "care-logs: helper deletes while open" on storage.objects;
create policy "care-logs: helper deletes while open" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'care-logs'
    and private.care_log_open(private.try_uuid((storage.foldername(name))[1]))
    and not private.care_log_photo_in_use(name)
  );
