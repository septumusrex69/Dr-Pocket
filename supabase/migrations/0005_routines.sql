-- Exercise routines: a named set of exercises or stretches the person builds once ("Stretching routine":
-- behind the back, up the wall…; or just "Biokinetics exercises") and then logs in one go.
-- A logged routine is an ordinary exercise entry whose exercise jsonb holds
-- { name, routine_id, items: [{ name, detail, done }], minutes }.
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  problem_id uuid references public.problems(id) on delete set null,
  name text not null check (length(name) between 1 and 120),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  note text not null default '' check (length(note) <= 2000),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index routines_user_idx on public.routines (user_id);
alter table public.routines enable row level security;
create policy "own routines" on public.routines for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
