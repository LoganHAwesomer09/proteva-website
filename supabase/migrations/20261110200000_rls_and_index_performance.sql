-- Performance fixes from the Supabase performance advisor. Access rules are unchanged:
-- each ownership policy keeps the same name, roles, command and condition, but wraps
-- auth.uid() in a sub-select so Postgres evaluates it once per query, not once per row.
-- No data is changed or removed.
begin;

alter policy "Users manage their own people" on public.protected_people
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "Users manage their own activity" on public.activity
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "Users manage their own scam checks" on public.scam_checks
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Indexes for the app's account-scoped reads and for foreign keys.
create index if not exists activity_user_created_idx on public.activity (user_id, created_at desc);
create index if not exists activity_person_idx on public.activity (person_id);
create index if not exists protected_people_user_created_idx on public.protected_people (user_id, created_at);
create index if not exists scam_checks_person_owner_idx on public.scam_checks (person_id, user_id) where person_id is not null;

commit;
