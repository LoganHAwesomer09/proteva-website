# Proteva

A dignity-first family safety prototype. The device agent is not built yet: family profiles and sample activity do not activate protection.

## Start locally

Use Node.js 22 or newer and npm.

1. Clone this repository and open its folder in Cursor or your editor.
2. Run `npm ci`.
3. Run `npm run dev`.
4. Open http://127.0.0.1:4173.

The local server builds the static files when it starts. Restart it after editing. API routes are also served locally. For a live scam check, set `ANTHROPIC_API_KEY` in your environment; with Node 22 you can run `node --env-file=.env scripts/dev.mjs`. Never commit a real key.

## Verify before publishing

```sh
npm run lint
npm run check
npm test
npm run test:e2e
npm run build
```

Browser tests use isolated mock accounts and never edit live Supabase data. On Windows they use installed Microsoft Edge. On other systems first run `npx playwright install chromium`. To choose a browser channel explicitly, set `PLAYWRIGHT_CHANNEL`.

This is JavaScript, not TypeScript. ESLint, server tests, browser tests, accessibility checks, static-reference checks, and the build are the available checks.

## Project map

| Location | Purpose |
| --- | --- |
| `index.html` | Public story, planned pricing, waitlist |
| `app.html` | Caregiver views and accessible forms |
| `me.html` | Plain-language introduction for loved ones |
| `assets/app.js` | Auth, navigation, family data, activity, onboarding |
| `assets/styles.css` | Shared colors, controls, light/dark themes, responsive layouts |
| `assets/config.js` | Public Supabase connection settings, not a secret |
| `api/check-scam.js` | Authenticated text/photo assessment and account-scoped history save |
| `api/generate-threat.js` | Authenticated sample event, no paid provider request |
| `lib/server.js` | Request/auth validation and per-instance burst limit |
| `tests/` | Server and Playwright regression coverage |
| `scripts/` | Static build, local server, file-reference checks |
| `dist/` | Generated deployable assets; ignored by Git |

Supabase handles accounts and row-level security. Each family/activity request also scopes itself to the signed-in user's ID. The family follow-up feature requires the migration described below before deployment.

Expected protected_people fields: id, user_id, name, relationship, birth_year, devices (older device also supported for reading), protection_level, notes, created_at. Activity fields follow docs/developer-spec.md. Missing profile columns produce an explicit setup error, not a silent partial save.

## Team workflow

Keep credentials in the company password manager. Each person uses their own GitHub account and app account. Before starting, pull the latest work. Prefer one task per branch and a pull request when working concurrently. Do not have two agents edit the same files at once.

Give your AI assistant the task and point it to this README and docs/product-quality-review.md. Preserve the green/mint Proteva identity, plain-language tone, prevention-first approach, and setup-together principle. Never represent a prototype as active device protection.

Review the diff and test locally. Commit source files and the lockfile, not dist, screenshots, keys, or test output. Push normally; never force-push shared work.

## Deployment

Vercel uses vercel.json: npm run build produces dist, and root api/ files remain serverless functions. The build copies locked Supabase and Lucide browser assets locally, allowing a same-origin script policy. Only listed public assets are copied; docs, tests, source server helpers, and environment files are not published.

Configure ANTHROPIC_API_KEY in Vercel for the scam checker. ANTHROPIC_MODEL is optional and defaults to the existing claude-sonnet-4-6 model. An OpenAI API key is no longer needed for sample threats.

Supabase password recovery requires the app URL in the project's allowed redirect URLs. Turn on email confirmation and review RLS before inviting real users. The preview password screen has been removed with the owner's approval; actual caregiver access still requires Supabase sign-in.

The former client-side preview password was public. Remove any reuse of it elsewhere and rotate it wherever it was reused. Its removal from current code does not remove it from existing Git history.

The burst limiter is per warm serverless instance, not a global billing quota. Add durable account quotas/gateway limits before a public paid launch. Production RLS, email delivery, provider billing, and real device protection require separate operational verification.

## Scam-checker backend

