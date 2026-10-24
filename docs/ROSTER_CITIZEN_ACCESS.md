# Geschlossener Bürgerzugang aus der offiziellen RNG-Schülerliste

**Entscheidung:** Nur Einträge der von der Schule bereitgestellten XLSX-Datei erhalten neue Konten.
Visa bleibt unabhängig und ist noch nicht freigeschaltet.
Die bestehende Konto- und Wallet-Infrastruktur wird übernommen; Bürger erhalten die technische
Rolle `member` und damit **keine** Admin-/Operator-/Kassenrechte.
`set_my_school_job_title` bleibt für die Berufswahl frei nutzbar, ohne zusätzliche Rechte zu vergeben.

## Sicherer Ablauf nach Erhalt der offiziellen Liste

1. Datei in der geschützten Verwaltungsumgebung ablegen, nicht in GitHub, öffentliche Website oder einen Chat mit Freigabelinks. Benötigte Spalten: `Vorname`, `Nachname`, `Klasse`. Unbekannte Formatierung muss vorab geprüft werden.
2. `python scripts/prepare-school-roster.py /geschuetzt/Schuelerliste.xlsx --out /geschuetzt/ausgabe-2027`.
   Das kostenlose Offline-Werkzeug prüft fehlende Felder und doppelte Vollnamen **innerhalb einer Klasse**,
   erkennt Excel-Formeln und bricht bei Unstimmigkeiten vor Kontoanlage ab.
3. Für jeden Schüler erzeugt es (a) eindeutige Kennung `SAS-XXXXXXXXXX`,
   (b) kryptografisch zufällige, **siebenstellige und innerhalb dieses Imports einmalige**
   numerische **Start-PIN**, (c) ein mehrseitiges druckbares PDF, **eine vertrauliche Seite
   pro Schüler** mit Vorname, Nachname, Klasse, Kennung, Startpasswort.
   Die PIN ist nur zur einmaligen ersten Anmeldung und muss dann durch
   ein persönliches Passwort mit mindestens zwölf Zeichen ersetzt werden.
4. Der Generator legt `citizens-private.json` mit allen Start-PINs an. Alle vertraulichen
   Ausgaben erhalten eingeschränkte Dateirechte; Dateien und Drucke nur an
   berechtigte Schulverantwortliche geben und nach Ausgabe löschen bzw. sicher verwahren.
5. **Vor dem Import** Supabase Auth Dashboard prüfen: siebenstellige numerische
   Einmalpasswörter müssen von der Auth-Passwortrichtlinie erlaubt sein.
   Ein Login mit einer fiktiven E-Mail unter `accounts.schule-als-staat.invalid` wird nur
   intern zur Supabase-Authentifizierung verwendet. Diese Adresse kann **keine**
   Passwort-Reset-E-Mail empfangen. Verlorene Zugangsdaten muss die Schulverwaltung
   über die Admin API zurücksetzen und gesichert neu ausgeben.
6. Im privaten Terminal `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY`
   **als Umgebungsvariablen setzen**. Niemals im Browser oder in GitHub hinterlegen.
   Erst `node scripts/provision-school-roster.mjs /geschuetzt/ausgabe-2027/citizens-private.json`
   ohne `--apply` zur Prüfung ausführen, danach mit `--apply`.
   Der Administrator-Import setzt vertrauenswürdige `app_metadata` für eine erlaubte
   Kontoanlage; selbst geschriebene `user_metadata` oder freie Registrierungen
   können die Sperre nicht umgehen. Der Import führt ein privates
   Fortsetzungsjournal und überschreibt **keine** bestehenden Konten.
7. Die Anmeldung mit Bürgerkennung wird lokal in eine synthetische interne
   Auth-E-Mail übersetzt; das reale Passwort wird **nie** in eigener Tabelle gespeichert.
   Beim ersten Login führt die Anwendung auf eine Passwortwechsel-Seite;
   ein Auth-Trigger entfernt die Initial-PIN-Markierung erst nach einer
   **tatsächlichen Änderung des Auth-Passwort-Hashes**.
8. Nach vollständigem Import: Auth-Konten und `school_roster_members`-Zuordnung
   auf Vollständigkeit prüfen; früher angelegte Testkonten getrennt und sorgfältig
   abgleichen. Keine automatische Löschung. Den bisher vorhandenen
   `roster_enforced`-Schalter erst nach Abnahme und korrekter Setzung
   von `school_verified_at` für importierte Bürger aktivieren.

## Sicherheits- und Rollback-Hinweise

- Freie **Neuanmeldung** wird serverseitig durch den `auth.users`-Insert-Trigger
  `sas_roster_registration_guard` verweigert. Bestehende Konten/Logins funktionieren
  weiter. Neue Konten benötigen den sicheren Admin-Import mit
  `app_metadata.sas_roster_provisioned=true`; auch manuelle Admin-Anlagen ohne diese
  Markierung werden abgelehnt. Bei Ausfällen zunächst Konfiguration und Trigger prüfen.
- Die technische Supabase-Auth-Option `Allow new users to sign up` darf für
  den Admin-Import nicht blind abgeschaltet werden: Vorher muss bestätigt werden,
  dass der Admin-API-Provisionierungsweg noch funktioniert. Der Auth-Trigger
  schützt neue Accounts unabhängig vom frei sichtbaren Formular.
- Sieben Ziffern bieten nur rund 23 Bit Entropie. Sie dürfen **nicht** als dauerhaftes
  Passwort gelten. Auth-Rate-Limits, Monitoring und Vertraulichkeit bei der Ausgabe
  sind zwingend. Für dauerhaftes Passwort mindestens zwölf Zeichen.
- Namen und Klassen sind personenbezogene Schülerdaten. Kein Import ohne
  schulische Freigabe/Datenschutzprüfung. Keine personenbezogenen Daten im Repo,
  in öffentlichen Logs oder durch Suchfunktionen anderer Bürger verfügbar machen.
- Vorhandene Profile, Stimmen, Guthaben, Rollen, Buchungen und Testkonten bleiben
  unverändert, bis die Liste tatsächlich vorliegt und eine separate Bereinigung
  geprüft ist.
