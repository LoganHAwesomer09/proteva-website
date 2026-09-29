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
| `api/device-pair.js`, `api/device-event.js` | Disabled-by-default device event foundation |
| `lib/server.js` | Request/auth validation and per-instance burst limit |
| `tests/` | Server and Playwright regression coverage |
| `scripts/` | Static build, local server, file-reference checks |
| `dist/` | Generated deployable assets; ignored by Git |

Supabase handles accounts and row-level security. Each family/activity request also scopes itself to the signed-in user's ID. The optional device-event foundation has a separate migration that is not yet applied to production.

Expected protected_people fields: id, user_id, name, relationship, birth_year, devices (older device also supported for reading), protection_level, notes, created_at. Activity fields used by the device foundation are described in docs/device-mvp-plan.md. Missing profile columns produce an explicit setup error, not a silent partial save.

## Team workflow

Keep credentials in the company password manager. Each person uses their own GitHub account and app account. Before starting, pull the latest work. Prefer one task per branch and a pull request when working concurrently. Do not have two agents edit the same files at once.

Give your AI assistant the task and point it to this README and docs/product-quality-review.md. Preserve the green/mint Proteva identity, plain-language tone, prevention-first approach, and setup-together principle. Never represent a prototype as active device protection.

See docs/device-mvp-plan.md for the private device test contract. The former confidential developer brief was removed from the current tree, but remains in earlier public Git history. Treat any credential published in earlier commits as exposed and rotate it wherever reused.

Review the diff and test locally. Commit source files and the lockfile, not dist, screenshots, keys, or test output. Push normally; never force-push shared work.

## Deployment

Vercel uses vercel.json: npm run build produces dist, and root api/ files remain serverless functions. The build copies locked Supabase and Lucide browser assets locally, allowing a same-origin script policy. Only listed public assets are copied; docs, tests, source server helpers, and environment files are not published.

Configure ANTHROPIC_API_KEY in Vercel for the scam checker. ANTHROPIC_MODEL is optional and defaults to the existing claude-sonnet-4-6 model. An OpenAI API key is no longer needed for sample threats.

Supabase password recovery requires the app URL in the project's allowed redirect URLs. Turn on email confirmation and review RLS before inviting real users. The preview password screen has been removed with the owner's approval; actual caregiver access still requires Supabase sign-in.

The former client-side preview password was public. Remove any reuse of it elsewhere and rotate it wherever it was reused. Its removal from current code does not remove it from existing Git history.

The burst limiter is per warm serverless instance, not a global billing quota. Add durable account quotas/gateway limits before a public paid launch. Production RLS, email delivery, provider billing, and real device protection require separate operational verification.

Device event ingestion is disabled by default. Applying its migration and enabling it requires Supabase project access and a server-only secret key. No native app or browser extension is included. Keep it disabled on production until device behavior and database policies are verified end to end.

## Scam-checker backend

Flow: sign in -> submit text/photo -> server verifies the Supabase user -> Claude assessment -> validated result -> save assessment under that user's JWT -> show result and save status.

Photos are limited to 3 MiB, leaving room for base64 and JSON inside Vercel's 4.5 MB request limit. Browser, local server, and deployed handler share limits in assets/checker-limits.js. The handler checks image signatures and base64; the AI provider still decodes the image. Authentication, analysis, and saving share a 28-second deadline within the configured 30-second function duration.

The existing scam_checks table needs id, user_id, verdict, headline, why, what_to_do, snippet, was_photo, and created_at. No schema changes are included. New records save an empty snippet, never the submitted message or image. Existing snippets are not deleted. AI assessments can still mention submitted details, so remove sensitive information before submitting. Provider data retention is separate from Proteva's database.

History saving uses the caller's JWT and the public Supabase key, not a service-role key. RLS must enforce user_id = auth.uid() for both INSERT and SELECT. Never relax RLS to fix a save error. The assessment remains available when saving fails, with a visible warning; the client does not retry the paid check automatically.

Before treating this as live:

1. Set ANTHROPIC_API_KEY in the Vercel project's server environment and redeploy. A Claude chat subscription does not configure this key.
2. Review scam_checks RLS and grants in Supabase. Verify two test accounts cannot read or create each other's rows.
3. Sign in with a test account, check a synthetic scam message and a redacted screenshot, then reload History to confirm both saved.
4. Confirm an unsigned request to /api/check-scam returns 401 and that failed saves never claim success.

Local automated tests mock authenticated Supabase/Claude responses; they do not prove deployed credentials, live RLS, provider billing, or real device monitoring. The Sep 29, 2026 read-only live check confirmed the three table routes were reachable (no rows requested) and unsigned scam checks returned 401. No authenticated production writes or paid model requests were made.

References: [Vercel request limits](https://vercel.com/docs/functions/limitations), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Claude image inputs](https://platform.claude.com/docs/en/build-with-claude/vision).
