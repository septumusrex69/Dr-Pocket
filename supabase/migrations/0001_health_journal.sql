-- Dr Pocket health journal: problems, dated entries (notes and exercise), files and progress reports.
-- Every row belongs to one signed-in person and only they can see or change it.
-- Applied to the "Dr Pocket" Supabase project (lpdvppqtpatbzvrrgdnr).

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  area text not null default 'Other',
  side text not null default 'none' check (side in ('left','right','both','none')),
  detail text not null default '',
  started_on date,
  status text not null default 'active' check (status in ('active','improving','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index problems_user on public.problems(user_id, updated_at desc);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  problem_id uuid references public.problems(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note','exercise')),
  at timestamptz not null default now(),
  body text not null default '' check (length(body) <= 20000),
  pain smallint check (pain between 0 and 10),
  exercise jsonb,
  created_at timestamptz not null default now()
);
create index entries_user_at on public.entries(user_id, at desc);
create index entries_problem_at on public.entries(problem_id, at desc);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  problem_id uuid references public.problems(id) on delete cascade,
  entry_id uuid references public.entries(id) on delete cascade,
  path text not null unique,
  name text not null default '',
  mime text not null default '',
  size integer not null default 0,
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index files_problem on public.files(problem_id, at desc);
create index files_entry on public.files(entry_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  problem_id uuid references public.problems(id) on delete cascade,
  range_label text not null default '',
  range_from timestamptz,
  range_to timestamptz,
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index reports_user on public.reports(user_id, created_at desc);

alter table public.problems enable row level security;
alter table public.entries enable row level security;
alter table public.files enable row level security;
alter table public.reports enable row level security;

create policy "own problems" on public.problems for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own entries" on public.entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own files" on public.files for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own reports" on public.reports for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Keep a problem's updated_at fresh when something is added to it, so the list shows the busiest first.
create or replace function public.touch_problem() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.problem_id is not null then
    update public.problems set updated_at = now() where id = new.problem_id;
  end if;
  return new;
end $$;
create trigger entries_touch after insert on public.entries for each row execute function public.touch_problem();
create trigger files_touch after insert on public.files for each row execute function public.touch_problem();

-- Private storage: each person's files live under a folder named after their user id.
insert into storage.buckets (id, name, public, file_size_limit)
values ('health', 'health', false, 26214400)
on conflict (id) do nothing;

create policy "own health files read" on storage.objects for select to authenticated
  using (bucket_id = 'health' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own health files add" on storage.objects for insert to authenticated
  with check (bucket_id = 'health' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own health files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'health' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Delete my account: removes the person and, through the cascades, every row of theirs.
-- The app removes their stored files first (storage objects cannot be deleted from SQL).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
