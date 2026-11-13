# SAS account support — release and recovery runbook

> Status (13 November 2026): QR recovery is implemented on draft PR #55, **not approved for general production use**. The hosted database already has the account-support migration, session-check hook and reset trigger, and the `sas-account-recovery-qr` Edge Function is deployed. The production Cloudflare Worker still uses the previous account-support flow; only the existing numeric ID suggestions are known to be live. Do not assume a GitHub commit publishes a Worker.

## Staff procedure AFTER QR release

1. Sign in as a SAS administrator and open **Administration → Konten & IT-Support**. The workflow must be restricted to an active authorized admin session.
2. Verify the student **in person**, using separately protected school distribution records. A card QR code, account ID, or picture of either **does not prove identity**.
3. Enter the six-digit number (with or without `SAS-`) or the accepted existing long citizen ID, and select **Konto suchen**. Choose an ID suggestion only if it matches the independent identity check.
4. Confirm the in-person identity check, then select **Einmaligen Reset-QR erzeugen**. The existing password is immediately replaced by a non-disclosed temporary secret; it must not be printed, emailed, or disclosed.
5. Show the **single-use** recovery QR to the verified student only. Have the student scan it **on their own device** and follow the portal to set an individual password (at least 12 characters), including required privacy notice and terms confirmations. The token must not be sent to a group chat or stored in a public photo.
6. Close the QR slip immediately. If printed, hand over the paper privately; avoid unmonitored printers. If the QR expires or fails after the password was invalidated, repeat identity verification and issue a new QR only after the support rate limit permits it. Never disclose the hidden temporary password.
7. Confirm the student can sign in with the existing account ID and new password. Neither the account UUID nor wallet, balances, roles, payment history, card QR or attendance should change.

**Important:** The existing older production support function can still return a temporary password. Do not use these QR instructions as evidence that the public Worker has been switched to the new flow. Retire the legacy display/print workflow only after the QR flow passes acceptance and the Worker is updated.

## Security expectations

- Staff may reset a **non-admin, active and eligible** account only. The Edge Function checks the Supabase Auth JWT, database role, active Auth session, target restrictions, and server-side rate limits.
- Each reset is audited with actor, target, timestamp and status, **without passwords or QR token**. The current limits are one attempt per target per 2 minutes, three per target per 24 hours, ten per administrator per 10 minutes.
- A recovery hash in a URL fragment is a **bearer credential** until redeemed or expired. Treat it like a password: clear it before network requests, do not log it, and do not add third-party analytics to the recovery page. Avoid printing or sharing links unless required.
- The PostgREST pre-request session hook is present on the hosted database and is intended to block stale pre-reset sessions. Verify this behavior in a real controlled test; a static source-code test is not proof.
- Recovery-token lifetime depends on hosted Supabase Auth OTP configuration. Verify it in the dashboard before release. No email dispatch is involved.
- The recipient's pre-existing account data is retained; do not log names or export student records into GitHub.

## Release checklist (all required)

- [ ] GitHub Actions checks pass on the current PR #55 **head**, including source checks and confidentiality checks; fix branch conflicts with `main` without discarding Android-app or portal changes.
- [ ] Confirm exact hosted migration and deployed Edge Function version **read-only**. On 13 November 2026 the support migration, reset trigger and `pgrst.db_pre_request` hook were already present. **Do not rerun migrations already applied.**
- [ ] Test only using a school-authorized disposable account and a dedicated admin test identity. Do not use an actual pupil account or generate new live accounts without explicit authorization.
- [ ] As admin: successful lookup with short and long IDs; failed unauthorized lookup; disabled/deleting/admin target rejected; missing identity confirmation rejected; cooldown and rate-limit enforced.
- [ ] Generate QR; verify no email and no disclosure of the temporary password; scan on a separate device; inspect new-password form and mandatory legal acknowledgements; change password.
- [ ] Verify the OTP **cannot be redeemed twice**, expires as configured, and cannot be reused from browser history, QR print or old sessions.
- [ ] Verify old password, old refresh tokens and stale API sessions do not recover access; verify new password and the correct existing account work. Check balances, cards, roles and attendance are unchanged.
- [ ] Test failure after password invalidation but before QR delivery; staff must receive a clear recovery path that does not expose the hidden secret.
- [ ] Test at mobile and desktop viewport; check QR scanner and printing privacy, and that the portal does not expose the fragment to analytics, logs or third-party code.
- [ ] After successful acceptance: update the **existing** Cloudflare Worker, inspect deployed assets, repeat read-only and test-account browser checks; only then mark PR #55 ready for review/merge and close the linked issue.

### Related

- Draft PR: https://github.com/1234Taschenlampe/Schule-als-Staat-/pull/55
- Work item: https://github.com/1234Taschenlampe/Schule-als-Staat-/issues/54
- Server function: `supabase/functions/sas-account-recovery-qr/index.ts`
- Auth + SQL enforcement: `supabase/migrations/20261109105220_sas_account_support_and_privacy.sql`
- Source checks: `tests/admin-qr-recovery.mjs`
