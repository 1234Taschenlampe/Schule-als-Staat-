# Sicherheitsprüfung des Schulportals am 26. November 2026

Geprüfter Ausgangsstand ist `393ad3a` auf `main`. Der Branch enthält Korrekturen für einen Neuaufbau und gesonderte Vorwärtsmigrationen für bestehende Installationen. Die Nachweise stammen aus einer isolierten lokalen Umgebung. Eine Produktionsfreigabe oder vollständige ASVS-Level-2-Abnahme steht aus.

## Architektur und Vertrauensgrenzen

Der Worker liefert das Portal und den Schulplan aus. Sein Gateway akzeptiert zwei Lese-RPCs und prüft die Administratorrolle für Metriken über Supabase Auth und das Profil. Im aktuellen Frontend ist die Gateway-Auswahlliste leer. Browser sprechen PostgREST und Auth direkt an. Die Datenbank muss daher jede Berechtigung auch ohne Worker durchsetzen. Zur Anwendung gehören außerdem fünf ViSA Edge Functions, der Python-Maildienst, eine Android-WebView, statische Browserbibliotheken und privilegierte GitHub-Workflows. GitHub Pages leitet auf Cloudflare weiter.

## Befunde und Korrekturen

| Priorität | Befund im Repository | Änderung und Nachweis |
|---|---|---|
| Hoch | Eine spätere Migration ersetzt die Abstimmungsfunktion und entfernt die serverseitige Startpasswortprüfung. Weitere Modulschreibvorgänge hatten keinen gemeinsamen Erstlogin-Schutz. | Eine Vorwärtsmigration stellt die Prüfung wieder her. Statement-Trigger prüfen den aktuellen Marker in Auth bei Änderungen an Anwendungstabellen. Die Einwilligung für den Erstlogin bleibt möglich. PostgreSQL prüft Stimmenabgabe, Einwilligung sowie Kassenfreigabe vor und nach Passwortwechsel. |
| Hoch | Die Druckausweis-Migration bricht beim erneuten Aufbau zwischen Funktionsdefinitionen mit einem SQL-Syntaxfehler ab. Der beabsichtigte Berechtigungsstand ist so nicht reproduzierbar. | SQL-Abschlüsse korrigiert und Migration im PostgreSQL-Test eingespielt. |
| Hoch für die Lieferkette | Der Android-PR-Build erhielt Schreibrechte für Repository-Inhalte. Die Actions wurden über verschiebbare Tags geladen. Produktive Smoke-Tests konnten durch Repository-Änderungen anlaufen. | Android-Build mit Leserechten. Nur der separate Release-Job auf main erhält Schreibrechte. Alle direkten Actions auf Commit-SHAs festgelegt. Live-Tests auf manuellen Start begrenzt. |
| Mittel | Historisches Bootstrap-SQL und Anleitung veröffentlichten persönliche Kontaktangaben. Die Admin-Zulassung hing von einer Adresse ab. | Bindung an eine hinterlegte Auth-UUID im privaten Schema. Bestehender Administrator wird übernommen. Im aktuellen Dateistand wurden die betreffenden Adressen entfernt. Frühere Git-Revisionen enthalten sie weiterhin. |
| Mittel | Browserrollen hatten bei permissiven Supabase-Defaults Ausführungsrechte auf zwei interne Triggerfunktionen. | Rechte entzogen, Tabellenvorgaben eingeschränkt, Katalogprüfungen für alle öffentlichen Tabellen und alle privilegierten Funktionen im öffentlichen Schema eingerichtet. |
| Mittel | Der Worker las den gesamten Request vor der Größenprüfung, leerte bei Kapazitätsgrenze seinen kompletten Zählerspeicher und gab Backend-Fehlertexte weiter. Für Admin-Metriken fehlte die vorgelagerte Drosselung. | Bytebegrenztes Lesen, geschlossene Aufnahme neuer Zähler bei Kapazitätsgrenze, Zeitlimits, Drosselung für Metriken und abstrahierte Fehlermeldungen. Der PDF-Proxy akzeptiert nur den festgelegten Ursprung ohne Redirect und prüft den Medientyp. |
| Mittel | Mehrere ViSA-Endpunkte lasen ganze Bodies vor der Größenprüfung. Fehlerpfade konnten ungefilterte Provider-, Datenbank- oder Parsermeldungen protokollieren. | Vier Eingänge lesen begrenzte Bytes. Die fünf Edge Functions protokollieren im geänderten Fehlerpfad nur feste Meldungen. Ein Test prüft das Limit über mehrere UTF-8-Blöcke. |
| Mittel | Die vier externen klassischen Browserskripte hatten keine Inhaltsprüfung. Die Kameraentscheidung der Android-App prüfte den HTTPS-Port nicht. | SHA-384-Integrität für alle vier Skripte, Abgleich mit den Dateien der npm-Pakete. Android prüft bei Navigation und Kamerafreigabe denselben Portalursprung einschließlich Port. |

