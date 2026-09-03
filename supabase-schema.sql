create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'PAZ Church',
  email text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null default 'folha-de-estudo-life-group.pdf',
  title text not null default 'Folha de Estudo Life Group',
  type text not null default 'life_group',
  status text not null default 'Concluído',
  size integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  pdf_path text,
  pdf_url text,
  docx_path text,
  docx_url text,
  created_by_name text not null default 'PAZ Church',
  created_by_avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.saved_files enable row level security;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
on public.profiles for select
using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "saved_files_select_all" on public.saved_files;
create policy "saved_files_select_all"
on public.saved_files for select
using (true);

drop policy if exists "saved_files_insert_own" on public.saved_files;
create policy "saved_files_insert_own"
on public.saved_files for insert
with check (auth.uid() = user_id);

drop policy if exists "saved_files_update_own" on public.saved_files;
create policy "saved_files_update_own"
on public.saved_files for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "saved_files_delete_own" on public.saved_files;
create policy "saved_files_delete_own"
on public.saved_files for delete
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values
  ('study-pdfs', 'study-pdfs', true),
  ('profile-photos', 'profile-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "study_pdfs_read_all" on storage.objects;
create policy "study_pdfs_read_all"
on storage.objects for select
using (bucket_id = 'study-pdfs');

drop policy if exists "study_pdfs_insert_own_folder" on storage.objects;
create policy "study_pdfs_insert_own_folder"
on storage.objects for insert
with check (
  bucket_id = 'study-pdfs'
  and auth.role() = 'authenticated'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "study_pdfs_update_own_folder" on storage.objects;
create policy "study_pdfs_update_own_folder"
on storage.objects for update
using (
  bucket_id = 'study-pdfs'
  and auth.role() = 'authenticated'
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'study-pdfs'
  and auth.role() = 'authenticated'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "study_pdfs_delete_own_folder" on storage.objects;
create policy "study_pdfs_delete_own_folder"
on storage.objects for delete
using (
  bucket_id = 'study-pdfs'
  and auth.role() = 'authenticated'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "profile_photos_read_all" on storage.objects;
create policy "profile_photos_read_all"
on storage.objects for select
using (bucket_id = 'profile-photos');

drop policy if exists "profile_photos_insert_own_folder" on storage.objects;
create policy "profile_photos_insert_own_folder"
on storage.objects for insert
with check (
  bucket_id = 'profile-photos'
  and auth.role() = 'authenticated'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "profile_photos_update_own_folder" on storage.objects;
create policy "profile_photos_update_own_folder"
on storage.objects for update
using (
  bucket_id = 'profile-photos'
  and auth.role() = 'authenticated'
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'profile-photos'
  and auth.role() = 'authenticated'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "profile_photos_delete_own_folder" on storage.objects;
create policy "profile_photos_delete_own_folder"
on storage.objects for delete
using (
  bucket_id = 'profile-photos'
  and auth.role() = 'authenticated'
  and split_part(name, '/', 1) = auth.uid()::text
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'PAZ Church'),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
