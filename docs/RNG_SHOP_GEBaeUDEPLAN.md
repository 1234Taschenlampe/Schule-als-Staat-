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
