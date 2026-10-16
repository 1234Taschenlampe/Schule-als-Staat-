# SaS ONE V6 – Funktionsstand und Abnahmetests

**Stand: 16.10.2026.** Dieses Dokument beschreibt die technisch implementierten Funktionen. Es ersetzt die frühere Aussage, V3-Demoseiten seien die produktive Anwendung. Das ursprüngliche V3-HTML bleibt ausschließlich als Referenz in archive/. Es wird vom Build-Skript nicht veröffentlicht.

## Architektur

- Eine einheitliche, helle, responsive Webseite: index.html, styles.css, features.css, app.js, features.js, config.js
- Echtes Login und Rechte über Supabase Auth und public.profiles.
- Echtes Wallet, Buchungen, QR-Payment, Kasse und Abstimmungen aus den bestehenden V4-Migrationen. Keine Demo-Zahlungen im Live-Frontend.
- Ergänzungen aus der früheren V3, jedoch vollständig mit neuen Oberflächen und echten Supabase-Tabellen:
  - Schülerausweis: persönliche Karte mit Namen, Klasse und gespeicherten Designvarianten. **Solange die Schule die Identität nicht geprüft hat, ausdrücklich KEIN gültiger Identitätsnachweis**.
  - Ausweis-Galerie: Design auswählen, persönliche Karte wird dauerhaft gespeichert, keine fiktiven Personen.
  - ViSA: echte Anträge, nur Antragsteller und Administratoren dürfen sie lesen; Admin entscheidet; Antragsteller dürfen nicht genehmigte Anträge zurückziehen. **Schulische Datenschutzfreigabe vor Einsatz mit echten Minderjährigendaten erforderlich.**
  - Schwarzes Brett und Projektblog: Veröffentlichungen lesen; Admin kann Beiträge erstellen und löschen.
  - Geschäfte: Administrationsverwaltung, Kassenbetreiber-Zuordnung und Zugriff auf die bestehende V4-QR-Kasse. Beträge sind weiterhin durch Nutzer zu prüfen.
  - Schulplan: Orte, Räume und Geschäfte aus echter Datenbank; eine belastbare visuelle Lagekarte erfordert vom Schulteam echte Positionen/Grundriss. Ohne diese zeigt die Seite korrekt „noch keine Orte“ statt erfundener Gebäude.
  - Raumreservierungen: Antrag, Adminentscheid, Zurückziehen; DB-GiST-Constraint verhindert zwei überlappende **genehmigte** Buchungen desselben Raums.
  - Veranstaltungskalender: Admin erstellt Termine, Nutzer melden sich an oder ab, eine Person kann sich nur einmal anmelden.
  - Fundbüro: Fund/Verlust erfassen, alle Angemeldeten können lesen; eigene offene Meldungen löschen, Admin kann erledigt markieren.
  - Berufe: offene Stellen administrieren, Bewerbungen einmalig pro Stelle und Konto, Admin kann Bewerbungen lesen.
  - Gesetze, Parteien, Gerichte: offizielle Bekanntmachungen mit Adminverwaltung. Dies ist noch kein vollständiges Partei-/Justizverfahren mit privaten Akten und gerichtlicher Entscheidung.
- Berechtigungen/RLS in Supabase: v4_wallet_and_cash, v4_polls, v5_portal_posts, v6_integrated_portal, v6_data_safety. Keine Service-Role-Schlüssel im Client.
- Das kostenlose Cloudflare Worker Deployment wird direkt über API aktualisiert, GitHub Pages über Actions. Die alte V3 wird nicht mehr als alte UI veröffentlicht.

## Geprüft

1. GitHub Actions: JavaScript-Syntax, Quellcodeinvarianten, statischer Build, Cloudflare-Worker-Bundle.
2. Node.js: 14 neue Ansichten für Mitglieds- und Administrationsrollen rendern ohne Demodaten; das alte V3-HTML wird nicht mit veröffentlicht.
3. Supabase: neun neue Tabellen besitzen RLS-Regeln; das bereits bestätigte GMX-Administratorkonto wird erkannt.
4. SQL-Smoke-Tests mit authentifizierter Adminrolle haben erfolgreiche temporäre Einträge in Card, ViSA, Posts, Orten, Räumen, Veranstaltungen, Teilnehmern, Fundbüro, Stellen und Bewerbungen gezeigt. Alle Schreibtests wurden mit ROLLBACK rückgängig gemacht; die Echt-Datenbank blieb leer.
5. Raumreservierung: überlappende genehmigte Zeiten sind durch Exclusion Constraint gesperrt.

