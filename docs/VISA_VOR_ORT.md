# ViSA vor Ort (Entwicklungsstand)
- Eigener Stationsschlüssel, nur durch Admin erzeugt; ausschließlich im Arbeitsspeicher der Seite. Station erzeugt keine Supabase-Auth-Konten und besitzt keine Schülerrechte.
- Antragsschlüssel (QR) enthält ausschließlich zufällige UUID. Er ist kein Zahlungsnachweis und kein Gastzugang. Preis serverseitig, QR-Antrag 20 Minuten gültig. Personal muss Bargeldeingang und persönliche Prüfung ausdrücklich bestätigen. Doppelte Bestätigung erzeugt keine neue Einnahme.
- Persönlicher Gastschlüssel (256 Bit) dient ausschließlich dem separaten ViSA-Status, wird gehasht gespeichert, und ist nicht im Personal-QR enthalten. Gültigkeit nach Europe/Berlin, 12.–16. Juli 2027. Keine personenbezogenen Daten erfasst; schulische Anforderungen an Identitätsprüfung und Belegpflicht sind vor Betrieb zu klären.
- Admin: Tagespreis, Betriebsschalter (initial AUS), Stationen sperren, Bargeldeinnahmen und separat erfasste volle Erstattungen. Erstattung muss physisch ausgezahlt worden sein; kein automatischer Geldtransfer.
- Seite: /visa-vorort.html. Personal meldet sich zuerst im regulären Portal an; Gast- und Stationszugang benötigen keine Schul-Session. Operator- und Admin-Berechtigung wird in PostgreSQL geprüft.
- **Nicht fertig:** separates Gast-Wallet, echte Zahlung mit Schulwährung, Gastkonto-Wiederherstellung, vollständige Browser-/Lasttests, rechtliche Freigabe, Produktionsmigration und Deployment. Keine öffentlichen Online-Anträge aktiviert. Die bestehenden Schüler- und ViSA-Module bleiben unverändert.
- Migration als vorhandenes V26-SQL-Muster, da hier kein Supabase CLI verfügbar ist. Erst im isolierten PostgreSQL-Test prüfen; vor tatsächlicher Inbetriebnahme prüfen, dass das alte Online-ViSA-Verfahren abgeschaltet ist und die neue Edge Function korrekt konfiguriert ist. Keine realen Barzahlungen für Tests.

## Rollenbasierte Stationsanmeldung
- Vier bestehende Konten: VISA-STATION-01 bis VISA-STATION-04, jeweiliger bisheriger Stationsschlüssel als Passwort. Neu angelegte Stationen erhalten eine eindeutige VISA-Kennung mit UUID.
- Anmeldung über das normale Schulportal, serverseitig getrennte Rolle `visa_station`, 12-Stunden-Sitzung, bei Neuanmeldung oder Abmeldung widerrufen. Kein Supabase-Bürgerkonto und keine Bürgerberechtigungen. Das Passwort selbst wird nicht in Browser-Speichern gehalten.
- Direkter Aufruf der ViSA-Seite zeigt keine Rollenauswahl; Stationsansicht erst nach serverseitiger Sitzungsprüfung, Personalansicht erst nach Admin-/Operator-Prüfung. Gaststatus unter `?view=guest`, nur mit persönlichem Gastschlüssel.
- Vor-Ort-Betrieb bleibt deaktiviert bis zur Abnahme und Konfiguration.
