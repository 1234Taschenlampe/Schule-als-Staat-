# Schule als Staat – V4 (Projektname; Staatsname noch offen)

Responsive Projektplattform mit digitalen Guthaben, QR-Kassenzahlungen, Bargeldbuchungen und Schulabstimmungen.

> **Stand:** V4-Quellcode. Das GitHub-Repository war bei Projektbeginn leer. Die vorherigen Website-Versionen wurden **nicht** automatisch übernommen. Produktion ist erst nach Einrichtung von Supabase, Rollen, Veröffentlichung und Ende-zu-Ende-Tests nutzbar.

## Funktionsumfang

- Ruhiges, barrierearmes Fluent-/Apple-inspiriertes UI, für Smartphone, Tablet und Desktop.
- Supabase E-Mail-Login. Kontostand und Buchungen werden in PostgreSQL gespeichert; keine clientseitig manipulierbaren Salden.
- Kasse: Einmalige QR-Zahlungsanforderung mit Betrag, Empfänger, Ablaufzeit. Käufer scannt den QR-Code und **bestätigt selbst** die Zahlung.
- Transaktionale Belastung/Gutschrift in derselben Datenbanktransaktion. Zweitaufrufe können keine doppelte Zahlung bewirken.
- Bargeldkasse: separater Umsatzdatensatz, **keine** falsche Belastung des digitalen Guthabens.
- Browser-Kamera nur auf Nutzeraktion, HTTPS, Stop bei Navigation; Bild-/Manuelleingabe und Link-Fallback.
- Abstimmungen mit mehreren Antworten, administrativer Freischaltung und aggregierter Live-Auswertung.
- Genau eine Stimme pro freigeschaltetem Konto und Abstimmung; keine automatische Gleichsetzung eines Kontos mit einer Person.
- Der endgültige Staatsname wird erst abgestimmt und ist in V4 ausdrücklich nicht vorgegeben.
- Datenschutz: RLS, eingeschränkte RPC-Rechte, keine geheimen API-Schlüssel im Client. Keine Kreditkarten-/Echtgeldabwicklung.

## Voraussetzungen zur echten Mehrgeräte-Nutzung

1. Kostenloses Supabase-Projekt erstellen (PostgreSQL + Auth), E-Mail-Login konfigurieren.
2. Im SQL-Editor zuerst `supabase/schema.sql`, anschließend `supabase/v4_voting.sql` ausführen. Vor produktiver Nutzung Schema/Aufbewahrung rechtlich und funktional abnehmen.
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
- [ ] Namenswahl mit echten Vorschlägen erstellt, Wahlberechtigung schulintern geprüft
- [ ] Nicht freigeschaltetes Konto kann nicht wählen
- [ ] Doppelte Wahl inklusive paralleler Requests abgewiesen
- [ ] Nur Admin erhält Live-Ergebnis; individuelle Stimmzettel sind nicht öffentlich
- [ ] Nach Schließen ist keine weitere Stimmabgabe möglich
- [ ] Mobile Navigation enthält Abstimmungen
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


## Abstimmungen

1. Beide SQL-Dateien einspielen: zuerst supabase/schema.sql, danach supabase/v4_voting.sql.
2. Als Administration anmelden, die ersten Benutzerkonten prüfen und unter Einstellungen > Stimmberechtigungen einzelne Schulangehörige freigeben. Neue Konten sind **nicht automatisch wahlberechtigt**.
3. Unter Abstimmungen die Frage, Beschreibung und 2–10 Antwortoptionen eingeben (beispielsweise die echten Namensvorschläge), dann veröffentlichen.
4. Freigeschaltete Benutzer geben eine Stimme pro Abstimmung und Konto ab. Ein Datenbank-Primärschlüssel verhindert doppelte Stimmen, auch wenn Anfragen parallel eintreffen.
5. Die Administration sieht aggregierte Zähler und Prozentwerte mit regelmäßiger Aktualisierung ungefähr alle 5,5 Sekunden; sie kann eine Wahl schließen.

### Datenschutz und Sicherheitsgrenzen

