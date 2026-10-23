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

## Stand 23.10.2026 – automatisch vorbereitet, weiterhin gesperrt

In Supabase ist die Funktion `visa-gmail-dispatch` (Version 7) mit dem geschützten Testmodus `{"mode":"check"}` bereitgestellt. Diese Prüfung benötigt einen gültigen `Authorization: Bearer <VISA_GMAIL_DISPATCH_SECRET>`-Header, erneuert ausschließlich das Google Access Token und gibt ohne Mailversand zurück, ob OAuth funktioniert.

**Verbindungstest im Dashboard:** Edge Functions → `visa-gmail-dispatch` → Test; POST mit Body `{"mode":"check"}` und dem oben genannten privaten Bearer-Header. Die Funktion gibt bei erfolgreicher Token-Erneuerung `oauth_refresh_valid:true` und `sent_messages:0` zurück. Die Anzeige beweist keine erfolgreiche Gmail-Versandberechtigung und keinen tatsächlichen Mailversand.

Migration `visa_gmail_safeguarded_cloud_scheduler_v26` installierte `pg_cron` und `pg_net` und erstellte den Job `visa-gmail-dispatch-safeguarded`, jede Minute. Der Job führt **keinen HTTP-Aufruf** aus, solange einer dieser Punkte fehlt:
- `guest_visa_payment_settings.email_enabled = true`
- `guest_visa_payment_settings.turnstile_site_key IS NOT NULL`
- Im **Supabase Vault** befindet sich der gültige verschlüsselte Secret-Eintrag `visa_gmail_dispatch_secret` (mindestens 32 Zeichen)

**Noch manuell erforderlich:** Dasselbe Passwort, das in Edge Function Secrets unter `VISA_GMAIL_DISPATCH_SECRET` liegt, muss **zusätzlich in Supabase Vault** als `visa_gmail_dispatch_secret` gespeichert werden. Der Wert muss identisch sein, sonst lehnt die Funktion die Cron-Aufrufe ab. Nicht als Klartext ins SQL-Editor-Verlaufsprotokoll oder GitHub kopieren. Aktuell ist die E-Mail-Funktion deaktiviert; Gmail-Versand wird dadurch nicht automatisch freigegeben.

Die von Nutzern zuvor im Chat veröffentlichten OAuth-Client-Secrets müssen vor dem Echtbetrieb bei Google rotiert und in Supabase aktualisiert sein. Keine Tokens oder secrets in Screenshots teilen.

