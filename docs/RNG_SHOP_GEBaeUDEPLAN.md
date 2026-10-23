# Interaktiver RNG-Raumplan: Original-PDF mit anklickbaren Klassenräumen

## Offizielle Quelle

https://www.rng-wangen.de/wp-content/uploads/2024/07/230625_digitaler-uebersichtsplan.pdf

Der echte PDF-Grundriss wurde am 23.10.2026 **ohne Adobe-Dienst** ausgelesen. Das PDF enthält sieben Seiten:

| PDF-Seite | Inhalt | Regulär buchbare Klassenräume |
| --- | --- | ---: |
| 1 | Geländeübersicht, Gebäude A–E | 0 |
| 2 | Raumverzeichnis | 0 |
| 3 | Untergeschoss (Chemie/Werkraum) | 0 |
| 4 | Erdgeschoss | 13 |
| 5 | 1. Obergeschoss | 14 |
| 6 | 2. Obergeschoss | 20 |
| 7 | Dach-/3. Obergeschoss (Bildende Kunst) | 0 |
| **Summe** | | **47** |

PDF-Seite 4/5/6 sind **Planseiten**, nicht das erste Zeichen der Raumnummer. Ausnahme: Im **Gebäude E** heißen Räume im Erdgeschoss bereits E101–E109, und E205/E209 liegen auf der Seite zum **1. Obergeschoss**. Daher wird das Geschoss **immer aus der tatsächlichen Planseite**, nicht allein aus der Nummer, hergeleitet. Die Gebäudebuchstaben entsprechen dem Geländeplan auf PDF-Seite 1.

## Ausgelesene Schulräume

**Erdgeschoss (Seite 4, 13):**
- Gebäude A: A003, A006, A007, A008
- Gebäude C: C002, C003
- Gebäude E: E101, E103, E104, E105, E106, E107, E109

**1. Obergeschoss (Seite 5, 14):**
- Gebäude A: A108, A109, A110, A111, A112, A113
- Gebäude C: C106, C107
- Gebäude D: D102, D103, D104, D108
- Gebäude E: E205, E209

**2. Obergeschoss (Seite 6, 20):**
- Gebäude A: A202, A207, A208, A209, A210, A211
- Gebäude C: C201, C202, C203, C204, C206, C210, C211, C212, C213, C216
- Gebäude D: D201, D202, D203, D206

**Nicht automatisch für Shops buchbar:** Chemie (B-101, B-103), Bildende Kunst (A302/A304/A306), NwT, Physik, Biologie, Musik, Büros, Sanitärräume, Vorbereitungsräume, Bibliothek und Foyers. Bei Bedarf kann die Schulverwaltung deren Nutzung gesondert genehmigen und eintragen, aber niemals automatisch anhand einer Nummer.

## Klickbare Raumpositionen

Mit `pdftotext -bbox-layout` wurden aus den **Grundrissbereichen** 46 genaue Raumlabel-Schwerpunkte (in Prozent der PDF-Seitenbreite/-höhe) extrahiert. Diese Koordinaten stehen in `school_places.x_percent`, `y_percent` und `plan_page`.

**Sonderfall D102:** D102 ist im Verzeichnis von Seite 5 klar als Klassenraum ausgewiesen. Die grafische Beschriftung wurde jedoch nicht als separater Text im Grundriss auslesbar. D102 hat daher bewusst `x_percent=NULL,y_percent=NULL`; der Raum steht in der durchsuchbaren Liste und ist ganz normal buchbar, aber besitzt keinen möglicherweise falsch platzierten Pin.

## Technische Umsetzung

- Die originale PDF-Datei wird durch den vorhandenen Cloudflare Worker unter `/rng-floorplan.pdf` ausschließlich per **serverseitigem HTTPS-Proxy** geladen. Hierbei werden nur GET/HEAD und `application/pdf` unterstützt, mit Cache. Das Quell-PDF bleibt auf dem Schulserver und wird nicht ins GitHub-Repository kopiert.
- Die Oberfläche lädt das fest gepinnte, nach dem kritischen 2024er Sicherheitsupdate veröffentlichte `pdfjs-dist@4.10.38` von jsDelivr. PDF.js zeichnet jede Seite als Canvas.
- HTML-Buttons liegen **positionsgetreu** über dem Canvas und nutzen die X-/Y-Prozentwerte aus dem offiziell ausgelesenen PDF. PDF und Daten werden über die normale Shop-Plan-Seite ausgeliefert.
- Nutzer wählen die Seiten **Gelände / Raumverzeichnis / UG / EG / 1. OG / 2. OG / 3. OG**. Auf Seite 4/5/6 erscheinen klickbare reguläre Klassenzimmer. Für D102 erfolgt die Auswahl über die Suchliste.
- Nach Raumwahl stehen 4 Plätze zur Shop-Anfrage bereit. `request_shop_stall` blockiert parallele Doppelbuchungen per Lock und eindeutigem Index. Admin-Genehmigung erzeugt einen echten Shop in `school_places` mit Shopverwaltung/Inventur/Kasse.
- Supabase Migrationen: `rng_classroom_shop_stalls_v29` (bereits zuvor eingespielt) und `rng_official_classrooms_47_from_pdf_v30` (enthält die 47 echten Räume). Nur die zweite Migration ist neu in dieser PR.
- Die Cloudflare Worker Route /rng-floorplan.pdf wurde manuell ergänzt, einschließlich korrekter MIME-Typen für `/shop-plan.js` und `/shop-plan.css` und PDF.js-CSP-Ausnahmen. Bei Neudeployment einer kompletten Worker-Datei muss diese Ergänzung erhalten bleiben.

## Verifikation

