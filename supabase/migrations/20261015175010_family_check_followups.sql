-- Additive migration; apply before deploying the family follow-up app changes.
begin;
alter table public.scam_checks
  add column person_id uuid,
  add column followed_up_at timestamptz;

create unique index protected_people_id_user_id_key on public.protected_people (id, user_id);
alter table public.scam_checks add constraint scam_checks_person_owner_fkey
  foreign key (person_id, user_id) references public.protected_people (id, user_id)
  on delete set null (person_id);
create index scam_checks_person_history_idx on public.scam_checks (user_id, person_id, created_at desc);

alter table public.scam_checks enable row level security;
-- Restrictive ownership protects against broader pre-existing permissive policies.
create policy scam_checks_owner_guard on public.scam_checks as restrictive
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy scam_checks_followup_update on public.scam_checks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
-- Remove the existing table-wide grant before allowing follow-up-only updates.
revoke update on public.scam_checks from authenticated;
grant update (followed_up_at) on public.scam_checks to authenticated;

create function public.set_check_followup(check_id uuid, completed boolean)
returns table (id uuid, followed_up_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
begin
  if (select auth.uid()) is null or completed is null then
    raise exception 'Sign in and choose a follow-up state.' using errcode = '42501';
  end if;
  return query
    update public.scam_checks as c
    set followed_up_at = case when completed then coalesce(c.followed_up_at, now()) else null end
    where c.id = check_id and c.user_id = (select auth.uid())
    returning c.id, c.followed_up_at;
end;
$$;
revoke all on function public.set_check_followup(uuid, boolean) from public, anon;
grant execute on function public.set_check_followup(uuid, boolean) to authenticated;
commit;
