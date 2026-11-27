# Datenbankarchitektur, Governance und Security – verbindlicher Entwicklungsstandard

Stand: 27.11.2026. Grundlage: Vorlesung „Datenbankarchitektur zwischen Theorie und Praxis – Integration, Betrieb und Lessons Learned“, insbesondere Folien 5–9, 26, 30, 36, 43, 45–49; Ergänzungen sind projektspezifische Architekturentscheidungen. Ergänzt Issue #59, ersetzt keinen Sicherheitsnachweis.

## Architektur und Datenhoheit
Cloudflare Workers ist der einzige produktive Webhost; GitHub ist versionierter Quellcode, nicht Datenhaltung. Supabase Auth führt Identitäten und Sessions; PostgreSQL führt fachliche Zustände, Rollen, Guthaben und Buchungen. Browserzustand und Caches sind niemals autoritativ. Die genaue Zuordnung neuer Module ist vor Implementierung zu bestätigen.

| Domäne | Führende Quelle | Verbindliche Regel |
|---|---|---|
| Identität | Supabase Auth, verknüpftes Bürgerprofil | unveränderliche interne ID; Kurzkennung ist kein Geheimnis |
| Rollen | serverseitiges Rollen-/Berechtigungsmodell | keine Autorisierung allein im UI; Default Deny |
| Wallet | PostgreSQL, transaktionales Buchungsjournal | Saldo und Journal konsistent, keine Client-Schreibrechte |
| Bargeld und externe Zahlungen | autorisiertes Kassen-/Zahlungsprotokoll | getrennt von interner Währung; täglicher Abgleich |
| Gast/Visa | PostgreSQL, serverseitig kontrollierter Workflow | Zahlung vor Ort bestätigt, Freigabe einmalig, zeitlich begrenzt |
| Abstimmungen | schulseitig freigegebenes Wahlsystem | keine zweite konkurrierende produktive Wahrheit |
| Raum/Shop | PostgreSQL, fachlich freigegebene Stammdaten | eindeutige IDs und überprüfte Konfliktregeln |

Verantwortliche Rollen (Zuordnung zu konkreten Personen durch Projektleitung offen): Schul-/Projektleitung als fachliche Freigabeinstanz, Datenverantwortliche je Domäne, technischer Betreiber für Migration/Recovery, unabhängiger Reviewer für Security. Keine Selbstfreigabe risikoreicher Änderungen.

## Security by design
- Jede API/RPC prüft Identität, Rolle, Objektzugehörigkeit, Zustand, Eingaben und Ressourcenlimits. CORS, versteckte UI und QR-Kennung sind keine Autorisierung.
- Least privilege; RLS und Grants gemeinsam betrachten, SECURITY DEFINER einzeln begründen, sicherer search_path, keine unkontrollierten dynamischen SQL-Abfragen. Keine privilegierten Schlüssel im Browser oder Git.
- Zahlungen, Lager und Visa-Freigaben atomar, idempotent und unter Parallelzugriff getestet; ein statischer Ausweis-QR ist kein Zahlungs- oder Identitätsnachweis für sich.
- Admin-MFA, getrennte Betreiberrollen, kontrollierter Passwortreset; keine Passwörter oder personenbezogenen Daten in Logs/CI.
- Eingaben serverseitig validieren, parametrisieren, kontextbezogen ausgeben; Abhängigkeiten und Secret-Historie prüfen.
- Datenminimierung, schulische Datenschutzfreigabe, Löschfristen und Zugriffsprotokoll; keine echten Schülerdaten in Testumgebungen.
- Kostenobergrenze 0 EUR; keine kostenpflichtigen Ressourcen ohne separate Entscheidung.

## Schnittstellen und Release
Für jede geänderte Schnittstelle dokumentieren: Version, verantwortliche Rolle, Eingabe/Ausgabe, Semantik und Einheiten, Berechtigung, Fehler, Idempotenz, Timeout, Abwärtskompatibilität. ADR bei Änderung von Datenhoheit, Auth, Zahlung, Rollen oder Speichertechnologie: Kontext, Alternativen, Entscheidung, Folgen, Risiken, Review-Trigger.
Migrationen versionieren, zunächst isoliert mit synthetischen Daten testen, Abgleich und Rollback/Forward-Fix definieren. Keine Produktionsmigration allein aufgrund grüner statischer Tests. Vor Merge prüfen, dass der automatische Worker-Deploymentpfad nur freigegebene Assets ausliefert.

## Abnahme (offen bis konkreter Nachweis)
| Priorität | Kontrolle | Nachweis |
|---|---|---|
| P1 | Auth/RPC/BOLA und Rollen | anon, Bürger A/B, Operator, Admin: positive/negative E2E inkl. direkter RPC-Aufrufe |
| P1 | Globaler Missbrauchsschutz | verteilte Quota, gemeinsame NAT-Szenarien, 429 und Monitoring, keine Enumeration |
| P1 | Zahlungsintegrität | parallele synthetische Anfragen, Wiederholung, Abstimmung Saldo/Journal, keine Doppelbuchung |
| P1 | Wiederherstellung | isolierter Restore mit Daten-/Rollen-/Funktionsprüfung; RPO/RTO gemessen und durch Projektleitung akzeptiert |
| P1 | Datenschutz | schulische Freigabe, minimale Daten, Löschkonzept |
| P2 | Visa und Gast | Vor-Ort-Bestätigung, Ablauf, einmalige Freigabe, getrennte Rollen, Wiederholung abgewiesen |
| P2 | XSS und Secrets | synthetische negative Tests, vollständiger Historien-Scan, keine Geheimnisse in Ausgabe |
| P2 | Last und Betrieb | realistische Spitzenlast, gemessene Latenz/Fehlerquote, Alarmierung und dokumentierter Notbetrieb |
| P2 | Datenqualität | fehlende IDs, verwaiste Beziehungen, doppelte Kennungen, Saldoabweichungen: keine ungeklärten Verstöße |
| P3 | Dokumentation | aktueller Betriebsstand, API-Verträge, ADRs, Verantwortliche und Testnachweise |

NIST-CSF-Orientierung: Govern (Owner/Regeln), Identify (Inventar), Protect (Rechte), Detect (Monitoring), Respond (Incident-Runbook), Recover (Restore). Bei Vorfall: Zugriff gezielt sperren, Beweise schützen, Betreiber/Schule informieren, Ursache beheben, Wiederanlauf verifizieren. Keine automatische Löschung oder Veröffentlichung sensibler Informationen.

## Technische Hilfsmittel
- `supabase/audit/database-governance.sql`: read-only Kataloginventar für RLS und privilegierte RPCs; in autorisierter Umgebung ausführen, Ergebnisse nicht öffentlich ablegen. Treffer sind Prüfbedarf, kein Exploitnachweis.
- `tests/deployment-boundary.mjs`: prüft den erzeugten statischen Build auf erlaubte Dateitypen/Pfade und Symlinks; kein Ersatz für Secret-Scanning oder Live-Abnahme.
- Bestehende Prüfungen gemäß AGENTS.md und Issue #59 bleiben verbindlich.

Status: Dokumentation und zusätzliche Prüfhilfen sind keine Aussage, dass Produktionsrisiken geschlossen sind. Live-Abnahmen, Owner-Zuweisung und Wiederherstellung sind separat zu protokollieren. Kein Abschluss von Issue #59 ohne Nachweise.
