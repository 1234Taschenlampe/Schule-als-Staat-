# ViSA-Mailversand: Gmail, Resend und Raspberry Pi

## Stand

Die Supabase-Edge-Function `visa-gmail-dispatch` verarbeitet die vorhandene Mail-Queue. Ohne Konfiguration bleibt `VISA_EMAIL_PROVIDER` standardmäßig `gmail`. Der alternative Wert `resend` aktiviert einen separaten Resend-API-Versandweg. Es gibt **keinen** automatischen Fallback nach einem Zustellfehler, um Dubletten zu vermeiden.

## Resend: vor der Produktivfreigabe erforderlich

1. Kostenloses Resend-Konto und eine bereits vorhandene, per DNS kontrollierbare Absenderdomain bei Resend verifizieren. Die Worker-Adresse unter `workers.dev` kann nicht als eigene DNS-Domain verifiziert werden.
2. Im Supabase-Dashboard für Edge Functions drei **serverseitige Secrets** hinterlegen: `VISA_EMAIL_PROVIDER=resend`, `RESEND_API_KEY` und `RESEND_FROM_EMAIL` (ein verifizierter Absender). Keine Zugangsdaten im Frontend, GitHub oder Chat speichern.
3. Der autorisierte Aufruf `visa-gmail-dispatch` mit JSON `{"mode":"check"}` prüft die Konfigurationsformate. Er versendet bewusst keine Mail und beweist weder Domainprüfung noch Zustellung.
4. Mindestens einen echten ViSA-Antrag mit Turnstile an ein kontrolliertes Postfach einschließlich empfangener Bestätigungs-E-Mail und erfolgreichem Linkklick prüfen. Erst nach diesem Ende-zu-Ende-Nachweis `guest_visa_payment_settings.email_enabled=true` setzen; `payment_enabled=false` lassen, bis Stripe und Preis separat freigegeben sind.

Resend Free bietet 3.000 E-Mails pro Monat, höchstens 100 am Tag. Die SaS-Datenbank begrenzt seit der Migration `20261027_visa_monthly_mail_quota.sql` auf 100 Claim-Versuche pro Tag und 3.000 neue Queue-Einträge pro Berliner Kalendermonat. Die zusätzliche harte Resend-Free-Quote bleibt maßgeblich; kostenpflichtige Übermengen müssen deaktiviert bleiben.

## Gmail und Pi

- `VISA_EMAIL_PROVIDER=gmail`: unveränderte bisherige Standardroute. Die Gmail-Autorisierung meldet derzeit `invalid_grant`.
- `scripts/visa-mail-worker.py`: bestehende Alternative auf einem Raspberry Pi per GMX-SMTP (`mail.gmx.net`, Port 587 mit STARTTLS oder 465 mit SMTPS). Zugangsdaten bleiben ausschließlich auf dem Pi; der Worker verwendet nur die abgesicherte `visa-mail-bridge`.
- **Nicht zwei Dispatcher parallel aktivieren:** Vor Umstellung auf den Pi den Supabase-Cron-Versand kontrolliert deaktivieren und angefangene Queue-Leases auslaufen lassen.
- Der Pi-Versand braucht einen dauerhaft erreichbaren Pi und aktives Netzwerk. Bei nächtlicher WLAN-Abschaltung verzögern sich Mails.

Referenzen: https://resend.com/pricing ; https://resend.com/blog/engineering-idempotency-keys
