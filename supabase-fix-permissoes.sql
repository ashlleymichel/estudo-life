grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select on public.saved_files to anon, authenticated;
grant insert, update, delete on public.saved_files to authenticated;
