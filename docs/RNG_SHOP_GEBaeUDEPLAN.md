# Interaktiver RNG-Gebäudeplan und vier Shop-Plätze je Klassenzimmer

## Quelle und Umfang

Offizieller PDF-Plan: https://www.rng-wangen.de/wp-content/uploads/2024/07/230625_digitaler-uebersichtsplan.pdf

Die Webseite zeigt **das PDF direkt von der Schulwebseite**, soweit das vom Browser unterstützt wird, plus eine eigenständige interaktive Raumauswahl. Es ist weder ein Adobe-Konto noch eine Adobe-API nötig. Der Browser kann das Original auch in einem neuen Tab öffnen.

**Wichtig:** Das externe PDF ließ sich während der Entwicklung nicht maschinell auslesen; daher wurden **keine Raumnummern, Raumformen oder präzisen Positionen erfunden**. Die Administration trägt die anhand des offiziellen Dokuments geprüften Klassenzimmer über „Schulplan → Klassenzimmer aus dem offiziellen Plan freigeben“ ein. Pro Raum kann eine PDF-Seitenzahl hinterlegt werden; eine positionsgenaue interaktive PDF-Overlay-Karte ist erst nach separater Vermessung des Planes möglich.

## Buchungsverfahren

- Alle angemeldeten Schüler sehen die Navigation **Schulplan** (und bestehende Raumreservierungen).
- Pro freigegebenem Klassenzimmer werden genau **vier** Shop-Plätze angezeigt.
- Schüler können einen freien Platz mit Shop-Namen und Beschreibung **anfragen**. Die Anfrage reserviert den Platz sofort und wartet auf Admin-Genehmigung.
- Die SQL-Funktion `request_shop_stall` sperrt die Raumzeile (`FOR UPDATE`) und der partielle eindeutige Index `sas_room_active_stall_slot` verhindert Doppelreservierungen bei parallelen Requests.
- Schüler können eigene noch offene Reservierungen zurückziehen; Admin kann Reservierungen ablehnen, genehmigen oder bereits genehmigte Shops deaktivieren.
- **Bei Genehmigung** wird automatisch ein `school_places`-Shop mit dem entsprechenden Benutzer als `owner_id` angelegt, wodurch die bestehende Shopverwaltung, Inventur und Kasse integriert werden.
- Nicht-freigegebene Räume haben `classroom_shop_enabled=false`; erst die Schulverwaltung aktiviert sie. Das ist keine automatische Berechtigung, beliebige Schulflächen zu belegen.
- Der Antragsteller muss angemeldet sein; Admin-Rechte werden serverseitig geprüft. Die Tabelle `school_shop_stalls` besitzt aktiviertes RLS und ist **nicht direkt** aus `anon` oder `authenticated` les-/schreibbar. Der Zugriff erfolgt ausschließlich durch geprüfte RPCs.
- Geprüfte Datenbanksimulation innerhalb einer zurückgerollten SQL-Transaktion: vier Plätze reservieren, doppelte Platzbuchung zurückweisen, Genehmigung erstellt Shop, Ablehnung gibt Platz frei; keine Testdaten geblieben.

## Installation

1. SQL-Migration `20261023_rng_classroom_shop_stalls.sql` ist in Supabase als `rng_classroom_shop_stalls_v29` eingespielt.
2. Frontend lädt `shop-plan.js`, `shop-plan.css`. Bei **Schulplan** erscheint der PDF-Viewer und die interaktive Raumauswahl.
3. Administration prüft Raumnummer, Gebäudeteil, Stockwerk und Nutzungsfreigabe anhand der Quelle und trägt Klassenzimmer ein. Nur diese werden buchbar.
4. Im Testbetrieb normale Schülerkonten registrieren, einen Platz beantragen; Admin genehmigt ihn; Shop erscheint in **Geschäfte / Shopverwaltung**.

## Einschränkungen / offene Punkte

- Vollständige Raumnummern, Gebäudestruktur und Positionsmarker müssen noch mit einer **direkt bereitgestellten Kopie des offiziellen PDFs** überprüft werden. Die bloße Einbettung des externen PDFs garantiert keine korrekte, interaktiv angetippte Raumgeometrie.
- Prüfen, ob die Schule das externe PDF im iframe zulässt; der Direktlink funktioniert als Fallback.
- Die Verwaltung muss klären, welche Klassenräume tatsächlich für Shops genutzt werden dürfen. Fluchtwege, Fachräume oder Räume ohne Nutzungsfreigabe bleiben unbuchbar.
- Stornierungen nach Genehmigung deaktivieren den zugehörigen Shop, statt seine Buchungs- und Umsatzhistorie zu löschen.
- Bestehende zeitgebundene Raumreservierungen (`room_bookings`) bleiben getrennt vom Shop-Platz-System erhalten.
