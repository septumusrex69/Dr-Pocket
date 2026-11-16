-- End-of-day check-in, the 21:00 reminder, and two kinds of report (16 Nov 2026).

-- A check-in is an entry of kind 'day': rating, overall pain (entries.pain), sleep, mood, energy, a line of words.
alter table public.entries drop constraint entries_kind_check;
alter table public.entries add constraint entries_kind_check check (kind in ('note','exercise','day'));
alter table public.entries add column checkin jsonb;

-- 'feedback' is for the person (patterns and suggestions); 'clinician' is the doctor summary.
alter table public.reports add column kind text not null default 'clinician' check (kind in ('feedback','clinician'));

-- Web push subscriptions, one per device.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  tz text not null default 'Africa/Johannesburg',
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The evening sender (a Vercel cron) holds no database key of its own. It calls these two functions
-- with a shared secret that lives in a schema the API cannot see.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.app_secrets (name text primary key, value text not null);

-- Each device with the counts for that person's day so far (in the device's time zone). Counts only, no words.
create or replace function public.evening_digest(p_secret text)
returns table (endpoint text, p256dh text, auth text, entries int, exercise int, pain_min int, pain_max int, checked_in boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or p_secret <> (select value from private.app_secrets where name = 'cron') then
    raise exception 'not allowed';
  end if;
  return query
  select s.endpoint, s.p256dh, s.auth,
    count(e.id)::int,
    count(e.id) filter (where e.kind = 'exercise')::int,
    min(e.pain)::int, max(e.pain)::int,
    bool_or(e.kind = 'day')
  from public.push_subscriptions s
  left join public.entries e on e.user_id = s.user_id
    and (e.at at time zone s.tz)::date = (now() at time zone s.tz)::date
  group by s.endpoint, s.p256dh, s.auth;
end $$;

-- Remove a device whose subscription the push service says is gone.
create or replace function public.drop_push_subscription(p_secret text, p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or p_secret <> (select value from private.app_secrets where name = 'cron') then
    raise exception 'not allowed';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
end $$;

revoke all on function public.evening_digest(text) from public;
revoke all on function public.drop_push_subscription(text, text) from public;
grant execute on function public.evening_digest(text) to anon, authenticated;
grant execute on function public.drop_push_subscription(text, text) to anon, authenticated;
-- The secret itself is inserted separately (not in this file): insert into private.app_secrets values ('cron', '<CRON_SECRET>');
