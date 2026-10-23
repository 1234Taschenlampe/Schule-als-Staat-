# Öffentliches ViSA – E-Mail-Bestätigung und echte Euro-Zahlung

**Aktuelle Empfehlung:** Der E-Mail-Versand erfolgt ohne Raspberry Pi per Gmail API in Supabase Edge Functions. Anleitung: [VISA_GMAIL_CLOUD.md](VISA_GMAIL_CLOUD.md). Der hier beschriebene Pi-/SMTP-Weg bleibt eine optionale Alternative.

## Status
Der Code ist vorbereitet, aber **vorläufig vollständig gesperrt**:
- `guest_visa_payment_settings.email_enabled = false`
- `guest_visa_payment_settings.payment_enabled = false`
- `price_cents = 0`
- Keine Stripe- oder SMTP-Schlüssel im Repository oder Browser.
- Keine echten Zahlungen, bis Schule/Träger, rechtlicher Zahlungsempfänger, Preis, Rückgabe-/Erstattungsregelung und Datenschutz abgeklärt sind.

## Geplanter Ablauf
1. Öffentliches Formular `/#visa-onboarding` ohne Schülerkonto.
2. Cloudflare Turnstile; serverseitige Kontrolle in Edge Function `visa-request`.
3. Supabase legt `pending_email` an, erzeugt einen zufälligen 256-Bit-Token, speichert ausschließlich den SHA-256-Hash im Prüfregister und stellt eine Mail in die geschützte Queue.
4. Eine serverseitige Supabase Edge Function sendet Verifizierungs-E-Mails mit der Gmail API aus der geschützten Warteschlange. Der Pi-Mailworker ist optional, nicht erforderlich.
5. Link `/#visa-verify=<token>` bestätigt die E-Mail im Server. Er gilt 7 Tage.
6. Der Besucher kann anschließend Stripe Checkout aufrufen. Preis und EUR-Währung kommen ausschließlich aus der Datenbank. Checkout akzeptiert Karten; Apple Pay und Google Pay werden bei passenden Geräten/Konten durch Stripe angeboten.
7. `visa-stripe-webhook` prüft die Stripe-HMAC-Signatur und die bezahlte Checkout-Sitzung (exakte ID, exakter Bruttobetrag in EUR). Erst dann wird `paid` gespeichert. Die Success-Seite hat **keine** Schreibberechtigung.
8. Verwaltung prüft den bezahlten Antrag. Bezahlt bedeutet **nicht automatisch genehmigt**.

## Erforderliche Einrichtung vor Liveschaltung

1. **Schule/Träger** legt Zahlungsempfänger (rechtlich verantwortliches Stripe-Händlerkonto), Preis in EUR, Widerruf/Erstattung, Zahlungsgebühren und Datenschutzhinweise fest. Nicht über ein ungeprüftes Schüler-Privatkonto abrechnen.
2. **Cloudflare Turnstile** für Host `schule-als-staat.schule-als-staat-jfe.workers.dev` anlegen. Öffentlichen Sitekey nur in `guest_visa_payment_settings.turnstile_site_key`, geheimen Wert als Supabase Edge Secret `TURNSTILE_SECRET` hinterlegen.
3. **Stripe** Händlerkonto verbinden; `STRIPE_SECRET_KEY` als Supabase Edge Secret setzen. Webhook-Adresse: `https://wdebwgcferieedkpqbvk.supabase.co/functions/v1/visa-stripe-webhook`. Ereignisse `checkout.session.completed` und `checkout.session.async_payment_succeeded`. Signing Secret als `STRIPE_WEBHOOK_SECRET` hinterlegen. Zuerst nur Stripe-Testmodus und simulierte Checkout-Zahlungen prüfen.
4. **Optionaler Pi-Mailserver (nicht empfohlen für die Google-Variante)**: eigenständigen zufälligen Bridge-Secret-Wert mit mindestens 32 Zeichen sowohl auf dem Pi als auch im Supabase Edge Secret `VISA_MAIL_WORKER_SECRET` hinterlegen. SMTP-Konto mit erlaubtem Versandvolumen wählen. Die Pi-Konfiguration und App-Passwörter gehören ausschließlich in lokale Root-geschützte Umgebungsvariablen, niemals ins Repo oder in den Browser.
5. **Nur für die alternative Pi-SMTP-Variante:** `scripts/visa-mail-worker.py` auf dem Pi unter einem eingeschränkten Systembenutzer starten (z. B. alle 60 Sekunden durch systemd timer). Nötige Umgebungsvariablen: `VISA_MAIL_BRIDGE_URL=https://wdebwgcferieedkpqbvk.supabase.co/functions/v1/visa-mail-bridge`, `VISA_MAIL_WORKER_SECRET`, `VISA_SMTP_HOST`, `VISA_SMTP_PORT`, `VISA_SMTP_USERNAME`, `VISA_SMTP_PASSWORD`, `VISA_SENDER_EMAIL`. Optional `VISA_MAX_EMAILS_PER_RUN=10`, `VISA_MIN_SECONDS_BETWEEN_SENDS=3`.
6. **Vor Freigabe** mit zwei Testadressen und einem Stripe-Testkonto verifizieren: Bot ohne gültigen Turnstile-Token scheitert; falsche E-Mail-Tokens scheitern; vor Verifizierung kein Checkout; ein Stripe-Erfolg ohne signierten Webhook erzeugt kein Guthaben; falscher Betrag und doppelte Webhooks werden verworfen; sichere Geräteanzeige und Zahlungsabbruch.
7. **Erst danach** `email_enabled=true` aktivieren, sobald Turnstile und der gewählte Cloud-Gmail- oder alternative SMTP-Versand produktiv getestet sind. `price_cents` auf den beschlossenen **Centbetrag** setzen und `payment_enabled=true` erst nach erfolgreichem Test der Webhooks und Checkout-Konfiguration. Der Datenbank-Constraint blockiert eine Bezahlfreigabe bei Preis 0.

## Sicherheits- und Betriebshinweise
- Der öffentliche SQL-RPC `submit_guest_visa` ist für `anon` und `authenticated` gesperrt. Die Edge Function ist der einzige Antragsweg.
- Supabase RLS sperrt Gastanträge/Token/Outbox für unberechtigte Nutzer. Nur Verwaltung erhält eine Lesepolicy auf Gastanträge.
- E-Mail-Bestätigung allein verhindert **nicht** massenhafte Bot-Anfragen. Turnstile Siteverify, Drosselung, Monitoring, tägliche Provider-Limits und optional Cloudflare WAF ergänzen sich.
- Für 2.000 E-Mails pro Tag muss das SMTP-/Gmail-/GMX-Konto dieses Limit zulassen. Ein Raspberry Pi umgeht Provider-Limits nicht. Queue und langsame Wiederholungen vermeiden aber Überlast.
- **Keine** automatische Visa-Genehmigung nach Bezahlung. Rückbuchungen und Erstattungen müssen vor Liveschaltung organisatorisch und technisch berücksichtigt werden.
- Niemals `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, SMTP-App-Passwörter, Edge Secrets oder Supabase `service_role` in GitHub committen.
