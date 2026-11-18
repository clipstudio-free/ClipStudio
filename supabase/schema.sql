-- ClipStudio Free V2: execute in Supabase SQL Editor.
-- Each user's projects and settings are private through RLS.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  language text not null default 'en' check (language in ('en','fr','ar','es')),
  theme text not null default 'system' check (theme in ('system','dark','light')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 150),
  source_url text,
  source_type text not null default 'upload' check (source_type in ('upload','youtube')),
  status text not null default 'draft' check (status in ('draft','exported')),
  clip_start numeric not null default 0 check (clip_start >= 0),
  clip_end numeric not null default 30 check (clip_end > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_clip_range check (clip_end > clip_start)
);
create index if not exists projects_user_created_idx on public.projects(user_id, created_at desc);
create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  action text not null check (action in ('project_created','project_updated','project_deleted','clip_exported')),
  details text,
  created_at timestamptz not null default now()
);
create index if not exists activity_user_created_idx on public.activity(user_id, created_at desc);
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.activity enable row level security;
-- Re-runnable policies
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
DROP POLICY IF EXISTS projects_select_own ON public.projects;
DROP POLICY IF EXISTS projects_insert_own ON public.projects;
DROP POLICY IF EXISTS projects_update_own ON public.projects;
DROP POLICY IF EXISTS projects_delete_own ON public.projects;
create policy projects_select_own on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy projects_insert_own on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy projects_update_own on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy projects_delete_own on public.projects for delete to authenticated using ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS activity_select_own ON public.activity;
DROP POLICY IF EXISTS activity_insert_own ON public.activity;
create policy activity_select_own on public.activity for select to authenticated using ((select auth.uid()) = user_id);
create policy activity_insert_own on public.activity for insert to authenticated with check ((select auth.uid()) = user_id);
-- Avoid granting direct writes to anonymous users.
revoke all on public.profiles, public.projects, public.activity from anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert on public.activity to authenticated;
