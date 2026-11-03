# Datenschutzfreigabe und technische Kontrollen — 3. November 2026

> **Status: technischer Teilschutz umgesetzt, schulische und rechtliche Freigabe noch offen.** Kein Dokument in diesem Repository darf als pauschale „100 % DSGVO-Konformität“ ausgegeben werden.

## Technischer Stand (produktiv geprüft)

- 991 aus der Schülerliste importierte Konten: Schülernamen liegen als verschlüsselte Werte in `sas_private.school_names_encrypted`, kryptografischer Schlüssel geschützt in Supabase Vault. Berechtigte serverseitige Funktionen lesen bei Bedarf entschlüsselte Namen.
- Die bisherigen Schülernamen in `school_roster_members`, `profiles`, `student_cards` und Auth-Metadaten der importierten Konten wurden durch Alias-Kennungen ersetzt bzw. entfernt. Präventive Schreib-Trigger sind eingerichtet.
- Alle 992 zum damaligen Prüfzeitpunkt vorhandenen Auth-Passwörter lagen als bcrypt-Hashes vor; keine Klartext-Passwörter auf der Webseite.
- Die statische Datenschutzerklärung ist unter `/datenschutz.html` ohne Anmeldung und über einen sichtbaren Link erreichbar.
- Die Cloudflare-Worker-Antworten setzen `Referrer-Policy: no-referrer`.
- Keine Schülernamen, Zugangsdaten, Vault-Schlüssel oder Datenbank-Service-Keys im GitHub-Repository speichern.

## Vor Freigabe rechtlich und organisatorisch erforderlich

- [ ] Verantwortliche Stelle und Betreiberrolle der separaten Projektwebseite mit Schulleitung schriftlich klären; Datenschutzbeauftragte einbeziehen.
- [ ] Kontaktdaten, Impressumspflicht nach § 5 DDG und Datenschutzhinweise freigeben und von der Schule bestätigen lassen.
- [ ] Rechtsgrundlagen je Funktion (Pflicht-/Freiwilligkeit; Aufgabenerfüllung oder Einwilligung) und Einwilligung/Einbeziehung von Erziehungsberechtigten dokumentieren.
- [ ] Auftragsverarbeitungsvereinbarungen, Anbieterstandorte, Unterauftragsverarbeiter und mögliche Drittlandtransfers für Cloudflare, Supabase, jsDelivr und optionale weitere Dienste verifizieren.
- [ ] Vollständiges Verzeichnis der Verarbeitungstätigkeiten (Art. 30 DSGVO), technisch-organisatorische Maßnahmen (Art. 32 DSGVO) und erforderliche Datenschutz-Folgenabschätzung (Art. 35 DSGVO) prüfen und dokumentieren.
- [ ] Konkretes Lösch- und Backupschema für Schülerkonten, Abstimmungen, Anwesenheit, Guthaben, Gast-ViSA und Protokolle festlegen, implementieren und testen.
- [ ] Bestehende personenbezogene Altbestände, alte Dumps und Kopien in Build-/Hosting-/Datenbanklogs auf Löschbarkeit und Zugriffsrechte prüfen.
- [ ] Abstimmungen: In der aktuellen Datenbank referenziert `poll_ballots` sowohl `voter_id` als auch `option_id`. Das ist technisch nicht anonym. Vor einer Zusicherung der Wahlgeheimhaltung eine transaktionale Trennung von Teilnahmeberechtigung und anonymer Stimmenablage entwickeln und auditieren.
- [ ] Ungeschützte personenbezogene Daten in Gast-ViSA-Anträgen separat minimieren und gegebenenfalls verschlüsseln, bevor dieser Dienst freigeschaltet wird.
- [ ] Clientseitige Bibliotheken selbst hosten (Supabase SDK, QR), um unnötige Zugriffe auf jsDelivr zu vermeiden; Lizenzen, Versionspflege und Browserkompatibilität beachten.
- [ ] Zugriffsschutz mit zwei unabhängigen Testkonten sowie einem nicht angemeldeten Client prüfen; insbesondere Sessionwechsel, Ausweisprüfungen, Namenssuche und Datenexport.
- [ ] Eltern/Schüler vor Datenübernahme gemäß Art. 13 und bei aus Schullisten übernommenen Daten Art. 14 DSGVO verständlich informieren.
- [ ] Berechtigungsmanagement, Schlüsselrotation, Notfallverfahren, sichere Wiederherstellung und Auditlog-Minimierung festlegen.

## Implementierungsprinzipien

1. Die Website niemals aus dem privaten Repo deployen. Das öffentliche Repo bleibt die Quelle für öffentlich auszuliefernden Code.
2. Das private Repo dient ausschließlich verschlüsselten Importdaten und nicht öffentlichen Import-Skripten; Passwort-/Schlüsselmaterial ausschließlich in zugriffsbeschränkten Secrets, nicht in Git-Dateien oder Workflow-Logs.
3. Verschlüsselte Namen sind weiterhin personenbezogene Daten: die Schlüsselhaltung im selben Supabase-Projekt schützt gegen das beiläufige Lesen regulärer Tabellen, **nicht** vor vollständigem Datenbank-/Vault-Administrationszugriff.
4. Keine personenbezogenen Log- oder Exportdaten in Cloudflare Worker, GitHub Issues, Pull Requests, Chat oder öffentlich zugänglichen Storage-Buckets.
5. Ein nicht bestätigter Datenschutztext ist eine transparente Vorabfassung und **keine** Freigabe zur Verarbeitung zusätzlicher Daten.

**Rechtsgrundlagen- und Musterhinweis:** Hinweise des Kultusministeriums Baden-Württemberg zu Angaben auf Schulwebseiten; DSGVO Art. 5, 6, 12–14, 15–22, 25, 28, 30, 32, 35; § 5 DDG; einschlägiges baden-württembergisches Schul- und Landesdatenschutzrecht.
