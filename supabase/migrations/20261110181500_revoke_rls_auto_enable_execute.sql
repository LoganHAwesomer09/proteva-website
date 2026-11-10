-- rls_auto_enable runs from the ensure_rls event trigger, which does not need EXECUTE grants.
-- Remove the API-callable grants flagged by the security advisor
-- (anon_security_definer_function_executable / authenticated_security_definer_function_executable).
-- Applied to Project Proteva on November 10, 2026; new public tables still get RLS automatically.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