## Lokal geprüfte Abläufe

| Bereich | Nachweis und Reichweite |
|---|---|
| Datenbank und Rollen | PostgreSQL 16 in einem Container ohne Netzwerk. Reale Projektmigrationen mit minimalen Auth- und Vault-Testobjekten. Anonym, Mitglied, Kasse, Admin und alle zwölf vordefinierten Schulberufe. Prüfung von Wallet-Isolation, Rollenverwaltung, Anwesenheitsberechtigung, direkten Rollen-/Registergrants, privilegierten anonymen Funktionen, Suchpfaden und RLS-Aktivierung. |
| Konten, Ausweise, Wahlen | Gemockte Bürger- und Adminanmeldung und gesperrte Selbstregistrierung. Lokaler Roster-Import mit synthetischen PINs. Startpasswortwechsel, Rollengrenzen, Abstimmung und Spaltenrechte für Flaggen-Einreichungen. Quellprüfungen für QR, Kartenbestellung und Vorschau. |
| Geschäftsmodule | Zwei getrennte Datenbankverbindungen bestätigen dieselbe Zahlung. Der Test verlangt eine Journalbuchung und exakt passende Endsalden. Weitere SQL-Tests prüfen fremde und eigene Zusagen und Bewerbungen, unveröffentlichte Blogbeiträge und Löschung im Fundbüro. Chromium prüft Schulplan und Raumbuchung, Shopinventur und CSV-Export. |
| Öffentlicher Zugang, Betrieb | Lokale ViSA-Browserabläufe, Mail- und Quotentests, Gateway-Tests mit simuliertem Upstream, responsive Navigation und Accessibility-Checks. Keine echten Zahlungen, Nachrichten oder Schülerkonten verwendet. |

## Reproduktion

`bash tests/postgres/run.sh` erstellt und entfernt eine eigene Datenbank. Docker lädt beim ersten Lauf das per Digest festgelegte Image. Der Test setzt zur Laufzeit weder eine Produktions-URL noch Zugangsdaten voraus. Der operative 991-Personen-Abgleich ist explizit ausgenommen.

```sh
node scripts/build-worker.mjs
node --check dist/schule-als-staat-worker.js
sh scripts/build-static.sh
node --test $(rg --files tests -g '*.mjs' | rg -v '(mobile-browser|inventory-browser|public-browser|live-signup|live-readonly.mjs|self-signup)')
node tests/self-signup-flow.mjs
python3 tests/roster-offline-smoke.py
python3 scripts/check-confidential-repo.py
(cd tests/dependencies && npm audit --audit-level=high --ignore-scripts)
```

