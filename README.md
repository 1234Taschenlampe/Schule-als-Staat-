# Schule als Staat – V4 (Projektname; Staatsname noch offen)

**Offizielle Live-Adresse:** https://schule-als-staat.schule-als-staat-jfe.workers.dev/

**Hosting-Regel:** Ausschließlich Cloudflare Workers ist das produktive Hosting. GitHub bleibt Code- und Test-Repository. Die bisherige GitHub-Pages-Adresse führt nur noch auf Cloudflare weiter. Veröffentlichungen und Funktionstests müssen auf Cloudflare stattfinden. Die Worker-Uploads werden derzeit manuell durchgeführt; ein GitHub-Commit allein aktualisiert Cloudflare nicht.

> **Aktueller Stand (16.10.2026): SaS ONE V6.** Die Funktionen aus V3 werden nun in einer einzigen neuen, Apple-inspirierten Oberfläche mit echtem Supabase-Backend bereitgestellt. Das alte V3-Design ist **nicht** Teil der öffentlichen Anwendung. Technische Tests sind bestanden; Schulplan, offizielle Ausweisprüfung, Datenschutzfreigaben und echte Browser-/Mehrbenutzer-End-to-End-Tests bleiben notwendige Abnahmeschritte. Details: [V6 – Funktionsstand und Abnahme](docs/V6_IMPLEMENTATION.md). **Kostenbudget: 0,00 €.**

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

## Cloudflare Workers – kostenlose Ersatzveröffentlichung (Stand 16.10.2026)

Cloudflare Pages Git-Anbindung verweigert weiterhin die Verbindung mit Fehler `8000011`. Die Website wurde deshalb als **statischer Worker** auf `https://schule-als-staat.schule-als-staat-jfe.workers.dev/` hochgeladen und für workers.dev aktiviert. Das Workers-Skript enthält nur `index.html`, `app.js`, `styles.css` und `config.js`. Keine Datenbankdaten oder geheimen Schlüssel sind enthalten.

**Wichtig:** Dieser Worker ist ein Snapshot, **nicht** automatisch mit GitHub synchronisiert. Änderungen werden beim nächsten manuellen Worker-Upload sichtbar. `node scripts/build-worker.mjs` erzeugt die vollständig gebündelte Skriptdatei unter `dist/schule-als-staat-worker.js`. Für permanente automatisierte Deployments ist künftig die GitHub-Installation von Cloudflare zu reparieren oder ein kostenloser CI-Workflow mit sicher gespeicherten, minimal berechtigten Deployment-Credentials aufzusetzen.

GitHub Pages ist inzwischen ebenfalls vorbereitet und sein Build-Workflow lief erfolgreich; die öffentliche Verfügbarkeit konnte noch nicht unabhängig vom Cloudflare- und GitHub-Deployment-Status via HTTP getestet werden.

**Anmeldung vor öffentlichem Schulbetrieb:** Supabase Free erlaubt über den eingebauten Auth-E-Mail-Dienst derzeit nur eine sehr geringe Sendefrequenz. Der E-Mail-Magic-Link-Login ist daher **nicht** für Tausende gleichzeitige erstmalige Anmeldungen geeignet. Die Schul-IT muss einen kostenlosen, leistungsfähigen alternativen SMTP-/SSO-/Einladungsweg genehmigen. Supabase Auth Redirect URLs müssen die tatsächlichen HTTPS-Hosts umfassen. Es gibt noch **keinen** Administrator im Backend, keine freigeschalteten Wähler und keine produktiv getesteten Buchungen. Nicht als voll funktionsfähige Schulkasse freigeben.

**Kostenregel:** Keine kostenpflichtigen Tarife, Abonnements, automatischen Upgrades, Zusatzdienste, gebührenpflichtigen Transaktionen oder Secrets als Repo-Dateien. Bei Quotenende stoppt die Funktion. Cloudflare Workers Free: bis zu 100.000 Requests/Tag. Jede reale Nutzung muss innerhalb der kostenlosen Kontingente bleiben.

## Erstes Administratorkonto sicher aktivieren (16.10.2026)

Die E-Mail-Adresse `jan.felix.eckert@gmail.com` ist serverseitig als vorgesehener Administrator hinterlegt. **Noch existiert für diese Adresse kein bestätigtes Supabase-Konto.** `supabase/v4_admin_bootstrap.sql` wurde bereits angewendet; die Funktion `claim_initial_admin` prüft immer die tatsächlich eingeloggte Nutzer-ID, exakt diese E-Mail-Adresse **und** `auth.users.email_confirmed_at`. Anonyme Nutzer können sie nicht aufrufen. Sie wird beim Login einmal automatisch ausgeführt.

