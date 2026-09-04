grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select on public.saved_files to anon, authenticated;
grant insert, update, delete on public.saved_files to authenticated;

drop policy if exists "saved_files_delete_own" on public.saved_files;
create policy "saved_files_delete_own"
on public.saved_files for delete
to authenticated
using (true);

drop policy if exists "study_pdfs_delete_own_folder" on storage.objects;
create policy "study_pdfs_delete_own_folder"
on storage.objects for delete
using (
  bucket_id = 'study-pdfs'
  and auth.role() = 'authenticated'
);
