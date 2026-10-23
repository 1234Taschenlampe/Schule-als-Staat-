# Schüler-Onboarding anhand der offiziellen Excel-Liste (geplante Umstellung)

## Produktentscheidung

Schüler müssen keine gesonderte E-Mail-Bestätigung und keine persönliche Schulverifizierung mit einem zusätzlichen QR-Code durchführen. Die Schule stellt eine vollständige Excel-Liste zur Verfügung. Die **E-Mail-Bestätigung mit Token bleibt ausschließlich im öffentlichen Gast-ViSA** erhalten.

**Wichtig:** Die Schülerliste liegt noch nicht vor; eine verlässliche Kontozuordnung ist noch nicht implementiert. **Während der ausdrücklich freigegebenen Testphase** erhalten alle registrierten normalen Konten sofort das Stimmrecht und dürfen die üblichen Schülerfunktionen ohne zusätzliche Schulverifizierung nutzen. Alle Konten der Testphase werden separat für die spätere kontrollierte Bereinigung erfasst. Administrator-, Kassen-, Operator- und Prüfrechte sind hiervon nicht betroffen.

## Zukünftiger Schülerablauf

1. Schule liefert die Liste als .xlsx über einen autorisierten, geschützten Kanal.
2. Schule/Verantwortliche prüfen Zulässigkeit und Zweckbindung der Verarbeitung; Import nur durch Administration, niemals aus dem Browser öffentlicher Nutzer oder in GitHub.
3. Private Supabase-Roster-Tabelle übernimmt minimal nötige Felder: **stabile Schülerkennung** (falls vorhanden), Name, Vorname, Klasse und Status. Keine Geburtsdaten/Telefonnummern/Adressen nötig, sofern kein konkreter rechtmäßiger Zweck dafür besteht.
4. Pro Zeile wird ein einmaliger, kryptografisch zufälliger Aktivierungscode generiert (nur gehasht speichern, begrenzte Gültigkeit/Versuche). Die Schule gibt den Code **der richtigen Person direkt**. Wenn die Excel-Liste keine stabile ID liefert, erhält jede Tabellenzeile eine eigene interne Kennung und einen separaten Code.
5. Schüler erstellen weiter ein Konto mit E-Mail + eigenem Passwort, **ohne Bestätigungs-E-Mail**, melden sich an und lösen den persönlichen Aktivierungscode einmalig ein. Der Server verknüpft die Supabase-Auth-User-ID mit genau einer Roster-ID, atomar und unter Einmaligkeitsconstraints.
6. Erst diese serverseitig gebundene Zuordnung markiert die Schülermitgliedschaft als berechtigt. Ein Name/Klassenwert, den jemand im Formular selbst eintippt, ist **kein Identitätsnachweis**.
7. `profiles.school_verified_at` und ausweis-/anwesenheitsbezogene Kontrollen werden bei der Migration bewusst auf die verlässliche Roster-Zuordnung umgestellt. Bestehende historische QR-Verifizierungen werden vorab überprüft und kontrolliert migriert, nicht blind als Roster-Nachweis übernommen.

## Übergangsregeln (wichtig)

- **Testphase bis zum Schülerlisten-Import:** Neue normale Konten erhalten automatisch `vote_eligible=true`; alle bestehenden sieben normalen Konten wurden entsprechend freigeschaltet. Für Anwesenheits-/Arbeitszeit-QR werden während der Testphase normale registrierte Konten ohne vorherige Schulverifizierung akzeptiert (Zeitfenster und Prüfrollen bleiben bestehen).
- **Nach dem Schülerlisten-Import:** Beim Wechsel auf `roster_enforced=true` bekommen neue Konten nicht mehr automatisch Stimmrecht; für Anwesenheit/Zeiterfassung greift wieder die autorisierte serverseitige Schülerlisten-Zuordnung. Vor dem Umschalten muss diese Zuordnung fertig implementiert und getestet sein. Die Testkonten werden vorher kontrolliert abgeglichen und gelöscht.
- Administrator-, Kassen-, Operator- und Kontrollberechtigungen bleiben ausschließlich rollen-/berechtigungsgebunden; **„alle Funktionen“ meint alle normalen Schülerfunktionen, niemals privilegierte Administratorfunktionen**.
- Der permanente Ausweis-QR (`SAS-ID:`), der QR für Anwesenheit und der QR für digitale Schulguthaben bleiben bestehen. **Nur der zusätzliche `SAS-VERIFY:`-Schulverifizierungs-QR entfällt.**
- Die veralteten QR-RPCs `create_school_verification_qr`, `review_school_verification_qr`, `confirm_school_verification_qr` und `my_school_verification_status` sind für öffentliche und angemeldete Nutzer bereits gesperrt; ihre Tabellen/Funktionen können nach Abschluss der Umstellung kontrolliert entfernt werden. Vor dem Import **keine** personenbezogenen Datensätze oder Berechtigungen löschen.
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
- Backend: Migration `pre_roster_student_trial_access_v27` ist in Supabase produktiv angewendet. `school_access_settings.roster_enforced=false`; fünf serverseitige Funktionen beachten diese Phase. Die sieben bestehenden Mitgliedskonten haben Stimmrecht. Der Trigger `on_new_user` vergibt es neuen Mitgliedern automatisch.
- Testnutzer-Verzeichnis: `public.school_test_accounts` (privat, RLS aktiviert) enthält bereits sieben bestehende normale Konten; neue werden während dieser Phase automatisch erfasst. Es ist eine Prüf- und Bereinigungsliste, **kein automatischer Löschauftrag**. Administratorkonten nicht automatisch eintragen oder löschen.
- Nach Erhalt der Excel-Liste: Zuerst die nach Klassen/ID gemappten realen Schulkonten unterscheiden; anschließend **nur nach Prüfung** die Testnutzer einschließlich ihrer Auth-Konten, Profile, Geldbewegungen, Stimmen, QR-Tokens, Test-Abstimmungen und Test-Vorgänge entfernen oder sicher archivieren. Keine Live-Daten pauschal anhand eines „test“-Teilstrings löschen.
- Roster-Matching: **ausstehend, bis die offizielle .xlsx vorliegt**.
- Frontend-Deployment: erst nach Abnahme und Review dieses Branchs, Backend-Regeln sind bereits aktiv. Abstimmungen in der Testphase sind **nicht** als identitätsgesicherte Schulwahlen zu werten. Mehrfachkonten können die Stimmverteilung manipulieren.
