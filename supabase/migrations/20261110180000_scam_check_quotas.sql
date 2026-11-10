-- Durable scam-check quotas. Apply before deploying the matching api/check-scam.js.
-- Each paid check must first claim a slot. Limits:
--   * per account per day (smaller for accounts created in the last 24 hours);
--   * project-wide per day, which bounds total provider spend;
--   * a share of the project-wide cap that brand-new accounts may use, so a burst of
--     fresh sign-ups cannot use up the whole day's capacity for existing families.
-- Days roll over at midnight UTC. Attempts count even if the provider later fails,
-- so retry loops cannot bypass the limit.
begin;

-- Owners can change these numbers in the Supabase table editor without redeploying.
-- Changes apply to the next claim; lowering a limit below today's usage does not reset it.
create table public.scam_check_limits (
  id boolean primary key default true check (id),
  per_account_daily integer not null check (per_account_daily >= 0),
  new_account_daily integer not null check (new_account_daily >= 0),
  project_daily integer not null check (project_daily >= 0),
  new_accounts_project_daily integer not null check (new_accounts_project_daily >= 0)
);
insert into public.scam_check_limits
  (per_account_daily, new_account_daily, project_daily, new_accounts_project_daily)
  values (20, 5, 300, 50);

create table public.scam_check_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_day date not null,
  checks integer not null default 0 check (checks >= 0),
  primary key (user_id, usage_day)
);

create table public.scam_check_daily_totals (
  usage_day date primary key,
  checks integer not null default 0 check (checks >= 0),
  new_account_checks integer not null default 0 check (new_account_checks >= 0)
);

-- No policies and no grants: browsers cannot read or change limits or counters.
-- Only the function below (running as its owner) writes them.
alter table public.scam_check_limits enable row level security;
alter table public.scam_check_usage enable row level security;
alter table public.scam_check_daily_totals enable row level security;
revoke all on public.scam_check_limits, public.scam_check_usage, public.scam_check_daily_totals
  from public, anon, authenticated;

create function public.claim_scam_check()
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
  is_new := account_created > now() - interval '24 hours';
  account_limit := case when is_new then limits.new_account_daily else limits.per_account_daily end;

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

revoke all on function public.claim_scam_check() from public, anon;
grant execute on function public.claim_scam_check() to authenticated;
commit;
