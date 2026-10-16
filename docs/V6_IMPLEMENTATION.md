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
