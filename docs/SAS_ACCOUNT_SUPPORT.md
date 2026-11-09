# SAS account support

## Staff procedure

1. Sign in as a SAS administrator and open **Administration → Konten & IT-Support**.
2. Verify the student in person against the school's separately protected
   distribution records. Retrieve the citizen ID there if the student forgot it.
   An SAS card QR code or citizen ID alone cannot establish identity.
3. Enter either citizen ID format, select **Konto suchen**, and check the result.
4. Confirm the in-person identity check and select **Vorläufiges Passwort erzeugen**.
5. Copy the temporary password or print **Übergabezettel drucken**. Hand it
   directly to the student, then close the screen. A closed slip cannot be retrieved.
6. Ask the student to sign in and choose a personal password. The portal requires
   password rotation before normal portal use.

A reset targets the existing Auth UUID. It does not replace the account, roles,
wallet, payment history, attendance, or card QR. The system allows one reset
attempt per target every two minutes and ten per administrator every ten minutes.
If delivery was interrupted, wait for the cooldown and perform a new reset after
confirming identity again. The audit records the actor, target, time and outcome
without password material. Review audit retention alongside account deletion.

## Release verification

- The November 9 alias, display RPC, audit table and role-search migrations
  are already on the hosted database. Apply only
  `20261109105220_sas_account_support_and_privacy.sql` for this release.
- Deploy `sas-login-short` with platform JWT verification disabled for pre-login
  traffic. The account support Edge Function can also use manual JWT verification.
  It verifies the token through Supabase Auth and checks the live admin session
  and profile role in the database. Both functions use server-managed credentials.
- Check that the API cache loaded the account-support RPC and the PostgREST
  pre-request check. Verify ordinary and stale sessions using a disposable
  test account. The hosted Auth password update must revoke previous sessions.
- Publish the built portal on the existing Worker. Verify the live scripts,
  anonymous access rejection, both login paths, password rotation, admin
  access, and the card export with a disposable account.
- The short-login Edge Function uses Supabase Auth's upstream rate limits.
  A simultaneous first sign-in for the entire school has not been load-tested.
  The existing long-ID path goes directly to Auth and remains available.
