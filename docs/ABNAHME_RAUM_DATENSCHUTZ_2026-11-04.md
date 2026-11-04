# Schule als Staat – technische Abnahme und Restnachweise (04.11.2026)

**Ziel:** Überprüfbare Abschlusskriterien statt einer unbelegten Aussage „alles fertig“.
Dieses öffentliche Dokument enthält keine Schülernamen, Anmeldeinformationen oder privaten Dateien.

## A. Kontosicherheit und Rechte – technisch geprüft

| Prüfung | Ergebnis am 04.11.2026 | Einschränkung |
| --- | --- | --- |
| 991 aktive Bürger in geschlossener Liste; 992 Auth-Konten inklusive Administration | geprüft | keine echte Geräteanmeldung im Test |
| Anonyme Rolle: keine Listen-/Ausweis-Leserechte, keine Abstimmungs-RPC | bestanden | SQL-Rollenprüfung |
| Zwei normale Bürgerrollen: genau eigenes Profil, eigenen Ausweis, eigenes Wallet sichtbar | bestanden | simulierte JWT-Identität in schreibgeschützter Transaktion |
| Bürger darf Admin-Export und Admin-Ergebnisse nicht lesen | bestanden | nur geprüfte Endpunkte |
| Unverändertes Startpasswort darf nicht abstimmen | bestanden | Server-RPC geprüft |
| Operator darf nicht den Admin-Nutzerexport aufrufen | bestanden | kein kompletter Operator-Penetrationstest |
| Bestehendes Administratorkonto wird als Admin erkannt | bestanden | keine Auth-MFA-Prüfung |
| Produktions-SQL und wiederholbarer Test | `tests/live-readonly-identity-security.sql` | setzt berechtigten privaten SQL-Zugang voraus |

**Prüfverfahren:** Alle fünf Rollen-Szenarien verwenden `BEGIN READ ONLY` und `ROLLBACK`.
Die geschützten Identitäten werden intern aus der Datenbank gewählt, nie ausgegeben.
Der Test erstellt keine Konten, Stimmen, Zahlungen oder Buchungen.

**Noch nicht nachgewiesen:** Reale HTTPS-Logins mit unabhängigen Geräten/Passwörtern,
Tokenwechsel, OTP/Passwortwechsel im Browser, MFA-Wiederherstellung für Admins,
belastbare Prüfung sämtlicher `SECURITY DEFINER`-RPCs und ein externer Penetrationstest.

## B. Raumplan – die letzte fachliche Unklarheit

Die offiziellen PDF-Markierungen sind für **115 beschriftete Räume** erfasst.
**47 reguläre Klassenzimmer** sind für vier Shop-Plätze pro Raum vorbereitet; 46 der 47
haben eindeutig verifizierte Kartenkoordinaten. Die folgenden Abweichungen dürfen
nicht durch Annahmen „korrigiert“ werden:

| Raum | Konflikt | Erforderliche Entscheidung der Schule |
| --- | --- | --- |
| D102/D105 (1. OG) | Verzeichnis: D102; gezeichnete Fläche: D105 | Sind diese Bezeichnungen identisch? Falls ja, darf der D105-Pin für D102 verwendet werden? |
| A305/A306 (3. OG) | Verzeichnis: A305; gezeichnete Fläche: A306 | Welche Nummer ist aktuell gültig, und liegt die gleiche Fläche zugrunde? |

**Verfahrensregel:** Bis die zuständige Verwaltung die Zuordnung bestätigt,
bleiben unbestätigte Raumpositionen ausdrücklich ohne Pin; es darf keine
automatische Freigabe neuer Fachräume für Shopbuchungen erfolgen.
Die normale Admin-Freigabe von Shop-Anfragen ersetzt keine Bau-/Brandschutzgenehmigung.
Nach Bestätigung sind genau die korrigierten Nummern und Koordinaten zu übernehmen
und der sieben-Seiten-Raumplanaudit erneut auszuführen.

## C. Datenschutz und Originaldatei – noch keine institutionelle Freigabe

- [ ] Schulleitung und zuständige Datenschutzbeauftragte haben Verantwortlichkeit,
  Zweckbindung und Rechtsgrundlagen der 991 Bürgerkonten bestätigt.
- [ ] Erforderliche Anbieter-/Auftragsverarbeiterregelungen, Datenschutzhinweise,
  Schüler-/Elterninformation und Löschfristen sind schriftlich geprüft.
- [ ] Die **ursprüngliche** Schülerlisten-Datei ist anhand ihrer Herkunft zweifelsfrei
  identifiziert; die fachliche Übernahme wurde auf Vollständigkeit geprüft.
- [ ] Die Originaldatei und unnötige Zwischenkopien sind aus verwaltbaren
  lokalen, Chat-/Cloud- und Transferablagen gelöscht; Nachweise wurden **privat**
  gesichert, keine Schülernamen/Passwörter in GitHub abgelegt.
- [ ] Noch benötigte Zugangsdatenzettel liegen ausschließlich bei der
  berechtigten Ausgabestelle und werden erst **nach** dokumentierter Ausgabe
  sicher vernichtet; veraltete Zugangsdatenlisten dürfen nicht verteilt werden.
- [ ] Nicht selbst verwaltbare Anbieter-Backups und Aufbewahrungsfristen sind
  gesondert dokumentiert; eine lokale Löschung beweist keine vollständige
  Entfernung aus allen Backups.
- [ ] Von der Schule unterzeichnete Freigabe bzw. eindeutige
  Produktionsentscheidungen liegen **außerhalb** dieses öffentlichen Repositories vor.

Der Datensatz für laufende Schülerkonten ist **nicht** identisch mit der
ursprünglichen importierten XLSX-Datei: Die erforderlichen aktiven Kontodaten
dürfen nicht blind gelöscht werden, solange die Projektfunktion darauf beruht.
Namenswerte werden in `sas_private.school_names_encrypted` verschlüsselt
gespeichert; `school_roster_members` hält technische Kennungen. Auch
verschlüsselte Daten bleiben personenbezogen, solange ein Bezug herstellbar ist.

**Status:** Technische Teilprüfung erfolgreich, physische Raumnummernklärung und
schulisch-organisatorische Datenschutzfreigabe weiterhin offen. Keine pauschale
DSGVO-Konformitäts- oder Produktsicherheitsgarantie.