- GitHub Actions hat **7 Seiten** vom Original-URL abgerufen; Raumverzeichnis, Fachraumklassifikation und Koordinaten extrahiert.
- Die Live-Worker-Route `/rng-floorplan.pdf` lieferte beim erneuten Github-CI-Test **byteweise identischen Inhalt** (`cmp`) gegenüber dem Original-PDF.
- In Supabase sind **47 Klassenzimmer** aktiviert, 46 mit Koordinaten und D102 ohne Koordinate.
- Existierende Tests der Shop-Buchung: genau 4 Plätze/Room, Dubletten-Schutz, Genehmigung erstellt Shop, Ablehnung gibt den Platz wieder frei; Test-Transaktion wurde zurückgerollt.

## Verantwortung

Die offizielle PDF zeigt Räume, aber keine verbindliche Schulgenehmigung, welche Fläche wirklich als Geschäft genutzt werden darf. Die Admin-Genehmigung einer Shop-Anfrage ist daher weiterhin zwingend; Brandschutz und Fachraumregeln können zusätzlich Einschränkungen erfordern.

## Korrektur 23.10.2026: vollständige Original-Pin-Karte (PR #21)

Die vorherige PDF.js-Laufzeit-Texterkennung war **keine verlässliche Raumgeometrie**: Sie platzierte manche
Pins auf Beschriftungen des seitlichen Raumverzeichnisses und übersah im PDF anders kodierte Zeichen.
Diese Technik wurde entfernt.

### Nachgewiesene Raumpositionen

Jede der sieben Seiten wurde mit dem kostenlosen Poppler-Werkzeug (`pdftotext -bbox-layout`)
ausgewertet und visuell mit dem Originalplan abgeglichen.

| Planseite | Inhalt | Im tatsächlichen Grundriss beschriftete Raumpositionen |
| --- | --- | ---: |
| 1 | Lageplan mit Gebäuden A–E | Gebäude direkt wählbar |
| 2 | Alphabetisches Raumverzeichnis | ohne physische Raumpositionen |
| 3 | Untergeschoss | 7 |
| 4 | Erdgeschoss | 37 |
| 5 | 1. Obergeschoss | 39 |
| 6 | 2. Obergeschoss | 27 |
| 7 | 3. Obergeschoss / Bildende Kunst | 5 |
| **Summe** | | **115 Raumpositionen** |

Die 115 eindeutigen Positionsdaten sind als `OFFICIAL_ROOM_POINTS` in `shop-plan.js`
gespeichert. Alle Zahlen sind Prozentwerte der **tatsächlichen PDF-Seite**; Punkte aus dem
gedruckten Legendentext wurden ausgeschlossen. Deshalb lassen sich diese Raumstellen
unmittelbar **im Gebäudeumriss** und nicht nur im Raumverzeichnis anklicken.

Zusätzliche im Gebäudeumriss gezeichnete Raumnummern (z. B. A-101/A-103, A002, A004,
A005, A012, C109, C215, C207, D105, E110 und E210) sind zusätzlich zu den bisher
hinterlegten Fach- und Verwaltungsräumen enthalten. Wo der offizielle Plan keine
Raumnutzungsangabe macht, wird **keine Nutzung erfunden**.

### Abweichung im amtlichen Plan: D102 vs. D105

Das Raumverzeichnis der **PDF-Seite 5** klassifiziert **D102** als Klassenraum. In
der gezeichneten Raumfläche steht jedoch **D105**; ein eigener Raum D102 ist dort
nicht eindeutig beschriftet. Die Lage von D102 kann daher aus diesem PDF nicht
belegt werden. D102 bleibt als bereits buchbarer Datenbankraum im Katalog
auffindbar, ohne eine **erfundene** Kartenposition; der Widerspruch wird in der
Raumansicht angezeigt. Die Schule muss klären, ob D102 und D105 dieselbe Fläche
bezeichnen. Erst danach darf eine physische Pin-Zuordnung erfolgen.

### Datenmodell / Sicherheit / Buchungen

- Die bestehenden **47** als `classroom_shop_enabled` freigegebenen Klassenzimmer
  stammen weiterhin **ausschließlich** aus Supabase `shop_room_catalog`.
- Aus der offiziellen PDF ergänzte Nicht-Klassenzimmer sind **nur Frontend-Raumdaten**;
  sie besitzen **keine** `school_places`-ID und werden **nicht** an die
  Buchungs-RPC übergeben. Sie können angezeigt, aber nicht gebucht werden.
- Für jedes bestehende freigegebene Klassenzimmer bleiben exakt **vier** Plätze;
  keine Änderung an `request_shop_stall`, `school_shop_stalls`, den vorhandenen
  Shopreservierungen, Freigaben, Benutzerkonten oder RLS-Regeln.
- Zoom (+/−/Einpassen), seitliches Scrollen und Touch-Scrollen für Smartphone
  ergänzt. Karte und Pin-Layer skalieren im selben Container.
- `tests/rng-hotspots.mjs` überprüft Pins über alle Geschossseiten, Ausnahmen,
  Nichtbuchbarkeit, genau vier Slots und mobile Bedienelemente.
- `scripts/audit-rng-floorplan.py` sowie die GitHub-CI-Datei
  `.github/workflows/rng-floorplan-audit.yml` reproduzieren die sieben
  PDF-Seiten und exportieren eine JSON-Positionsprüfung ohne Adobe-/Bezahldienst.

**Betriebsstatus:** PR #21 enthält Änderungen im Entwicklungsbranch. Ein erfolgreicher
GitHub-Source-Check ersetzt **keinen** Browser-End-to-End-Test auf echten
Smartphones. Änderungen an GitHub werden beim bestehenden Cloudflare Worker
nicht automatisch veröffentlicht. Ein produktives Deployment muss separat
ausgerollt und auf sämtlichen Stockwerken real geprüft werden.
