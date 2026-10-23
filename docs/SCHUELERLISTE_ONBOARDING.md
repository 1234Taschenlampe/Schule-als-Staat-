# Schüler-Onboarding anhand der offiziellen Excel-Liste (geplante Umstellung)

## Produktentscheidung

Schüler müssen keine gesonderte E-Mail-Bestätigung und keine persönliche Schulverifizierung mit einem zusätzlichen QR-Code durchführen. Die Schule stellt eine vollständige Excel-Liste zur Verfügung. Die **E-Mail-Bestätigung mit Token bleibt ausschließlich im öffentlichen Gast-ViSA** erhalten.

**Wichtig:** Die Liste liegt noch nicht vor. Die serverseitige Zuordnung ist deswegen **noch nicht implementiert**. Der Branch entfernt zunächst nur die alte Schulverifizierungs-UI und die zugehörige QR-Erstellung aus dem Schülerausweis, **nicht** die bestehenden Sicherheitsgates im Backend.

## Zukünftiger Schülerablauf

1. Schule liefert die Liste als .xlsx über einen autorisierten, geschützten Kanal.
2. Schule/Verantwortliche prüfen Zulässigkeit und Zweckbindung der Verarbeitung; Import nur durch Administration, niemals aus dem Browser öffentlicher Nutzer oder in GitHub.
3. Private Supabase-Roster-Tabelle übernimmt minimal nötige Felder: **stabile Schülerkennung** (falls vorhanden), Name, Vorname, Klasse und Status. Keine Geburtsdaten/Telefonnummern/Adressen nötig, sofern kein konkreter rechtmäßiger Zweck dafür besteht.
4. Pro Zeile wird ein einmaliger, kryptografisch zufälliger Aktivierungscode generiert (nur gehasht speichern, begrenzte Gültigkeit/Versuche). Die Schule gibt den Code **der richtigen Person direkt**. Wenn die Excel-Liste keine stabile ID liefert, erhält jede Tabellenzeile eine eigene interne Kennung und einen separaten Code.
5. Schüler erstellen weiter ein Konto mit E-Mail + eigenem Passwort, **ohne Bestätigungs-E-Mail**, melden sich an und lösen den persönlichen Aktivierungscode einmalig ein. Der Server verknüpft die Supabase-Auth-User-ID mit genau einer Roster-ID, atomar und unter Einmaligkeitsconstraints.
6. Erst diese serverseitig gebundene Zuordnung markiert die Schülermitgliedschaft als berechtigt. Ein Name/Klassenwert, den jemand im Formular selbst eintippt, ist **kein Identitätsnachweis**.
7. `profiles.school_verified_at` und ausweis-/anwesenheitsbezogene Kontrollen werden bei der Migration bewusst auf die verlässliche Roster-Zuordnung umgestellt. Bestehende historische QR-Verifizierungen werden vorab überprüft und kontrolliert migriert, nicht blind als Roster-Nachweis übernommen.

## Übergangsregeln (wichtig)

- **Keine automatische Freigabe** von Wahlrecht, Schuljobs, Anwesenheit oder privilegierten Funktionen an beliebige neue Accounts, nur weil der QR-Schulverifizierungsknopf entfernt wurde.
- `vote_eligible` und Rollen bleiben bis zur eindeutigen Zuordnung serverseitig geschützt.
- Der permanente Ausweis-QR (`SAS-ID:`), der QR für Anwesenheit und der QR für digitale Schulguthaben bleiben bestehen. **Nur der zusätzliche `SAS-VERIFY:`-Schulverifizierungs-QR entfällt.**
- Nach vollständigem Roster-Rollout: veraltete RPCs `create_school_verification_qr`, `review_school_verification_qr`, `confirm_school_verification_qr`, `my_school_verification_status` serverseitig entziehen/entfernen; vorhandene QR-Challenges sicher bereinigen. Vor dem Import **keine** produktiven Datensätze oder Berechtigungslogik löschen.
- Die bestehende Registrierung ist derzeit offen und besitzt noch **keine** Roster-Vorabprüfung; vor einer öffentlichen Freischaltung muss die Registrierung bzw. Berechtigungsausgabe serverseitig durch die Roster-Identität abgesichert sein.
- E-Mail-basierte **Passwortzurücksetzung** ist keine Konto-E-Mail-Verifizierung und bleibt als Sicherheitsfunktion möglich.

## Gast-ViSA bleibt eigenständig

- Öffentlicher Antrag ohne Schülerkonto.
- Turnstile, Rate Limits und Einmal-Token für die **E-Mail-Bestätigung** bleiben erhalten.
- E-Mail-Versand per Gmail/Supabase bleibt bis zum Test gesperrt.
- Echte EUR-Zahlung weiterhin nur nach getrenntem Stripe-Checkout/Webhook-Test und Freigabe; niemals automatisch durch E-Mail-Bestätigung.
- Keine Schülerliste für den Gast-ViSA-Prozess verwenden.

## Datenimport: Vorabkontrollen

Vor jedem Import ist die Excel-Datei ausschließlich in einer kontrollierten Umgebung auf die **tatsächlichen Spalten** zu prüfen: doppelte Namen, fehlende Schlüssel, Klassenwechsel, ausgeschiedene Schüler, fehlerhafte Datensätze, Excel-Formeln und unerwartete personenbezogene Zusatzspalten. Import muss transaktional, idempotent, roll-back-fähig und protokolliert sein. Keinen Listeninhalt in Logs, öffentlichen Fehlern oder Projekt-Repository committen.

## Status dieser PR

- Frontend: QR-Schulverifizierungsmodul aus Navigation, HTML und Schülerausweis entfernt; QR für Ausweis/Guthaben/Anwesenheit erhalten.
- Backend: unverändert; alte Funktionen/Tabellen noch vorhanden.
- Roster-Matching: **ausstehend, bis die offizielle .xlsx vorliegt**.
- Produktions-Deployment: **nicht** Bestandteil dieses Branchs.
