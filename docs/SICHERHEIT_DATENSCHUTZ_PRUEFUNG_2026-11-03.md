# Öffentliche Weboberfläche und Datenbank – Datenschutz-Kurzprüfung

**Stand:** 03.11.2026. Diese Prüfung ist kein Penetrationstest und keine rechtliche Freigabe. Die Prüfergebnisse gelten für den zum Prüfzeitpunkt live ausgelesenen Cloudflare-Worker und die verbundene Supabase-Datenbank.

## Bestätigte Befunde
- Die Website enthält die Supabase-Projekt-URL und einen `sb_publishable_...`-Schlüssel. Diese Informationen sind bei der verwendeten Browserarchitektur absichtlich öffentlich. Sie sind weder Passwort noch `service_role`-Schlüssel. Die Zugriffsrechte müssen deshalb über RLS, GRANTs und individuell geprüfte RPCs durchgesetzt werden.
- In den 23 veröffentlichten Worker-Assets und im getrennt untersuchten Worker-Programm wurden keine `sb_secret_...`-, Stripe-Geheimschlüssel- oder PEM-Privatschlüsselmuster festgestellt. Dies ist eine Musterprüfung, keine Garantie gegen alle Arten von Geheimnislecks.
- Von **48 öffentlich schematisierten Datenbanktabellen** haben **48 RLS aktiviert** und **0 RLS deaktiviert**.
- **0** der 48 Tabellen gewähren der Datenbankrolle `anon` direkten `SELECT`-Zugriff. Angemeldete Konten dürfen in **19** Tabellen `SELECT` ausführen; dabei bestimmen zusätzliche RLS-Policies, welche Zeilen zurückkommen.
- **0** Tabellen des Schemas `sas_private` erteilen `authenticated` direkten `SELECT`-Zugriff.
- Die Verknüpfung von Klarnamen zu 991 Schülerkonten liegt verschlüsselt in einer privaten Datentabelle; das macht die Projektdaten nicht anonym.
- Die Datenschutz-/Nutzungslinks sind im dunklen HTML-Footer am Ende der Seite eingebunden; keine schwebenden Links mehr.

## Zusätzliche Prüfungen und Korrekturen (03.11.2026)

- **991 von 991** aktiven Bürgerkonten haben einen geschützten verschlüsselten Namenseintrag; die serverseitige Entschlüsselung lieferte in allen Fällen einen nichtleeren Namen, der sich von der technischen Login-Kennung unterscheidet. Alle 991 Klassenbezeichnungen sind vorhanden. Die Prüfung gab **keinen einzigen Namen** aus.
- Beim tatsächlichen Schülerausweis wird die Namensanzeige aus `my_secure_school_name()` über das persönliche Profil priorisiert. Eine zuvor abweichende Anzeige der pseudonymisierten Kennung in der Design-Galerie wurde korrigiert und im Cloudflare Worker veröffentlicht.
- `student_cards` verwendet die offizielle Klassenzuordnung aus `school_roster_members` über einen Datenbanktrigger; ein Schüler kann sie nicht durch bloße Formulareingaben verändern.
- **Flaggenentwürfe:** Die Tabelle `school_competition_entries` lässt angemeldete Nutzer freigegebene Entwurfsdaten weiterhin lesen. Der direkte Zugriff auf das Feld `submitted_by` wurde jedoch per Spaltenberechtigung gesperrt. Der Flaggenwahl-Client ruft es nicht ab.
- **Weitere Datenbankrechte:** Für 48 öffentliche Tabellen wurden insgesamt 0 anonyme `SELECT`-, `DELETE`-, `TRUNCATE`- und `TRIGGER`-Berechtigungen festgestellt. Keine Tabelle im privaten Schema gestattet `SELECT` an `authenticated`. Reguläre eingeloggte Nutzer können nur an 19 Tabellen überhaupt `SELECT` ausführen; dort bestimmen RLS-Regeln den Zeilenumfang.
- Der Cloudflare Worker wurde nach den Korrekturen erneut ausgelesen: 23 Assets, keine erkannte `sb_secret_`-Signatur, öffentlicher `sb_publishable_`-Schlüssel, aktueller Stand der Namens-/Galerieanzeige und der Datenschutzbestätigungsfunktion.
- Die drei GitHub-Prüfungen **V4 source checks**, **School directory privacy checks** und **Prevent confidential school data in repository** sind nach der Fehlerkorrektur erfolgreich abgeschlossen.
- Die Admin-RPC `admin_list_users()` kann als vorgesehenen Admin-Workflow weiterhin Namen und Konten in größerem Umfang abrufen. Ein gestohlenes Administratorkonto bleibt deshalb ein relevantes Risiko. Vor dem regulären Start sind die Absicherung der Administration (insbesondere mehrstufige Anmeldung, Geräte- und Sitzungsverwaltung), beschränkte Zuständigkeiten sowie Wiederherstellungsprozesse gesondert zu prüfen. Ohne diesen Schritt ist eine Garantie gegen einen Datenabfluss nicht möglich.

