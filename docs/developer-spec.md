# Proteva — Device Agent MVP (Developer Brief)

**Confidential.** Share only under NDA.  
**Contact:** hello@getproteva.com  
**Last updated:** June 2026

---

## What Proteva is

A subscription service that protects vulnerable people (starting with the elderly) from digital scams, phishing, predatory apps, and remote-access exploitation. A family caregiver manages everything from a calm dashboard. The person being protected always knows Proteva is on their device.

**Origin:** Founded by two brothers after their grandmother was scammed. Protection with dignity — never spying, never hidden monitoring.

---

## What already exists (your integration target)

| Layer | Status | Tech |
|-------|--------|------|
| Marketing site | Live | Static HTML on Vercel — getproteva.com |
| Caregiver app | Live prototype | app.html — Supabase Auth + Postgres |
| Device agent | **Not built — this is the job** | — |

**Supabase tables (relevant to you):**
- `protected_people` — id, user_id, name, device, status, created_at
- `activity` — id, user_id, person_id, icon, text, tag (`stopped` \| `attention`), resolved, detail_why, detail_did, detail_actions, created_at

**Your agent should INSERT rows into `activity`** when it detects/handles events, linked to `person_id`.

---

## Non-negotiable product rules

1. **Prevention-first** — block/handle silently; caregiver is the exception, not the default.
2. **Noninvasive** — no reading private messages, emails, or conversation content.
3. **Transparent** — the protected person knows Proteva is installed.
4. **Dignity-first** — plain language; easy removal at any time.
5. **Device-first signals** — detect from device behavior (URLs, apps, permissions, pop-ups, remote-access attempts), not content surveillance.

---

## MVP scope (Phase 1)

**Goal:** One real device type, end-to-end: threat detected → handled or flagged → caregiver sees it in the dashboard.

### Recommended priority: iPhone first
- Largest scam-vulnerable senior population on iPhone
- Apple MDM / supervision APIs are well-documented but require enrollment design
- Android can be Phase 2

### MVP detection & response (minimum viable)
| Threat type | Desired behavior |
|-------------|------------------|
| Scam / phishing links | Block or warn before opened; log `stopped` |
| Fake support pop-ups / malicious sites | Block; log `stopped` |
| Predatory or high-risk app installs | Block or pause; log `stopped` or `attention` |
| Remote-access apps (TeamViewer-style abuse) | Block unauthorized sessions; log `stopped` |
| Unusual permission requests | Pause; log `attention` for caregiver |

### MVP deliverables
1. Installable agent on protected device (enrollment flow documented)
2. Background monitoring matching table above
3. Secure channel to post events to Supabase (`activity` table) per `person_id`
4. Plain-language event payload (icon, text, tag, detail_why, detail_did, detail_actions)
5. Basic allowlist / blocklist management (can be server-driven later)
6. Clean uninstall path

### Out of scope for MVP
- Reading SMS/email content
- Keystroke logging
- Hidden / disguised installation
- Dark web monitoring
- Hardware "Pod" device

---

## Architecture (target)

```
[Protected device: Proteva Agent]
        ↓ events (HTTPS)
[Middle tier — optional: your API / Edge Functions]
        ↓
[Supabase — activity + protected_people]
        ↓
[Caregiver dashboard — existing app.html]
```

You may post directly to Supabase with a service role key from a secure backend, or via a small API you own. **Never embed service keys on the device.**

---

## Event schema (activity insert)

```json
{
  "person_id": "uuid-from-protected_people",
  "icon": "🚫",
  "text": "Blocked a fake Microsoft support pop-up",
  "tag": "stopped",
  "detail_why": "Plain language — what happened and why it's dangerous.",
  "detail_did": "What Proteva did automatically.",
  "detail_actions": "What the caregiver can do (usually none for stopped).",
  "resolved": false
}
```

`tag: "attention"` = rare cases needing human follow-up.

---

## Questions we need answered in your proposal

1. iPhone MVP approach: MDM provider (Jamf, etc.) vs custom — tradeoffs and cost?
2. Timeline and fixed-price vs hourly for MVP?
3. Apple Developer / supervision enrollment — what do we need to set up?
4. How do you guarantee noninvasive design (no message access)?
5. Ongoing maintenance cost after launch?
6. Android path and incremental cost?

---

## Success criteria

We can demo to family (private): install on a test iPhone → trigger a realistic threat → see a calm, accurate alert on the caregiver dashboard within seconds → protected person was never asked to understand technical jargon.

---

## Budget context

Early-stage founders. Seeking honest MVP estimate before full build. Open to phased delivery.