- Die Speicherung umfasst Wahl-ID, Konto-ID, Antwort-ID und Zeitstempel in PostgreSQL, nicht in GitHub.
- Ergebnislisten zeigen aggregierte Stimmen; einzelne Stimmzettel sind über die Nutzeroberfläche nicht abrufbar.
- **Nicht kryptografisch anonym:** Wer die Datenbank administriert, könnte Stimmzettel Personen zuordnen. Für tatsächlich geheime Wahlen ist ein separates überprüftes System erforderlich.
- **Ein Konto ist nicht gleich eine Person.** Schulseitige Identitätskontrolle, Einladungssystem oder SSO sind notwendig, um Mehrfachaccounts auszuschließen. Admin-Freigabe allein ersetzt eine Identitätsprüfung nicht.
- Vor Nutzung mit Schülerdaten: Schulleitung und Datenschutzbeauftragte einbeziehen, Verantwortlichkeit, Löschfristen, Hosting-/Auftragsverarbeitung und Auskunftsrechte prüfen.

## Auf der Schulwebseite bereitstellen

Die bestehende Schule-Domain kann die statische Oberfläche in einem Unterordner wie /schule-als-staat/ hosten. Die aktuelle V4 benötigt weiterhin das Backend über Supabase (Auth, PostgreSQL und RPCs), das getrennt erreichbar sein darf. Backend und Schulwebseite müssen **nicht auf demselben Server** betrieben werden.

Ein Schulserver mit eigenem Node.js/PostgreSQL oder PHP/MySQL kann prinzipiell alles hosten. Das bisherige Supabase-Backend wäre dafür allerdings auf die bereitgestellte Technik zu portieren oder selbst zu hosten. Das ist noch nicht geschehen. Entscheidend sind vorhandene Hosting-Rechte, HTTPS, Backups, Mailzustellung, Logging, Updates und Datenschutz.

GitHub ist für Quellcode und Versionierung, **nicht** für verschlüsselte oder unverschlüsselte Stimmzettel, Wallets oder Kassendaten. GitHub Pages hostet ausschließlich die statische Oberfläche, keine SQL-Datenbank.

## GitHub Pages einschalten

Auf GitHub: Repository → Settings → Pages → Build and deployment → Source → GitHub Actions. Die Workflowdatei liegt schon unter .github/workflows/pages.yml. Die Freischaltung erfordert passende Repo-/Abo-Berechtigung. Mit GitHub Free sind private Repositorys für GitHub Pages nicht geeignet; das Repository hier ist privat. Die GitHub-Action scheitert aktuell bei Configure Pages, weil Pages nicht eingerichtet ist.

Alternativ das private Repository mit einem statischen HTTPS-Host verbinden oder die vier Dateien index.html, styles.css, app.js und config.js unter einem freigegebenen Schulweb-Pfad bereitstellen. Die echte Webadresse muss auch als Supabase Auth-Redirect eingetragen werden.

## Verifizierungsstand

Der Quellcode ist gespeichert, aber noch **nicht produktiv in Betrieb**: Es gibt keine angeschlossene Supabase-Instanz, keine ausgeführten SQL-Skripte, keinen End-to-End-Test mit echten Browsern und noch keine öffentliche URL. Zahlungen und Abstimmungen dürfen erst nach diesen Schritten als funktionierend bezeichnet werden.

### Kamera und Einbindung in die Schulwebseite

Die Projektplattform sollte als **echter HTTPS-Unterpfad** oder über eine eigene Subdomain ausgeliefert werden, **nicht** über ein eingebettetes iframe. Ein iframe kann Browser-Kamerarechte durch seine Permissions-Policy blockieren. Falls ein iframe unvermeidbar ist, muss die Schul-IT sowohl die übergeordnete Permissions-Policy als auch das iframe-Attribut für die Kamera korrekt konfigurieren; ansonsten darf die App weiterhin QR-Bild und Zahlungslink als Alternative anbieten. Der Browser fragt seine Kameraberechtigung stets beim Benutzer an – sie kann nicht administrativ per JavaScript erzwungen werden.

## Cloudflare Pages und Cloudflare-Agent

Die geprüften, projektspezifischen Einrichtungsschritte stehen in [Cloudflare-Setup](docs/CLOUDFLARE_SETUP.md). Für Codex wurden zusätzlich im Repository [AGENTS.md](AGENTS.md) Cloudflare-Skills, MCP, Build-Einstellungen und Sicherheitsgrenzen dokumentiert. Das Cloudflare-Konto muss vom Inhaber per OAuth beziehungsweise über das Cloudflare-Dashboard verbunden werden; es liegt noch keine bestätigte Cloudflare-Deployment-URL vor.