## Offene Sicherheitsprüfungen und aktuelle Hinweise
- Der Supabase-Security-Advisor zeigt zwei von anonymen Benutzern aufrufbare `SECURITY DEFINER`-Funktionen: `verify_guest_visa_email` und `visa_public_settings`. Sie scheinen dem vorgesehenen öffentlichen ViSA-Verfahren zu dienen; aus dem bloßen Advisor-Hinweis folgt keine nachgewiesene Schwachstelle. Vor Freigabe sind die zurückgegebenen Daten, Tokenvalidierung und Missbrauchsbegrenzung unter realen Bedingungen zu prüfen.
- Der Advisor zeigt **56** von angemeldeten Nutzern ausführbare `SECURITY DEFINER`-Funktionen. Viele enthalten Berechtigungsprüfungen, aber ein vollständiger, funktionsbezogener Missbrauchstest fehlt. Das bloße Vorhandensein und Ausführungsrecht stellt keinen Nachweis eines Datenlecks dar.
- Der Advisor zeigt 34 Tabellen mit aktiviertem RLS, aber ohne Policies (Stufe INFO). Das ist meist ein bewusstes „standardmäßig verweigern“; keine automatische Schwachstelle.
- Der Advisor meldet, dass der Schutz gegen bekannte kompromittierte Passwörter nicht aktiviert ist. Die technische beziehungsweise tarifliche Verfügbarkeit ist gesondert zu prüfen; keine kostenpflichtigen Optionen aktivieren.
- Es stehen Tests mit einem anonymen Nutzer, einem regulären Schülerkonto und einem Admin-Konto aus, insbesondere für Profil-, Namens-, Karten-, Rollen-, Guthaben- und Abstimmungsendpunkte.
- Die Abfrageadresse eines öffentlichen Supabase-Projekts kann über Entwicklertools, Netzwerkverkehr und Quelltext nachvollzogen werden. Sicherheit darf niemals auf einer versteckten API-Adresse beruhen.
- Die Frontend-Seite lädt weiterhin JavaScript-Bibliotheken über jsDelivr. Selbsthosting der benötigten Skripte wäre ein zusätzliches Datenschutz-/Verfügbarkeits-Verbesserungsprojekt, sofern Lizenz und Funktionstests berücksichtigt werden.
- Die Speicherung der Verknüpfung `voter_id` + `option_id` bei Abstimmungen verhindert derzeit eine vollständige Anonymität.
- Die vom Sekretariat gelieferte Schülerliste hatte nach Mitteilung des Projektteams die Anweisung, sie „unmittelbar nach Verwendung“ zu löschen. Originaldatei, unnötige Kopien und etwaige nicht mehr benötigte verschlüsselte Zwischenkopien müssen separat geprüft werden. Die Löschung der ursprünglichen Liste ist **nicht identisch** mit der späteren Entfernung der für den Schulstaat benötigten Kontodaten. Die Löschung einzelner Originale wurde in dieser Prüfung **nicht bestätigt**.
- Bevor sich alle Schüler anmelden, sind Verantwortlichkeit, Zweckbindung, Datenschutzinformationen, Löschfristen und die organisatorische Freigabe mit der Schule zu klären.

## Referenzen
- Supabase: https://supabase.com/docs/guides/database/secure-data
- API-Schlüssel: https://supabase.com/docs/guides/getting-started/api-keys
- Sicherheitsprüfung zu `SECURITY DEFINER`: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- DSGVO Grundsätze: https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX%3A32016R0679

**Keine Zugangsdaten, Personendaten, Schlüsselwerte oder echten Stimmen in dieser Datei.**


## Ergänzung 04.11.2026 – aktiver Bürgerlisten-Schutz

- Die Produktionskonfiguration hat nun `roster_enforced=true`. Der Wechsel wurde erst nach einem konsistenten 991/991-Abgleich aller offiziellen Mitglieder, Auth-Konten, verschlüsselten Namenswerte und Mitgliedsprofile durchgeführt. Vorhandene Konten und Passwörter blieben unverändert.
- Selbstregistrierung über den Auth-Endpunkt bleibt durch `sas_roster_registration_guard` vor dem INSERT in `auth.users` gesperrt. Die Schulverwaltung kann berechtigte neue Mitglieder nur über den geschützten Admin-Import anlegen.
- `public.submit_vote` prüft serverseitig zusätzlich zur Wahlberechtigung die aktive Bürgerlistenmitgliedschaft oder die Adminrolle; Doppelstimmen und Stimmen nach Wahlschluss bleiben blockiert.
- Die Änderungen werden mit reproduzierbaren SQL-Migrationen und Quelltests im Repository dokumentiert. Personenbezogene Schülerdaten wurden nicht eingecheckt.
- Unverändert offen: vollständige reale Mehrrollen-End-to-End-Tests, schulische/DSGVO-Freigabe, Prüfung der exponierten `SECURITY DEFINER`-Funktionen sowie nachgewiesene sichere Entsorgung der ursprünglichen Schülerliste. Das ist keine Freigabeerklärung und kein vollständiger Penetrationstest.