## Vor Schulfreigabe verpflichtend

- End-to-End-Tests im Browser mit mindestens zwei **tatsächlich getrennten** Testkonten (Admin, Mitglied, Kassenperson); inklusive Berechtigungsumgehungsversuche, Bezahlung, Doppelzahlung und Stimmabgabe.
- HTTPS-Kamera/QR auf iOS, Android und Desktop testen. Kamera nie ohne Nutzeraktion starten.
- Echtes Schulgebäude/Etagenplan, Räume und Geschäfte durch die Schuladministration korrekt einpflegen.
- Identitätsfreigabe für offizielle Schülerausweise; frei editierbare Ausweiskarte nicht als offiziell ausgeben.
- Datenschutzinformation, Erziehungsberechtigten-/Schulfrei- bzw. Rechtsgrundlage und Löschfristen für ViSA-/Personendaten festlegen. **Keine echten Adressdaten von Schülern vor Freigabe erheben.**
- Supabase Auth Redirect URLs und die E-Mail-Rate-Limits für massenhafte Registrierung lösen (ggf. über schulisches SSO), ohne Kosten zu erzeugen.
- Schulische Wahlberechtigung mit echten Schulunterlagen abgleichen; ein Auth-Konto allein garantiert keine einzige reale Person.
- Bei Free-Kontingenten: Funktion stoppen statt kostenpflichtig hochzustufen.

**Budget:** absolut 0,00 EUR. Es wurden keine Bezahldienste bestellt. Keine Funktion hat einen automatischen Upgrade-Pfad.


## Überarbeitung der Oberfläche am 16.10.2026

- Das verbindliche Designsystem und die Navigation stehen in `docs/DESIGN_SYSTEM.md`.
- Neue neutrale Oberfläche, gemeinsames Token-System für Schulmodule, Finanzen und Administration; separate Admin-Seite und gruppierte Hauptnavigation.
- Neue Startseite mit persönlichem Ausweiszugang, echtem Walletsaldo, noch nicht beantworteten offenen Abstimmungen, sechs Modulzugängen und Buchungsverlauf.
- Portalverzeichnis und tastaturbedienbarer Suchdialog (Strg/Command + K); nur statische Modulnamen werden durchsucht, keine personenbezogenen Datensätze.
- Mobile Navigation mit Zugriff auf sämtliche Module über „Portal“; Touchziele, Safe Areas und einspaltige Formulare.
- Doppelt gerenderte Modulformulare beseitigt; Hintergrundaktualisierung überschreibt keine begonnenen Eingaben und keine offenen Dialoge. Verspätete Modulabfragen werden verworfen.
- Teilnehmerstatus für Veranstaltungen wird explizit auf das eigene Konto gefiltert; Formularprüfung für Terminende und maximale Raumreservierungsdauer.
- Kein altes V3-Portal, keine neuen Beispieldatensätze oder kostenpflichtigen Ressourcen.

### Verifikation dieses Änderungsstands

- 7 automatisierte Node-Prüfungen erfolgreich: bestehende V4-Invarianten, 14 Modulansichten in Mitglieds-/Adminrolle, Navigation für Mitglied/Kasse/Admin, einmalige Formulare und Schutz vor verspäteten Abfrageantworten.
- Static-Build und Worker-Bundle einschließlich Syntaxprüfung erfolgreich.
- `tests/live-rollback.sql` auf dem verbundenen Supabase-Projekt ausgeführt: drei fiktive Identitäten innerhalb einer vollständig zurückgerollten Transaktion, fremder Ausweis nicht lesbar/beschreibbar, Adminzugriff verweigert, Zahlung mit korrektem Saldo, idempotente Wiederholung, gültige Stimme, gesperrte Doppelstimme und Adminauswertung für Mitglieder verweigert. Keine Testdaten verbleiben.
- Dies sind Backendtests unter authentifizierten DB-Rollen, keine Anmelde-End-to-End-Tests mit drei Browserkonten. Geräteabhängige Kamera-/QR-Tests und mobile Browserabnahme bleiben vor Schulbetrieb offen.


## Live-Registrierungstest (16.10.2026)

