-- Plan-based daily scam-check limits, a read-only usage summary for the app sidebar,
-- and a record of which paid plan a caregiver asked to hear about.
-- Builds on 20261110180000_scam_check_quotas.sql.
begin;

-- Daily check allowance per subscription plan. Owners edit these in the table editor.
-- Prices are shown in the app; subscriptions are not active until billing is connected.
create table public.scam_check_plans (
  plan text primary key check (plan ~ '^[a-z]+$'),
  display_name text not null check (length(display_name) between 1 and 40),
  daily_checks integer not null check (daily_checks >= 0),
  monthly_price_cents integer check (monthly_price_cents >= 0),
  family_members integer check (family_members > 0),
  sort_order integer not null default 0
);
insert into public.scam_check_plans (plan, display_name, daily_checks, monthly_price_cents, family_members, sort_order) values
  ('free',   'Free',   10,  null, null, 0),
  ('home',   'Home',   25,  1000, 2,    1),
  ('family', 'Family', 50,  2000, 5,    2),
  ('shield', 'Shield', 100, 3500, 10,   3);

-- Plan details are public, like the pricing page.
alter table public.scam_check_plans enable row level security;
revoke all on public.scam_check_plans from public, anon, authenticated;
grant select on public.scam_check_plans to anon, authenticated;
create policy scam_check_plans_public_read on public.scam_check_plans
  for select to anon, authenticated using (true);

-- Which plan each account is on. Accounts without a row are on Free.
-- Browsers cannot read or write this table; billing (service role) sets it.
create table public.account_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null references public.scam_check_plans (plan),
  updated_at timestamptz not null default now()
);
alter table public.account_plans enable row level security;
revoke all on public.account_plans from public, anon, authenticated;

-- "Tell me when this plan launches" requests from signed-in caregivers.
create table public.plan_interest (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan text not null references public.scam_check_plans (plan),
  created_at timestamptz not null default now(),
  primary key (user_id, plan)
);
alter table public.plan_interest enable row level security;
revoke all on public.plan_interest from public, anon, authenticated;
grant select, insert (plan) on public.plan_interest to authenticated;
create policy plan_interest_owner_read on public.plan_interest
  for select to authenticated using ((select auth.uid()) = user_id);
create policy plan_interest_owner_insert on public.plan_interest
  for insert to authenticated with check ((select auth.uid()) = user_id and plan <> 'free');

-- The per-account limit now comes from the plan.
-- Replace the claim function before dropping the column it used.
create or replace function public.claim_scam_check()
returns table (allowed boolean, limit_reason text, remaining integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  today date := (now() at time zone 'utc')::date;
  next_reset timestamptz := ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc';
  limits public.scam_check_limits;
  account_created timestamptz;
  is_new boolean;
  account_plan text;
  account_limit integer;
  account_used integer;
  project_used integer;
begin
  if caller is null or coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in to check a message.' using errcode = '42501';
  end if;

  select * into limits from public.scam_check_limits as l where l.id;
  if not found then
    raise exception 'Scam-check limits are not configured.' using errcode = 'P0001';
  end if;

  select u.created_at into account_created from auth.users as u where u.id = caller;
  if account_created is null then
    raise exception 'Sign in to check a message.' using errcode = '42501';
  end if;

  account_plan := coalesce((select a.plan from public.account_plans as a where a.user_id = caller), 'free');
  select p.daily_checks into account_limit from public.scam_check_plans as p where p.plan = account_plan;
  if account_limit is null then
    raise exception 'Scam-check limits are not configured.' using errcode = 'P0001';
  end if;
  -- Brand-new free accounts get a smaller allowance and share a reserved slice of the
  -- project cap, so a burst of sign-ups cannot use up the day for existing families.
  is_new := account_plan = 'free' and account_created > now() - interval '24 hours';
  if is_new then account_limit := least(account_limit, limits.new_account_daily); end if;

  -- Account first: callers already over their own limit never touch the shared row.
  -- Each conditional upsert is atomic, so concurrent requests cannot overshoot a limit,
  -- and every caller locks rows in the same order (account, then project).
  insert into public.scam_check_usage as u (user_id, usage_day, checks)
  select caller, today, 1 where account_limit > 0
  on conflict (user_id, usage_day) do update set checks = u.checks + 1
    where u.checks < account_limit
  returning u.checks into account_used;
  if account_used is null then
    return query select false, 'account', 0, next_reset;
    return;
  end if;

  insert into public.scam_check_daily_totals as t (usage_day, checks, new_account_checks)
  select today, 1, case when is_new then 1 else 0 end
  where limits.project_daily > 0 and (not is_new or limits.new_accounts_project_daily > 0)
  on conflict (usage_day) do update set
    checks = t.checks + 1,
    new_account_checks = t.new_account_checks + case when is_new then 1 else 0 end
    where t.checks < limits.project_daily
      and (not is_new or t.new_account_checks < limits.new_accounts_project_daily)
  returning t.checks into project_used;
  if project_used is null then
    -- Give the account slot back; the project-wide cap stopped this check.
    update public.scam_check_usage as u set checks = u.checks - 1
    where u.user_id = caller and u.usage_day = today and u.checks > 0;
    return query select false, 'project', 0, next_reset;
    return;
  end if;

  -- Keep only recent history for this account.
  delete from public.scam_check_usage as u
  where u.user_id = caller and u.usage_day < today - 30;

  return query select true, null::text, account_limit - account_used, next_reset;
end;
$$;

alter table public.scam_check_limits drop column per_account_daily;

-- Read-only summary for the signed-in caregiver's sidebar. Never changes a counter.
create function public.get_scam_check_usage()
returns table (plan text, plan_name text, daily_limit integer, used_today integer, resets_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  today date := (now() at time zone 'utc')::date;
  account_plan text;
  account_created timestamptz;
  new_limit integer;
begin
  if caller is null or coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in to see your checks.' using errcode = '42501';
  end if;
  select u.created_at into account_created from auth.users as u where u.id = caller;
  if account_created is null then
    raise exception 'Sign in to see your checks.' using errcode = '42501';
  end if;
  account_plan := coalesce((select a.plan from public.account_plans as a where a.user_id = caller), 'free');
  select l.new_account_daily into new_limit from public.scam_check_limits as l where l.id;

  return query
    select p.plan, p.display_name,
      case when p.plan = 'free' and account_created > now() - interval '24 hours'
        then least(p.daily_checks, coalesce(new_limit, p.daily_checks)) else p.daily_checks end,
      coalesce((select u.checks from public.scam_check_usage as u
        where u.user_id = caller and u.usage_day = today), 0),
      (today + 1)::timestamp at time zone 'utc'
    from public.scam_check_plans as p where p.plan = account_plan;
end;
$$;

revoke all on function public.get_scam_check_usage() from public, anon;
grant execute on function public.get_scam_check_usage() to authenticated;
commit;
