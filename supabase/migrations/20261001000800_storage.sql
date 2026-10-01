-- Media bucket: public read; writes only into "<tenant_id>/owner/..." by a
-- member of that tenant. Config images under "<tenant_id>/config/..." are
-- uploaded by the pipeline with the service role.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-media', 'tenant-media', true, 8 * 1024 * 1024,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function app_private.storage_member_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (storage.foldername(p_name))[1] ~ '^[0-9a-f-]{36}$'
     and (storage.foldername(p_name))[2] = 'owner'
     and app_private.is_member(((storage.foldername(p_name))[1])::uuid)
$$;
grant usage on schema app_private to authenticated;
grant execute on function app_private.storage_member_path(text) to authenticated;
grant execute on function app_private.is_member(uuid) to authenticated;

drop policy if exists tenant_media_insert on storage.objects;
drop policy if exists tenant_media_update on storage.objects;
drop policy if exists tenant_media_delete on storage.objects;
drop policy if exists tenant_media_select on storage.objects;

create policy tenant_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-media' and app_private.storage_member_path(name));
create policy tenant_media_update on storage.objects for update to authenticated
  using (bucket_id = 'tenant-media' and app_private.storage_member_path(name))
  with check (bucket_id = 'tenant-media' and app_private.storage_member_path(name));
create policy tenant_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tenant-media' and app_private.storage_member_path(name));
-- Members may list/select their own folder (needed for upsert); public reads
-- go through the public bucket URL and need no policy.
create policy tenant_media_select on storage.objects for select to authenticated
  using (bucket_id = 'tenant-media' and app_private.storage_member_path(name));
