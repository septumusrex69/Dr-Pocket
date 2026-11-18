-- Claude usage and credit tracking.
-- ai_usage: one row per Claude call made by Dr Pocket (what for, model, tokens, estimated cost in USD).
--   Rows are written only by the server through log_ai_usage(secret, ...); people can read their own rows.
-- private.owners: who may see the whole-account view (the person who pays for the Anthropic account).
-- private.credit_baseline: the balance the owner last read on the Anthropic billing page, and when.
--   Anthropic has no API for the remaining balance, so "remaining" = that balance minus spend since then.
create table public.ai_usage (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  action text not null,
  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cost_usd numeric(12,6) not null default 0,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index ai_usage_user_time_idx on public.ai_usage (user_id, created_at desc);
create index ai_usage_time_idx on public.ai_usage (created_at desc);
alter table public.ai_usage enable row level security;
create policy "read own ai usage" on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));

create table private.owners (user_id uuid primary key references auth.users(id) on delete cascade);
create table private.credit_baseline (id int primary key default 1 check (id = 1), amount_usd numeric(12,2) not null, as_of timestamptz not null, set_at timestamptz not null default now());

create or replace function public.log_ai_usage(p_secret text, p_user uuid, p_action text, p_model text, p_in int, p_out int, p_cw int, p_cr int, p_cost numeric, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or p_secret <> (select value from private.app_secrets where name = 'cron') then
    raise exception 'not allowed';
  end if;
  insert into public.ai_usage (user_id, action, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, detail)
  values (p_user, left(p_action, 40), left(coalesce(p_model, ''), 60), greatest(p_in, 0), greatest(p_out, 0), greatest(p_cw, 0), greatest(p_cr, 0), greatest(p_cost, 0), left(coalesce(p_detail, ''), 200));
end $$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.owners where user_id = (select auth.uid()));
$$;

-- Owner only: Dr Pocket's Claude spend across every account, and the saved balance.
create or replace function public.owner_ai_usage(p_from timestamptz, p_to timestamptz)
returns table (action text, calls bigint, input_tokens bigint, output_tokens bigint, cache_tokens bigint, cost_usd numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.owners where user_id = (select auth.uid())) then raise exception 'not allowed'; end if;
  return query select u.action, count(*), sum(u.input_tokens)::bigint, sum(u.output_tokens)::bigint, sum(u.cache_write_tokens + u.cache_read_tokens)::bigint, sum(u.cost_usd)
    from public.ai_usage u where u.created_at >= p_from and u.created_at < p_to group by u.action order by 6 desc;
end $$;

create or replace function public.get_credit_baseline() returns table (amount_usd numeric, as_of timestamptz, set_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.owners where user_id = (select auth.uid())) then raise exception 'not allowed'; end if;
  return query select b.amount_usd, b.as_of, b.set_at from private.credit_baseline b where b.id = 1;
end $$;

create or replace function public.set_credit_baseline(p_amount numeric, p_as_of timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.owners where user_id = (select auth.uid())) then raise exception 'not allowed'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000 then raise exception 'bad amount'; end if;
  insert into private.credit_baseline (id, amount_usd, as_of, set_at) values (1, p_amount, coalesce(p_as_of, now()), now())
  on conflict (id) do update set amount_usd = excluded.amount_usd, as_of = excluded.as_of, set_at = now();
end $$;

revoke all on function public.log_ai_usage(text, uuid, text, text, int, int, int, int, numeric, text) from public;
revoke all on function public.is_owner() from public;
revoke all on function public.owner_ai_usage(timestamptz, timestamptz) from public;
revoke all on function public.get_credit_baseline() from public;
revoke all on function public.set_credit_baseline(numeric, timestamptz) from public;
grant execute on function public.log_ai_usage(text, uuid, text, text, int, int, int, int, numeric, text) to anon, authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.owner_ai_usage(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_credit_baseline() to authenticated;
grant execute on function public.set_credit_baseline(numeric, timestamptz) to authenticated;
-- The owner row is inserted separately: insert into private.owners select id from auth.users where email = '<owner>';
