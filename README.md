# Neß Vegas · Schule als Staat — V4

Responsive Web-App für digitale Guthaben, QR-Kassenzahlungen und **separat protokollierte Bargeldumsätze**.

> **Stand:** V4-Quellcode. Das GitHub-Repository war bei Projektbeginn leer. Die vorherigen Website-Versionen wurden **nicht** automatisch übernommen. Produktion ist erst nach Einrichtung von Supabase, Rollen, Veröffentlichung und Ende-zu-Ende-Tests nutzbar.

## Funktionsumfang

- Ruhiges, barrierearmes Fluent-/Apple-inspiriertes UI, für Smartphone, Tablet und Desktop.
- Supabase E-Mail-Login. Kontostand und Buchungen werden in PostgreSQL gespeichert; keine clientseitig manipulierbaren Salden.
- Kasse: Einmalige QR-Zahlungsanforderung mit Betrag, Empfänger, Ablaufzeit. Käufer scannt den QR-Code und **bestätigt selbst** die Zahlung.
- Transaktionale Belastung/Gutschrift in derselben Datenbanktransaktion. Zweitaufrufe können keine doppelte Zahlung bewirken.
- Bargeldkasse: separater Umsatzdatensatz, **keine** falsche Belastung des digitalen Guthabens.
- Browser-Kamera nur auf Nutzeraktion, HTTPS, Stop bei Navigation; Bild-/Manuelleingabe und Link-Fallback.
- Datenschutz: RLS, eingeschränkte RPC-Rechte, keine geheimen API-Schlüssel im Client. Keine Kreditkarten-/Echtgeldabwicklung.

## Voraussetzungen zur echten Mehrgeräte-Nutzung

1. Kostenloses Supabase-Projekt erstellen (PostgreSQL + Auth), E-Mail-Login konfigurieren.
2. Im SQL-Editor `supabase/schema.sql` **einmal vollständig** ausführen. Vor produktiver Nutzung Schema/Aufbewahrung rechtlich und funktional abnehmen.
3. In `config.js` **nur** Projekt-URL und **publishable/anon key** eintragen. Niemals `service_role`, Datenbankpasswort oder private Schlüssel eintragen.
4. Unter Supabase Authentication > URL Configuration die öffentliche HTTPS-URL als **Site URL** und erlaubte **Redirect URL** eintragen, sonst funktioniert der E-Mail-Link nicht.
5. Benutzer einmal anmelden lassen. Danach über den SQL-Editor (mit Admin-Rechten) Rollen zuweisen:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'admin@example.org');
   update public.profiles set role = 'cashier'
   where id = (select id from auth.users where email = 'kasse@example.org');
   ```
6. Admin kann nach Anmeldung über die SQL-RPC `issue_credits` (oder den SQL-Editor) Testguthaben zuteilen; siehe Schema. **Keine echten Geldbeträge**.
7. Website per HTTPS deployen. `.github/workflows/pages.yml` ist für GitHub Pages vorbereitet. Beim **privaten** GitHub-Repository kann GitHub Pages je nach Tarif eingeschränkt sein. Eine Veröffentlichung und die nötigen Repository-Einstellungen sind **nicht automatisch aktiviert**. Alternativ statische Dateien auf Cloudflare Pages oder Netlify bereitstellen.
8. Mit zwei echten, getrennten Smartphone-Logins Zahlung testen (Kassierer und Käufer), Browser Safari/Chrome/Firefox prüfen, Ablaufzeit, Doppelzahlung und Bargeld getrennt prüfen.

## Sicherheitsmodell

- Die QR-Zahlungsanforderung bezeichnet **Betrag und Empfänger**, niemals ein frei belastbares Kundenkonto.
- Erst der authentifizierte Käufer bestätigt serverseitig die Zahlung.
- Guthabenänderungen sind nur über gesicherte Postgres-Funktionen möglich; RLS schützt persönliche Daten.
- Kassenpersonal kann keine Guthaben anderer Nutzer ohne deren Freigabe abbuchen.
- Kamera-Streams werden nicht gespeichert oder auf Server hochgeladen.
- Bargeld ist ein Umsatzprotokoll ohne Auswirkung auf die digitale Wallet; tatsächliche Kassenbestände müssen getrennt abgestimmt werden.
- Zahlungen in dieser Version sind für eine **interne, virtuelle Schulwährung**, nicht für Kartenanbieter/SEPA/Stripe. Bei Echtgeld sind zusätzliche Provider-, Rechts-, Steuer- und Jugendschutzanforderungen nötig.
- `config.js` enthält absichtlich keine gültige Verbindung. Vor Einrichtung zeigt die Oberfläche keinen vorgetäuschten erfolgreichen Zahlungsbetrieb.

## Lokale Vorschau

Dateien über einen lokalen Webserver öffnen, z. B. `python -m http.server 8080`, dann `http://localhost:8080`. Für reale mobile Kameratests die **veröffentlichte HTTPS-Seite** öffnen. Eine einfache `file://`-Dateiansicht reicht nicht für alle Browser-APIs.

## Tests vor Freigabe

- [ ] SQL-Migration ohne Fehler eingespielt; RLS aktiv
- [ ] E-Mail-Login, Sessionwechsel, Abmeldung
- [ ] Rolle `member` darf nicht kassieren oder Cash Sales erzeugen
- [ ] Rolle `cashier` darf eigene Zahlungsanforderungen ausstellen
- [ ] Käufer kann Betrag/Empfänger prüfen, muss explizit bestätigen
- [ ] Doppelter Scan/Zahlungsaufruf bewirkt genau **eine** Abbuchung
- [ ] Guthabenmangel blockiert Zahlung
- [ ] Fremde Wallets und Cash Sales sind nicht lesbar
- [ ] Bargeld berührt Wallets nicht
- [ ] QR-Kamera auf Android Chrome, Firefox und iPhone Safari (HTTPS, direkt geöffnet)
- [ ] Fallback über Fotoupload, Link und manuelle Eingabe
- [ ] Smartphone klein/groß, Tablet, Desktop, Hoch-/Querformat, Zoom 200 %
- [ ] Supabase E-Mail-Zustellbarkeit, Limits, Backup- und Ausfallkonzept geklärt


## Empfohlenes öffentliches Hosting bei privatem GitHub-Repository

**Cloudflare Pages** kann GitHub-Repositorys auch dann verarbeiten, wenn der GitHub-Quellcode privat bleibt.

1. Cloudflare Dashboard > **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
2. GitHub-Zugriff auf \`1234Taschenlampe/Schule-als-Staat-\` freigeben.
3. Produktionsbranch \`main\`, Framework **None**, Build Command \`sh scripts/build-static.sh\`, Build Output Directory \`_site\` wählen.
4. **Save and Deploy**. Cloudflare gibt eine öffentliche HTTPS-URL unter \`*.pages.dev\` aus.
5. Diese URL in Supabase Auth als Site URL und Redirect URL konfigurieren.

Der Veröffentlichungsprozess erstellt absichtlich nur \`index.html\`, \`app.js\`, \`config.js\` und \`styles.css\` als öffentliche Dateien. Das SQL-Schema und andere Repositorydateien werden nicht als Website ausgeliefert.

**Ohne Cloudflare-Verbindung, Pages-Aktivierung und Supabase-Einrichtung ist die Seite noch nicht öffentlich produktiv.**
