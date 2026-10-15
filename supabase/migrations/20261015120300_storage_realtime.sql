-- Dogcare — dog photos (private bucket) and realtime publication

-- Private bucket: photos are served through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dog-photos', 'dog-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Object path convention: "<dog_id>/<file>"
create policy "dog-photos: read if dog visible" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'dog-photos'
    and private.can_view_dog(private.try_uuid((storage.foldername(name))[1]))
  );

create policy "dog-photos: caretakers upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'dog-photos'
    and private.is_dog_caretaker(private.try_uuid((storage.foldername(name))[1]))
  );

create policy "dog-photos: caretakers replace" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'dog-photos'
    and private.is_dog_caretaker(private.try_uuid((storage.foldername(name))[1]))
  );

create policy "dog-photos: caretakers delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'dog-photos'
    and private.is_dog_caretaker(private.try_uuid((storage.foldername(name))[1]))
  );

-- Realtime: subscribers only receive rows their RLS policies allow.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.care_requests,
      public.request_responses,
      public.care_assignments,
      public.notifications;
  end if;
end;
$$;
