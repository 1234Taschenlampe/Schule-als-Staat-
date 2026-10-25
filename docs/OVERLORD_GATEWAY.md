# SaS Overlord v1 — Cloudflare Gateway, Sicherheit und Last

## Architektur

- Website weiterhin im vorhandenen, kostenlosen Cloudflare Worker.
- `/api/v1/rpc/poll_catalog` und `/api/v1/rpc/shop_room_catalog`:
  **ausschließlich POST**, **leeres JSON `{}`**, explizite Allowlist.
  Alle anderen RPCs – insbesondere Zahlungen und Admin-Schreiboperationen –
  werden nicht über diesen Gateway-Pfad angeboten. Andere App-Anfragen
  laufen wie bisher über Supabase.
- Bürger-JWT wird unverändert an Supabase weitergereicht;
  die Datenbank erzwingt weiterhin dieselbe Authentifizierung, RLS und
  RPC-Berechtigungen. Im Worker befinden sich nur öffentliche
  `sb_publishable`-Konfigurationen, **keine** Service-Role-Zugangsdaten.
- `GET /api/v1/health` gibt ausschließlich technischen Gesundheitsstatus
  (keine echten globalen Daten).
- `GET /api/v1/overlord/metrics` erfordert authentifiziertes Konto.
  Der Worker prüft die Sitzung über `/auth/v1/user` und die Rolle
  mittels RLS-geschützter `/rest/v1/profiles`-Abfrage. **Nur Admins**;
  nicht von Client-Metadaten oder unvalidierten JWT-Payloads ableiten.
- Lesende RPCs werden **nie öffentlich gecacht**. Kein unberechtigtes
  Übernehmen von Bürgerdaten aus gemeinsam genutzten Browsern.
- Antworten haben `cache-control: no-store`, keine permissive CORS-Regeln.
  Query-Parameter und Fremd-Origin-Anfragen werden abgewiesen.
- Best-effort-Buckets pro JWT-Fingerprint und Cloudflare-Besucher-IP;
  eine zusätzliche Obergrenze für gleichzeitige Proxy-Aufrufe pro Worker-Isolat.
  **Wichtige Grenze:** Diese Zähler und Limits sind nicht global koordiniert.
  Cloudflare-Instanzen/Regionen teilen sie nicht. Ein wirklich globaler,
  harter Rate Limiter braucht eine dafür geeignete koordinierte Binding- oder
  Durable-Object-Konfiguration. `workers.dev` steht zudem nicht hinter
  einer verwalteten Zone mit eigener WAF-Regel.
- Unbekannte Pfade und HTTP-Methoden scheitern geschlossen, keine
  generische offene Proxy-Adresse, keine Weiterleitung auf fremde Hosts.

## Senkung der Supabase-Anfragen

Bisher: auf den Seiten Start, Guthaben, Historie und Abstimmungen im Hintergrund
alle **5,5 Sekunden** eine vollständige Aktualisierung. Dabei mindestens sieben
Supabase-Operationen in `fetchData` pro Durchlauf.

Neu: alle **60 Sekunden**, nur wenn das Fenster sichtbar ist und die Seite
nicht im Eingabemodus, Dialog, Scan oder Verarbeitung steckt.
Gleichzeitig laufende Refresh-Aufrufe werden dedupliziert.
Navigations- und manuelle Aktualisierungen sowie Mutationen erhalten
ihre bereits vorhandenen gezielten Refreshes.

Grobe Hintergrundlast bei einem dauerhaft aktiven Benutzer:
vorher ~76 Requests/Minute, jetzt ~7 Requests/Minute, also rund
**90,8 % weniger** in diesem speziellen Polling-Pfad.
Das ist keine Zusage zur Gesamtlast des Projekts.

## Tests und Produktion

- Isolierte Tests verwenden ausnahmslos erfundene JWTs,
  gemockte Supabase-Antworten und synthetische Requests.
- Browser und Gateway werden mit dem generierten Worker-Bundle getestet:
  401/403/404/405/413, Rolle aus Supabase, kein Public-Cache,
  429, 100 gleichzeitige Leseanfragen.
- Live-Smoke nur lesend: Worker-Version, vorhandener PDF-Proxy,
  Health 200, gesperrte Schreib-RPCs.
- Keine echten Zahlungen, Benutzer, Stimmzettel oder Shop-Reservierungen im Test.
- Worker-Code wird nicht automatisch per GitHub-Commit veröffentlicht:
  Nach bestandenem CI muss der laufende Cloudflare-Script-Inhalt
  gezielt aktualisiert werden; bestehende Assets/PDF-Proxy bleiben erhalten.

## Vor Freigabe von Zahlungen / großer Nutzerlast

Eine harte globale Sperre direkter Supabase-REST-Endpunkte ist auf dieser
Architektur **nicht möglich**, solange Browser die Publishable-Konfiguration
und Supabase-URL direkt nutzen. Daher bleiben die bestehenden RLS-/SQL-
Rechte **die sicherheitsentscheidende Schutzschicht**.
Bei späterem Bedarf: koordiniertes Rate-Limiting per Binding,
Backend-only Routings für sensible Operationen, echtes globales Monitoring,
Staging-Mehrbenutzer-Test und Review der Kontowiederherstellung.

## Rollback

Worker in Cloudflare auf vorheriges Script zurückstellen.
App.js unverändert aus dem vorherigen GitHub-Commit wieder einbinden.
Keine Datenbankmigration und keine Änderung an `profiles`, `wallets`,
`payment_requests`, `guest_visa_*` oder Benutzerkonten in diesem PR.

## Nachschärfung für die 0-Euro-Grenze (25.10.2026)

Cloudflare Workers Free dokumentiert derzeit **100.000 Requests pro Tag** auf dem
Account. Eine 60-Sekunden-Aktualisierung würde bei 1.000 dauernd aktiven
Bürgern an einem 8-Stunden-Schultag allein schon **480.000 Worker-RPC-Requests**
auslösen, zusätzlich zum Webseiten-Traffic. Deshalb wurde das temporäre
60-Sekunden-Polling **komplett entfernt**. Daten werden beim
Seitenwechsel, nach Schreiboperationen, auf den sichtbaren Schaltflächen
„Aktualisieren“ sowie beim erneuten Sichtbarwerden des Tabs nach
mindestens zwei Minuten geladen. Nur die bereits vorhandenen expliziten
Aktionen lösen weiter Aktualisierungen aus.

Die Overlord-IP-Grenze ist wegen vieler Schüler hinter derselben Schul-IP
auf 5.000 Leseanfragen/Minute und bis zu 80 gleichzeitige Proxy-Aufrufe
**pro Worker-Isolat** angehoben; die Rate pro JWT bleibt bei 90/Minute.
Dies verhindert nicht sämtliche DDoS-Angriffe, aber vermeidet bekannte
False Positives einer geteilten Schul-IP. 

* [Cloudflare Workers Free – Limits](https://developers.cloudflare.com/workers/platform/limits/)
