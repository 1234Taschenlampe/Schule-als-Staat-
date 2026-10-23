# ViSA – Gmail API Versand ohne Raspberry Pi

Die ViSA-Verifizierung wird künftig direkt in **Supabase Edge Functions** über die Gmail API versendet. Der ältere Pi-/SMTP-Worker bleibt optional, ist aber für diese Variante nicht notwendig.

## Sicherheitszustand

- **Bis auf Weiteres deaktiviert**: `guest_visa_payment_settings.email_enabled = false`.
- Kein Cron-Auftrag ist für Gmail eingerichtet.
- Keine E-Mails werden durch bloßes Deployment gesendet.
- Ohne `VISA_GMAIL_DISPATCH_SECRET`, OAuth-Credentials und serverseitig aktivierte `email_enabled` verweigert der Dispatcher jeden Versand.
- Keine echten Zahlungen (Stripe weiterhin gesondert einzurichten).

## 1. Google Cloud – OAuth

1. Gmail API im Google-Cloud-Projekt einschalten.
2. Google Auth Platform mit Scope `https://www.googleapis.com/auth/gmail.send` konfigurieren, keine Postfach-Lese-Rechte anfordern.
3. Web application OAuth-Client erstellen.
4. Unter **Authorized redirect URIs** exakt `https://developers.google.com/oauthplayground` ergänzen.
5. Falls die App im Modus *Testing* ist, das schuleigene Gmail-Konto als Testnutzer hinzufügen.
6. [Google OAuth Playground](https://developers.google.com/oauthplayground/) öffnen, rechts oben über das Zahnrad **Use your own OAuth credentials** wählen.
7. Dort die eigenen OAuth Client ID und das Client Secret eingeben (nur auf der offiziellen Google-Seite). *Access type = Offline* und *Force prompt = Consent Screen*.
8. In Schritt 1 nur `https://www.googleapis.com/auth/gmail.send` autorisieren und mit dem **sendenden Schulkonto** anmelden.
9. In Schritt 2 **Exchange authorization code for tokens** ausführen. Den **Refresh token** vertraulich behandeln, nicht im Chat, Repo oder einem Screenshot teilen.

**Wichtig:** Bei *External + Testing* können Refresh Tokens mit Gmail-Scope nach sieben Tagen ablaufen. Für Dauerbetrieb ist die OAuth-Publishing-/Verifizierungsstrategie separat zu klären. Siehe offizielle [Google OAuth Docs](https://developers.google.com/identity/protocols/oauth2/#expiration).

## 2. Supabase Secrets

Unter https://supabase.com/dashboard/project/wdebwgcferieedkpqbvk/settings/functions die folgenden Server-Secrets setzen:

| Name | Wert |
| --- | --- |
| `GMAIL_CLIENT_ID` | OAuth Web Client ID aus Google Cloud |
| `GMAIL_CLIENT_SECRET` | zugehöriges OAuth Client Secret |
| `GMAIL_REFRESH_TOKEN` | Refresh Token aus Google OAuth Playground |
| `GMAIL_SENDER_EMAIL` | das Gmail-Konto, mit dem Google autorisiert wurde |
| `VISA_GMAIL_DISPATCH_SECRET` | neu erzeugter zufälliger 32+-Zeichen-Schlüssel, nur für den Cron-Aufruf |

`VISA_GMAIL_BATCH_SIZE` ist optional und standardmäßig **1** pro Cron-Lauf, maximal **2**.

**Wichtig**: Die Secret-Werte gehören ausschließlich in das Supabase-Dashboard bzw. einen privilegierten Secret-Manager. Nicht in `config.js` oder in öffentliche GitHub-Dateien.

## 3. Gmail API Dispatcher

Die Edge Function ist `visa-gmail-dispatch`. URL:

`https://wdebwgcferieedkpqbvk.supabase.co/functions/v1/visa-gmail-dispatch`

Akzeptiert ausschließlich `POST` mit dem Header:

`Authorization: Bearer <VISA_GMAIL_DISPATCH_SECRET>`

Ihre Verarbeitung:

1. Secrets und gesperrte öffentliche ViSA-E-Mail-Funktion prüfen.
2. Google Access Token mit dem Refresh Token erneuern.
3. Maximal 1–2 Versandaufträge aus der Supabase-RLS-geschützten Warteschlange leasen.
4. Verifizierungs-E-Mail via `users.messages.send` versenden.
5. Erfolg/Fehler serverseitig zurück in die Queue schreiben.

Der SQL-Counter `guest_visa_mail_quota.daily_dispatch_limit` begrenzt derzeit zusätzlich auf **100 pro Tag**, Lebenszeitlimit derzeit **3.000**. Vor höherem Tagesvolumen Provider-Quoten verbindlich prüfen, nicht blind erhöhen.

## 4. Cron später einschalten

Erst nach einem erfolgreichen End-to-End-Test:

- `pg_cron`/Supabase Cron Job im Dashboard anlegen, z. B. alle 60 Sekunden.
- Das Cron-Secret im **Supabase Vault** speichern, niemals als Klartext in die SQL-Jobdefinition einbetten.
- Die Funktion per POST mit dem Header `Authorization: Bearer ...` aufrufen.
- Zusätzlich Bot-Schutz (**Turnstile**, einschließlich Secret) einrichten und die Mail-Funktion `email_enabled` explizit aktivieren.
- Monitoring bei Gmail-Fehlern, gesperrten Google-Tokens und fehlgeschlagenen Queue-Zustellungen vorsehen.

Die drei Secrets von Stripe und der echte Preis bleiben unabhängig davon weiterhin unkonfiguriert. Eine erfolgreiche E-Mail-Verifizierung ist keine Bestätigung einer Zahlung.

## Hinweise

- Gmail API kostet bei regulärer Verwendung innerhalb der vorgesehenen Nutzungslimits keine zusätzliche API-Gebühr; Gmail-Versandlimits des Kontos gelten trotzdem.
- Private Gmail-Konten sind **nicht** für garantierte 2.000 E-Mails pro Tag geeignet.
- Der Zugang zum Google-Postfach wird **ausschließlich für das Absenden** autorisiert, nicht für Lesen oder Löschen.
- Bei einem Fehler im Acknowledge-Schritt ist ein doppelter Versand technisch möglich. Das Monitoring muss dieses Verhalten berücksichtigen.
