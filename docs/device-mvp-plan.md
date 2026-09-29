# First real device event: private test plan

The caregiver dashboard is a prototype. No device protection is active. The API in this branch is an **inactive foundation** for a private test; it must not be described as a launched safety service.

## Scope

Build one consent-based iPhone test: a visible installation, a warning or block on a known test page, and an accurate, plain-language event in the caregiver dashboard. No messages, emails, browsing history, URLs, or arbitrary device text are sent to Proteva. The device submits only an event ID and one of two fixed action types.

An Apple Safari content blocker can block declaratively but cannot report which requests it blocked to its host app. Therefore, a content blocker alone cannot honestly produce a per-block dashboard event. Prototype the device mechanism and verify an observable signal before using `risky_site_blocked`; otherwise report only a warning that the device actually showed. The backend accepts the two fixed types for controlled testing, not as proof that an action occurred.

## Server contract (private testing only)

1. Apply `supabase/migrations/20260929171935_device_event_ingestion.sql` to the **correct project**, after checking the live `protected_people` and `activity` schema and backing up the database. Do not run it against production until ownership and cascade policies are reviewed.
2. Store a new Supabase secret key in the Vercel server environment as `SUPABASE_SECRET_KEY`. Do not put it in `assets/`, a device binary, Git, or a URL. Set `DEVICE_INGEST_ENABLED=true` only in the private test deployment after the migration and policies are verified. With the flag absent or false, both endpoints return unavailable.
3. A signed-in caregiver calls `POST /api/device-pair` with `{"action":"create","personId":"<uuid>"}` and their Supabase access token. The server checks ownership and returns a one-time `deviceToken` and `installationId`. Transfer the token to a device through an explicit, consent-based setup flow. It is shown once and stored as a SHA-256 hash on the server.
4. An enrolled device calls `POST /api/device-event` with `Authorization: Bearer <deviceToken>` and `{"eventId":"<new uuid>","type":"risky_site_warning"}` (or `risky_site_blocked` only if genuinely blocked). The server generates the display text and stores an activity row linked to the enrolled person. Retry with the same event ID to avoid duplicate activity.
5. To revoke, the caregiver calls `POST /api/device-pair` with `{"action":"revoke","installationId":"<uuid>"}`. A revoked token can no longer add events. Keep tokens out of logs.

These APIs use a small per-instance burst limit. Before wider testing, add durable per-device quotas, anomaly monitoring, and a robust pairing UI. A lost token must be revoked and replaced. Do not rely on this endpoint alone for a paid launch.

## Acceptance check

- Verify signed-in caregiver ownership, unauthorized and revoked device rejection, event idempotency, and another family's data isolation against the live test database.
- Install the device experience with the protected person present; clearly show how to turn it off and remove it.
- Trigger one known safe test fixture and confirm the device action really happened, then confirm the caregiver event describes only that action. Verify no personal URL or message entered the event request or server logs.
- Test offline retries and revocation. Check auth email and recovery, RLS, and the existing scam checker separately before inviting families.

## Platform decision

Apple's Safari content-blocking and web-extension APIs have different visibility and packaging rules. Validate the chosen path on a physical iPhone before promising real-time blocking, app-install monitoring, remote-access detection, or system-wide coverage. These other protections are future work.
