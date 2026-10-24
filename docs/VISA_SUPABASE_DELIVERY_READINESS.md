# ViSA-Mailversand: geprüftes Produktionsproblem und sichere Inbetriebnahme

Stand: 24.10.2026. Alle hier dokumentierten Zustandsabfragen waren **read-only**.

## Wo der Fehler liegt

Die Website verwendet Supabase Edge Functions für den Visa-Mailablauf, aber **Supabase stellt für selbstdefinierte Visa-E-Mails keinen automatischen Gmail-Absender bereit**. Ein Gmail-/Google-OAuth-Absender muss gesondert legitimiert und als Edge-Secrets eingerichtet sein.

Produktionsdiagnose:

- `visa-gmail-dispatch` ist aktiv (Version 7).
- Supabase Cron `visa-gmail-dispatch-safeguarded` läuft minütlich. Es wurden mindestens 1.687 erfolgreiche **SQL-Jobausführungen** gezählt; dies ist **kein** Beleg für eine Gmail-Zustellung.
- Die Funktion verlangt `VISA_GMAIL_DISPATCH_SECRET` im Edge-Environment.
- Derselbe Wert muss unter dem Vault-Namen `visa_gmail_dispatch_secret` hinterlegt werden, damit der Cron-Job den Dispatch authentifiziert.
- **Der Supabase Vault hatte 0 Einträge**. Damit fehlt dieser Authentifizierungsweg.
- `guest_visa_payment_settings.email_enabled=false`; `turnstile_site_key` ist `NULL`.
- Die Outbox und die Gästebewerbungstabelle waren leer. Es gibt deshalb aktuell keine Mail zum Versenden.
- Der live deployte Dispatcher unterstützt bereits `{"mode":"check"}` als **authentifizierten OAuth-Check ohne Mailversand**. Die GitHub-Version wurde an die tatsächliche Deploy-Version angeglichen.

## Reihenfolge zur Behebung (ohne neue kostenpflichtige Dienste)

1. In Google Cloud Gmail API für ein **berechtigtes Schulprojekt-Versandkonto** aktivieren. OAuth-Client für `gmail.send` konfigurieren, gültigen Refresh Token mit Offline-Access ausstellen. Ist die OAuth-App im Testing-Modus, kann der Refresh Token nach sieben Tagen ablaufen; Dauerbetrieb separat absichern.
2. **Nur im Supabase Dashboard** unter `Project → Edge Functions → Secrets` folgende Namen mit echten Werten einrichten:
   - `GMAIL_CLIENT_ID`
   - `GMAIL_CLIENT_SECRET`
   - `GMAIL_REFRESH_TOKEN`
   - `GMAIL_SENDER_EMAIL`
   - `VISA_GMAIL_DISPATCH_SECRET` — neuer zufälliger Wert mit mindestens 32 Zeichen
   - `TURNSTILE_SECRET` — nach Einrichtung eines Cloudflare Turnstile Widgets für die produktive Website
3. Unter Supabase `Database → Vault` einen Secret-Eintrag **`visa_gmail_dispatch_secret`** anlegen. Sein Inhalt muss **identisch** mit dem Edge-Secret `VISA_GMAIL_DISPATCH_SECRET` sein. Niemals die beiden Werte in GitHub, Chat, öffentliche Konfiguration oder Cron-SQL hineinkopieren.
4. Cloudflare Turnstile Site-Key (öffentlich) in `public.guest_visa_payment_settings.turnstile_site_key` konfigurieren; den geheimen Siteverify-Wert nur als `TURNSTILE_SECRET` eintragen.
5. Den authentifizierten `visa-gmail-dispatch`-POST mit `{"mode":"check"}` **nur über eine privilegierte Umgebung** aufrufen. Er prüft den Google Refresh Token, gibt `oauth_refresh_valid`, `email_enabled` und `turnstile_site_key_present` zurück und verschickt **keine** Mail. Das Geheimnis niemals als URL-Parameter übergeben.
6. Erst nach erfolgreichem Preflight und Tests mit eigenen Testadressen `email_enabled=true` freigeben. **`payment_enabled=false` lassen**. Den tatsächlichen Versand und die Bestätigung mindestens einer Test-Mail nachweisen. `cron.job_run_details.status='succeeded'` allein genügt nicht; auch die Mail-Queue und Gmail-Erfolg müssen überprüft werden.
7. Testläufe: validierter Turnstile-Token, vollständiger Antrag, Email in Outbox, Gmail-Msg-ID, Linkprüfung; ungültige und abgelaufene Links, Queue-Retry, Tageslimit sowie Missbrauchsschutz.
8. Erst danach Zahlungsempfänger, Preis, Stripe-Gebühren, Test-Webhooks und einen getrennten finanziellen Freigabeprozess für die Bezahlfunktion aufsetzen.

### Sichere Datenbank-Statusabfrage (keine Secrets)

```sql
select email_enabled, payment_enabled, turnstile_site_key is not null as turnstile_ready
from public.guest_visa_payment_settings where singleton;
select count(*) as pending_messages from public.guest_visa_mail_outbox where status in ('queued','leased');
select name from vault.secrets where name='visa_gmail_dispatch_secret';
select jobname, active, schedule from cron.job where jobname='visa-gmail-dispatch-safeguarded';
```

**Wichtig:** Das verbesserte GitHub-Testing für den Dispatcher verwendet nur simulierte Secrets und Mock-Netzwerke. Es sendet keine Nachricht und kann eine echte OAuth-Autorisierung oder eine echte Gmail-Zustellung **nicht** ersetzen. Die Freischaltung bei fehlenden Schlüsseln wäre ein Sicherheitsfehler, keine Reparatur.