Flow: sign in -> submit text/photo -> server verifies the Supabase user -> Claude assessment -> validated result -> save assessment under that user's JWT -> show result and save status.

Photos are limited to 3 MiB, leaving room for base64 and JSON inside Vercel's 4.5 MB request limit. Browser, local server, and deployed handler share limits in assets/checker-limits.js. The handler checks image signatures and base64; the AI provider still decodes the image. Authentication, analysis, and saving share a 28-second deadline within the configured 30-second function duration.

The scam_checks table needs id, user_id, verdict, headline, why, what_to_do, snippet, was_photo, created_at, person_id, and followed_up_at. New records save an empty snippet, never the submitted message or image. Existing snippets are not deleted. AI assessments can still mention submitted details, so remove sensitive information before submitting. Provider data retention is separate from Proteva's database.

History saving uses the caller's JWT and the public Supabase key, not a service-role key. RLS must enforce user_id = auth.uid() for both INSERT and SELECT. Never relax RLS to fix a save error. The assessment remains available when saving fails, with a visible warning; the client does not retry the paid check automatically.

Before treating this as live:

1. Set ANTHROPIC_API_KEY in the Vercel project's server environment and redeploy. A Claude chat subscription does not configure this key.
2. Review scam_checks RLS and grants in Supabase. Verify two test accounts cannot read or create each other's rows.
3. Sign in with a test account, check a synthetic scam message and a redacted screenshot, then reload History to confirm both saved.
4. Confirm an unsigned request to /api/check-scam returns 401 and that failed saves never claim success.

Local automated tests mock authenticated Supabase/Claude responses; they do not prove deployed credentials, live RLS, provider billing, or real device monitoring. The Sep 29, 2026 read-only live check confirmed the three table routes were reachable (no rows requested) and unsigned scam checks returned 401. No authenticated production writes or paid model requests were made.

References: [Vercel request limits](https://vercel.com/docs/functions/limitations), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Claude image inputs](https://platform.claude.com/docs/en/build-with-claude/vision).

## Family follow-up rollout

The local implementation lets a caregiver choose a family member when checking a message, see the check in that person's history, edit/copy/share a calm conversation draft, and record or undo a follow-up. The AI verdict is never changed by following up. Drafts are generated locally without another AI call, never include model-provided links, and are not sent automatically or saved to the database. Native sharing is offered only when supported; copying remains available.

Deployment prerequisite: review and apply `supabase/migrations/20261015175010_family_check_followups.sql` to Project Proteva before publishing the app code. It adds nullable person_id and followed_up_at fields, a same-account composite foreign key, ownership policies, and the security-invoker set_check_followup RPC. It assumes existing UUID IDs and existing owner-scoped SELECT/INSERT policies; confirm these against the actual database before applying. Existing checks remain unlinked. Removing a person unlinks their checks without deleting assessments.

On October 15, 2026 the reconnected Supabase management connection succeeded. The live UUID columns, owner-scoped policies, and enabled RLS were inspected, and the migration was applied successfully. Verification confirmed both new fields, authenticated follow-up updates, denied verdict updates, denied anonymous RPC execution, and security-invoker execution. The migration removes the old table-wide authenticated UPDATE grant before granting follow-up-only updates. No existing family records were changed during verification.

The new Postgres test uses development-only PGlite with synthetic accounts to execute the actual migration, verify cross-account link rejection and row isolation, exercise follow-up/undo/idempotency, and confirm assessments survive member deletion. These tests validate the migration against a modeled baseline, including the pre-existing table-wide UPDATE grant. `npm test` includes them. No production credentials or family records are needed.

After migration: check with a dedicated test account, verify the saved check is listed for only the selected person, mark follow-up, reload, undo, and confirm the verdict is unchanged. Review Supabase security advisors. The existing per-instance rate limit and other pre-launch checks remain unchanged.

The October 15 security advisor reported pre-existing warnings for public/signed-in execution of `public.rls_auto_enable()` and disabled leaked-password protection. These are not changed by this release and still need review before launch. No real signed-in production scam check or paid provider request was performed as part of this release verification.
