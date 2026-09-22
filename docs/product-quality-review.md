# Product quality review

## Baseline and scope

The deployed homepage and sign-in page were inspected in Edge. The repository matched the visible live green/mint styling and supplied pricing of $10/$20/$35. The original handoff's earlier prices were not reapplied.

The live caregiver login could not be verified with the supplied credentials. No live family records were created, edited, archived, or deleted. Browser tests use an isolated simulated Supabase backend; they do not certify deployed database policies or email delivery.

## Corrected behavior

- Archived stops stay in all-time and weekly counts. Counts no longer depend on the first 20 feed items.
- Family names load before activity is rendered; old view/session requests cannot replace the current screen.
- Save, remove, archive, password, and demo failures remain visible and permit retry.
- Family removal requires confirmation and explains cascading activity deletion.
- Onboarding remembers completion per account, supports back/skip, and never starts on a failed family-data read.
- Native details avoid duplicate IDs when an event appears in multiple views.
- Rendering escapes database and provider content; icons come from a fixed local library.
- Signup confirmation messages remain visible; forms support Enter and prevent duplicate requests.
- Scam checks require a verified Supabase user, reject malformed and oversized input, validate provider output, and use request timeouts.
- The exposed client-side preview credential was removed. No access credential is part of the new code.
- Provider errors and user messages are not logged. Demo events no longer use paid AI requests.
- Native dialogs manage focus; navigation, inputs, summaries, and icon controls work with keyboard and assistive technology.
- Light and dark themes share semantic colors; mobile forms scroll within the viewport.

## Product truth

The UI explains that device protection is not connected. Creating a family profile or changing a protection preference does not activate software. Sample events are labeled. Archiving is a display action, not a device-security decision. The scam checker is a second opinion and does not verify senders or links.

## Verification

Run the commands in README.md for the current result. The browser suite covers 1440, 1024, 768, 430, and 375 pixel widths, dark mode, forms, onboarding, family lifecycle, detail expansion, history, authentication, failure paths, and accessibility. Temporary screenshots and traces are excluded from commits.

## Remaining operational work

- Confirm live Supabase columns and ownership/cascade policies with project access.
- Verify real signup email, recovery redirects, and authenticated provider requests.
- Enable email confirmation before inviting real users.
- Add durable rate limits and spend controls; the code's burst limiter is only per instance.
- Commission and test the actual device agent.
- Review privacy policy, retention, and launch messaging before a paid launch.

These changes improve the prototype's quality; they do not make it a certified or fully production-ready device security service.