**Bestanden:** Einmaliger echter End-to-End-Backendtest gegen die produktive Supabase-Auth- und REST-API, [GitHub-Actions-Lauf 38890660174](https://github.com/1234Taschenlampe/Schule-als-Staat-/actions/runs/38890660174).

- Testkonto unter reservierter `@example.test`-Adresse mit zufälligem Passwort über `POST /auth/v1/signup` erstellt; Supabase lieferte sofort eine Sitzung ohne E-Mail-Bestätigung zurück.
- Anschließend echte Anmeldung über `POST /auth/v1/token?grant_type=password` erfolgreich.
- API mit eigenem Benutzer-JWT: genau ein sichtbares eigenes Profil, Rolle `member`, `vote_eligible=false`; ein Wallet mit 0 Einheiten; ein Schülerausweis mit gespeichertem Testnamen und Testklasse. Der automatische Trigger aus `v8_self_service_signup_test.sql` ist damit über die echte Auth-API verifiziert.
- Künstliches Testkonto danach gezielt aus `auth.users` gelöscht. Kontrollabfrage: 0 verbleibende Testkonten, unverändert 3 Auth-Konten, 3 Profile, 3 Wallets und 3 Schülerausweise, davon 1 bestehender Administrator.
- Für bestehende Konten wurden fehlende Entwurfsausweise durch `v9_backfill_student_cards.sql` angelegt, ohne Guthaben, Rollen oder vorhandene Karten zu überschreiben.
- Separater Rollentest mit echter RLS: Ein Mitglied kann genau ein eigenes Profil/Wallet/eigenen Ausweis lesen und keinerlei Adminprofil; ein Admin kann die Ausweisverwaltung lesen.
- Fünf zusätzliche simulierte UI-Registrierungsfälle in `tests/self-signup-flow.mjs`: sofortige Anmeldung, fehlende Signup-Session mit Login-Fallback, bereits verwendete Adresse, SMTP-Rate-Limit und noch unbestätigtes Konto. GitHub-CI erfolgreich.
- Der reale Test bestätigt **Backend-Registrierung und -Login**, nicht die Browserbedienung, das E-Mail-Verfahren, Social Login, geräteabhängige Kamera oder Zahlungs- und Abstimmungsabläufe unter mehreren echten Konten. Diese bleiben vor der Schulfreigabe offen.


## Schulverifizierung per QR-Code (16.10.2026)

**Ausgeführt:** `supabase/v10_school_qr_verification.sql` und `supabase/v10_school_qr_card_lock.sql`.
Der Nutzer registriert sich weiterhin ohne Bestätigungs-E-Mail und erhält sofort sein normales Mitgliedskonto. Die **zusätzliche Schulverifizierung** läuft so:

1. Angemeldeter Schüler öffnet „Schulverifizierung“ und erstellt einen QR-Code, der nur ein kryptografisch zufälliges Einmalgeheimnis enthält. Kein Name, keine Mail und keine Benutzer-ID im QR. Das Geheimnis wird ausschließlich als SHA-256-Hash in der Datenbank gespeichert.
2. Code läuft nach 10 Minuten ab. Neuer Code ersetzt den vorherigen (mindestens 20 Sekunden Abstand). Nach erfolgreicher Prüfung wird der Code gelöscht und ist nicht wiederverwendbar.
3. Administrationskonto öffnet „QR-Prüfung“, scannt per Kamera oder gibt den Inhalt manuell ein. Angezeigte Angaben (Name, Klasse, Mail) dienen ausschließlich zum Abgleich mit den Schulunterlagen; vom Schüler selbst eingetragene Angaben sind für sich genommen kein Identitätsnachweis.
4. Nur nach ausdrücklich bestätigtem Abgleich wird `school_verified_at` und der prüfende Admin im bestehenden Profil gespeichert.
5. Name/Klasse eines verifizierten Schülerausweises sind danach serverseitig schreibgeschützt; das visuelle Design bleibt änderbar.
6. Verifizierung **vergibt weder Admin- und Kassenrechte noch automatisch Stimmrecht oder Echtgeld**. Eine offizielle Schülerausweis-Freigabe ist gesondert erforderlich.

**Sicherheitstest:** Rollenwechsel in einer SQL-Transaktion zeigte, dass normale Mitglieder keine QR-Codes anderer Personen prüfen dürfen; ein Admin kann einen gültigen Code anzeigen und bestätigen; nach Bestätigung ist die Ausweisidentität gegen Änderungen gesperrt. Vollständige Transaktion zurückgerollt, keine bestehenden Konten als verifiziert markiert.

**Abnahme ausstehend:** Kameratest auf Android/iOS, tatsächliche Lehrkraft-/Adminprüfung vor Ort und Schulfreigabe des verwendeten Identitätsnachweises. Nur das vorhandene Admin-Konto kann derzeit prüfen; eine gesonderte Schulpersonal-Rolle wurde nicht vergeben.
