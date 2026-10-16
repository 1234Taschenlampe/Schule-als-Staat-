# Einheitliche Schulplattform · Design und Navigation

## Gestaltungsrichtung
Helle, ruhige Arbeitsoberfläche mit neutralem Canvas (#f5f5f7), weißen Karten, dunklem Text (#1d1d1f) und genau einer primären Akzentfarbe (#1769e0). Keine Übernahme von V3-Layout oder dessen Farben. Das bestehende Schulwappen bleibt das Projektzeichen. Systemschrift (SF / Segoe UI), zurückhaltende Strichicons, 8-Pixel-Abstände, Kartenradien 20 px, Eingaben und Buttons 12 px. Gleiche Komponenten und Zustände für Finanzbereich und Schulmodule. Inhalte bestimmen die Höhe; keine starren Smartphone-Ansichten.

## Navigation
- Übersicht: persönlicher Einstieg, Ausweis, Guthaben, laufende Abstimmungen und Modulgruppen.
- Mein Bereich: Schülerausweis, Design-Galerie, ViSA, Konto, Zahlungen, Verlauf.
- Schulleben: Schwarzes Brett, Projektblog, Veranstaltungen, Fundbüro.
- Organisation: Raumplan, Raumreservierung, Geschäfte, Berufe.
- Staat & Mitbestimmung: Abstimmungen, Gesetze, Parteien, Gerichtsbekanntmachungen.
- Verwaltung: Kasse (Kasse/Admin), Administration (Admin), Einstellungen.

Desktop: gruppierte Seitenleiste, aktiver Seitenzustand, Suchdialog für alle zugänglichen Bereiche.
Mobil: Start, Portal, Bezahlen, Abstimmungen, Profil als feste Hauptnavigation; alle Funktionen über Portal und Suche erreichbar. Seitenleiste entfällt. Sichere Displayränder, Touchziele mindestens 44 px, Formulare ohne horizontales Scrollen.

## Komponenten und Daten
Buttons, Inputs, Cards, Statusanzeigen, Leerzustände, Dialog und Tabellen verwenden dieselben Tokens. Tastaturfokus sichtbar, Dialog per Escape schließbar, semantische Landmarken, reduzierte Bewegung berücksichtigt. Status wird ausgeschrieben und nicht nur farblich vermittelt.
Live-Daten ausschließlich aus der bestehenden Supabase-Sitzung. Leere Datenbank ergibt echte Leerzustände, keine Beispielfakten. Ausweisdesigns sind explizite Vorschauen; selbst gepflegte Karten gelten nicht als Identitätsnachweis. Anträge und Rollen bleiben durch bestehende RLS-Regeln geschützt. Keine sensiblen Inhalte in Suche, URL oder Browser-Entwurfsspeicherung. Suchdialog durchsucht nur statische Modulnamen und Beschreibungen.

## Abgrenzung
Gerichte und Parteien enthalten öffentliche Projektbekanntmachungen; kein privates Akten- oder Parteiverwaltungssystem. Amtliche Ausweise und Verarbeitung echter Visa-Adressdaten benötigen weiterhin die schulische Freigabe. Zahlungs-, Wahl- und Rollen-RPCs bleiben unverändert. Keine neuen kostenpflichtigen Dienste.