119 Node-Tests bestanden. Zusätzlich bestanden sieben Chromium-Tests bei lokal verfügbarem Playwright 1.56.1, axe-core 4.10.3 und Chromium über `CHROME_PATH`. Aufruf mit `node --test tests/{rng-mobile-browser,shop-inventory-browser,mobile-browser-polish,visa-public-browser}.mjs` in Bash. Beide Builds, der gemockte Anmeldetest, der Offline-Rostertest und der Index-Check bestanden. npm Audit meldete für die fünf versionierten Browserpakete und ihre aufgelösten Abhängigkeiten null bekannte Schwachstellen. Gitleaks fand im Ausgangsverlauf von 741 Commits drei Mustertreffer. Zwei betrafen Dokumentationstext, einer den öffentlichen Supabase-Publishable-Key. Die CI-Ausnahmen gelten ausschließlich für die drei historischen Fingerabdrücke.

## Offene Risiken und Freigabebedingungen

- **Hoch, Reproduzierbarkeit der Identitätsverwaltung.** Das Repository referenziert `sas_private.school_names_encrypted`, `sas_private.decrypt_school_name` und `public.my_secure_school_name`. Ihre vollständige Einrichtung fehlt. Dadurch bleiben produktionsgleiche Prüfungen der Namensentschlüsselung, der Druckausweise und des strikten Registerabgleichs offen. Für die Abnahme wird das bereinigte DDL einschließlich Besitzer, Grants und Schlüsselreferenzen benötigt. Es werden keine Namen, Schlüsselinhalte oder Schülerlisten benötigt.
- **Hoch, gehostete Auth-Konfiguration unbekannt.** Schutz gegen verteiltes Credential Stuffing, Anmelde- und Reset-Limits, Refresh-Token-Rotation, Widerruf, Sitzungsdauer und konkrete Redirect-Allowlist benötigen eine isolierte GoTrue-/PostgREST-Instanz mit den gleichen Einstellungen. Der lokale Test ersetzt `auth.uid()` durch einen synthetischen Sitzungskontext. Nutzer mit gültigem Startpasswort können im Rahmen ihrer bestehenden Leserechte Daten abrufen. Das Schreibverbot erfasst die bei der Migration vorhandenen Anwendungstabellen. Neue Tabellen benötigen denselben Schutz.
- **Datenschutz und Betrieb.** Repository-Historie, Kopien, Backups, Aufbewahrungsfristen und tatsächlicher Vollzug von Löschanträgen sind getrennt zu behandeln. Eine Quellprüfung bestätigt weder Datenminimierung im realen Bestand noch die Löschung aus Backups. Historische Kontaktangaben wurden nicht durch Umschreiben der Git-Historie entfernt.
- **Grenzen der Funktionstests.** Geräte-Kamera und Android-Berechtigungsdialog, komplette RLS-CRUD-Matrix pro Modul, privilegierte Namenszugriffe, parallele Buchungen aller Shop- und Raumfunktionen, reale E-Mail-Zustellung, Stripe sowie ein vollständiger ASVS-L2-Kontrollnachweis bleiben offen. Der Postgres-Test simuliert keine gehosteten Dienste. Die Worker-Zähler gelten pro Isolat. Dynamisch geladenes PDF.js und der Turnstile-Dienst bleiben externe Vertrauensgrenzen.
- **Einführung.** Die erstmalige UUID-Übernahme setzt den geprüften gegenwärtigen Adminbestand voraus. Neue Installationen benötigen eine geprüfte UUID. Historische Migrationen dienen dem Neuaufbau. Für Bestandsinstallationen sind die neuen Vorwärtsmigrationen und die Edge Functions mit ihrem gemeinsamen Modul in einer isolierten Kopie zu prüfen. Ein Merge auf main kann über den bestehenden Workflow den Worker veröffentlichen. Die Freigabe muss Datenbank, Edge Functions und Worker koordinieren.
- **Daybreak.** Der Workspace meldete `access: denied` und `isEligibleWorkspace: false`. Es wurde kein Scan gestartet. Die Änderungen benötigen keine neuen gehosteten Dienste. Produktionsdaten und Infrastruktur wurden im Auftrag nicht verändert.
