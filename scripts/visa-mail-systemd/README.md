# Cluster 3: leichter GMX-Versand für ViSA

Nur Versand von E-Mail-Bestätigungslinks. Keine Buchungen, Zahlungen oder Änderungen an Bürgerkonten. **Ohne erfolgreiche Linkbestätigung kein ViSA.**

## Automatischer Start nach Stromverlust

`sas-visa-mail.timer` ist ein systemd-Timer, der alle zwei Minuten `sas-visa-mail.service` startet. Der Python-Worker verarbeitet maximal zwei Warteschlangeneinträge pro Durchlauf und beendet sich danach. Der Timer läuft nach einem Neustart automatisch weiter. Kein ständig laufender Agent, keine zusätzliche Cloud-Dienstgebühr. Bei abgeschaltetem Internet wird später erneut versucht.

```sh
sudo bash scripts/visa-mail-systemd/install.sh
# Auf cluster3 die echte Environment-Datei ausschließlich lokal anlegen:
sudo install -m 0600 -o root -g root /dev/null /etc/sas-visa-mail.env
sudoedit /etc/sas-visa-mail.env
# Nur die Parameternamen und Platzhalter aus scripts/visa-mail-systemd/visa-mail.env.example verwenden.
sudo systemctl enable --now sas-visa-mail.timer
systemctl list-timers sas-visa-mail.timer
sudo systemctl status sas-visa-mail.timer --no-pager
sudo journalctl -u sas-visa-mail.service -n 30 --no-pager
```

**Secrets:** GMX-App-Passwort und ein eigenständiges zufälliges 256-Bit-`VISA_MAIL_WORKER_SECRET` ausschließlich in `/etc/sas-visa-mail.env` (root:root, Modus 0600) und im Supabase-Edge-Secret `VISA_MAIL_WORKER_SECRET` hinterlegen. Nicht im Repo, in Codex-Chats, Prozessen mit `set -x`, Screenshots oder Logs. Keine `SUPABASE_SERVICE_ROLE_KEY` auf cluster3.

Wenn der bekannte App-Passwort-Eintrag `SAS` bei GMX existiert, aber der einmalig angezeigte Wert nicht mehr bekannt ist: neues App-Passwort generieren und das alte erst nach erfolgreicher Umstellung löschen. GMX verlangt passende SMTP-Freischaltung. Port 587 nutzt verifizierendes STARTTLS; alternativ im bestehenden Worker Port 465 für SMTP_SSL.

## Freigabe-Ablauf (reales Ende-zu-Ende-Verhalten)

1. Über SSH verifizieren, dass der Zielrechner wirklich **cluster3** ist, bevor Dateien angelegt oder Dienste geändert werden. Laufende Hermes-Sprachdienste dürfen nicht beeinträchtigt werden.
2. Supabase `visa-mail-bridge` mit `VISA_MAIL_WORKER_SECRET` konfigurieren. Vorhandene Cron-Route `visa-gmail-dispatch-safeguarded` **vor Pi-Aktivierung deaktivieren**; nie zwei Worker dieselbe Queue abarbeiten lassen.
3. GMX SMTP über ein kontrolliertes Postfach mit echtem Empfang testen, ohne sensible Daten zu loggen. Das bestätigt noch nicht den gesamten ViSA-Ablauf.
4. Vom öffentlichen ViSA-Formular über gültiges Turnstile einen Antrag an die eigene Testadresse abschicken und `email_enabled` erst für diesen kontrollierten End-to-End-Test setzen. Falls Fehler auftreten sofort deaktivieren.
5. Bestätigungslink aus dem realen Posteingang öffnen und Datenbankstatus `email_verified_at` kontrollieren. Ungültige/abgelaufene Links müssen weiterhin scheitern. **Kein erfolgreich bestätigter Link = keine freigegebene ViSA-Berechtigung.**
6. Nur nach Erfolg `email_enabled=true` belassen. `payment_enabled=false` bleibt bis zur gesonderten, echten Stripe-Zahlungsfreigabe. Keine Gebühren oder Upgrades.
7. Neustarttest `sudo systemctl reboot` **nur nach ausdrücklicher Freigabe**, alternativ einen kontrollierten `systemctl restart sas-visa-mail.timer` durchführen und `systemctl is-enabled sas-visa-mail.timer` prüfen. Stromverlust nicht simulieren.
8. Cluster3 priorisiert Hermes-Audio: Worker limitiert auf 128 MB/20 % CPU. Niemals Hermes stoppen oder umkonfigurieren.

## Hinweis zu Passwörtern und unbeaufsichtigtem Betrieb

Bei `sudoedit` bzw. einer sicheren lokalen Eingabemaske eintragen; Passwort niemals in Codex-Aufgabenbeschreibungen oder an ChatGPT senden. Der Service startet nach einem Stromverlust automatisch, aber das ist kein Ersatz für eine unabhängige Verfügbarkeitsüberwachung. Falls das WLAN nachts abgeschaltet wird, kann Versand erst nach Wiederherstellung der Verbindung erfolgen.

Serverseite: `https://wdebwgcferieedkpqbvk.supabase.co/functions/v1/visa-mail-bridge`.