Zum Aktivieren: Webseite öffnen → **Neues Konto mit Passwort erstellen** → persönliche Gmail-Adresse und selbst gewähltes Passwort von mindestens zwölf Zeichen eintragen → Bestätigungslink in der Gmail-Mailbox aufrufen → auf der Website mit E-Mail und Passwort anmelden. Danach wird im Backend die Adminrolle beansprucht. Nie Passwörter in GitHub, Cloudflare oder ChatGPT veröffentlichen.

**Wichtig:** Im Supabase-Dashboard unter **Authentication → URL Configuration** die echte HTTPS-Adresse der Website als Site URL bzw. Additional Redirect URLs freigeben, beispielsweise `https://schule-als-staat.schule-als-staat-jfe.workers.dev/**`. Diese Auth-Einstellung konnte nicht durch den bereitstehenden Supabase-Konnektor geändert werden. Außerdem muss in Supabase das Bestätigen von E-Mail-Adressen aktiv sein, damit nur nach tatsächlichem Inbox-Nachweis eine Adminrolle verliehen werden kann.

Aktuell existiert in Supabase nur ein zuvor angelegtes, bestätigtes Konto mit einer anderen Mailadresse. Dieses Konto wird **nicht** automatisch zum Administrator gemacht. Frei erfundene Schüler- und Kassen-Adressen sind ausschließlich Offline-Fixtures unter `tests/fictional-identities.mjs` und keine Auth-Benutzer.

Der alternative alte Magic-Link-Login erstellt ab jetzt **keine neuen Benutzerkonten** mehr; er ist nur für bereits vorhandene E-Mail-Konten. Für viele Schüler benötigt das Schulprojekt später ein sicheres, von der Schule genehmigtes Verfahren zur Kontoausgabe mit angemessener Anti-Spam-Kontrolle. Alle Vorgänge müssen innerhalb des kostenlosen Limits bleiben.

## Wiederherstellung SaS ONE V3 (16.10.2026)

Der Originalprototyp `SaS_ONE_Prototyp_v3.html` konnte aus früheren Gesprächsdateien wiederhergestellt werden. Die originalgetreue Datei liegt unter [`archive/SaS_ONE_Prototyp_v3.html`](archive/SaS_ONE_Prototyp_v3.html). Die aktive Fassung liegt unter [`portal/index.html`](portal/index.html) und ist unter `/portal/` erreichbar.

- Übernommene V3-Bereiche: Startseite, Schülerausweis, Demo-Wallet, QR-Shop, Raumreservierung, interaktiver Schulplan, Schwarzes Brett, Veranstaltungskalender, Fundbüro, Demo-Umfragen, ViSA-Onboarding, Profil, Suchfunktion und Bedienmodale.
- Ergänzte Bereiche, die im gefundenen V3-Prototyp noch nicht vollständig vorhanden waren: **Ausweis-Galerie** mit eindeutig fiktiven Musterkarten und **Projektblog** mit Demo-Beispielbeiträgen.
- V4 bleibt das **echte** Supabase-Backend für Login, Rolle, virtuelle Zahlungen und Abstimmungen. Das V3-Portal nutzt zur Zugangsprüfung dieselbe Supabase-Anmeldung und verlinkt auf V4.
- V5 ergänzt die Tabelle `portal_posts` mit Row-Level Security. Bestätigte Mitglieder können veröffentlichte Nachrichten lesen; ausschließlich Admins können im V3-Portal echte Nachrichten des Schwarzen Bretts und Blogs veröffentlichen oder löschen.
- Die historischen V3-Raumbelegungen, Gegenstände, Shopprodukte, Ausweise, Visa-Vorschauen, Demo-Abstimmungen und Walletbuchungen sind weiterhin **fiktiv**. Sie werden nicht mit echten Schul- oder Bankdaten verwechselt.
- Für echte Personalausweise, Visa-Anträge und Schülerfotos sind Freigaben der Schule, DSGVO-Prüfung, Berechtigungskonzept und gesonderte serverseitige Speicherung nötig. Dies wird nicht ohne diese Voraussetzungen aktiviert.
- Statisches GitHub-Pages-Deployment benutzt `sh scripts/build-static.sh` und kopiert `portal/`. Der kostenlose Cloudflare Worker wurde außerdem manuell aktualisiert; er erhält Änderungen nicht automatisch.
- Keine kostenpflichtigen Upgrades, externen Dienste oder Zahlungen. Gesamtkostenbudget: 0 EUR.
