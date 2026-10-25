# Website-Qualität: Schule als Staat

Stand: 25.10.2026. Umsetzung auf Basis der bereits vorhandenen Plattform; **keine** Neuentwicklung, Änderung an Nutzerkonten, Zahlungsmitteln oder Datenbankeinträgen.

## Qualitätsmaßstab und Status

| Dimension | Vorgehen | Status / Einschränkung |
|---|---|---|
| Informationsarchitektur | Fünf feste Mobil-Tabs; vollständige Module im Bereich „Bereiche“; Navigation und Browser-Titel konsistent | Implementiert, in Chromium getestet |
| Mobile First | 320, 375, 390, 430, 768 px; einspaltige Dashboard-Karten; Formulare ohne iOS-Zoom (16 px); 44 px oder größere wichtige Touch-Ziele; Safe-Area-Abstände | Automatisierte Layout-/Bedienungstests |
| Visuelle Gestaltung | Zurückhaltende Farben, Design-Tokens, konsistente Buttons und Abstände, bestehendes offizielles Schullogo, keine neue Bild- oder Werbesprache | Implementiert |
| Ehrliche Statusangaben | Dekorative „Live“-Indikatoren entfernt; reale Zustände statt pauschaler Echtzeitbehauptungen | Implementiert |
| Aktualisierung | Normale Browser-Neuladen-/Herunterziehen-Funktion. Keine überflüssigen Aktualisieren-Buttons und kein regelmäßiges Daten-Polling. Aktueller Bereich wird beim Neuladen im selben Tab wiederhergestellt | Implementiert; die Browser-App unterstützt den nativen Pull-to-refresh-Mechanismus jeweils browserabhängig |
| Barrierefreiheit | WCAG-Tags automatisiert mit axe-core: Kontrast, Labels, Rollen, Landmarken; Fokus sichtbar; fixierte Navigation darf keine fokussierten Elemente verdecken | Automatisierter Basistest. **Keine vollständige WCAG-Konformitätsbescheinigung** |
| Qualität der Datenanzeige | Persönliche Kontostände, Transaktionen und Stimmabgaben bleiben ausschließlich durch Backend-RLS und Auth geschützt | Keine Änderungen an Berechtigungen, PII wird nicht zwischengespeichert |
| Performance | Systemfonts statt externer Fonts, nur kurze Browser-Caches für statische CSS-/JS-Dateien, HTML und config.js immer frisch, Preconnect zu bestehenden Infrastruktur-Endpunkten | Implementiert; **keine Produktionswerte für LCP/INP/CLS gemessen** |
| Responsives Verhalten | Mobile Login-Ansicht ohne zwei große Spalten, einspaltige Cards, Bottom-Sheet für Suche, horizontal scrollbare Datentabellen bei Bedarf | Implementiert |
| SEO / Teilen | Aussagekräftige Seitentitel, Beschreibung und OpenGraph-Texte. Kein Indexing personenbezogener Kontodaten | Implementiert; Google-Indexierung nicht validiert |
| Sicherheitsgrenzen | Bestehende Cloudflare-CSP, HSTS, X-Content-Type-Options, Auth-/RLS-Schutz, Overlord-Proxy und API-Limits bleiben erhalten | Bestehender Schutz; keine neue Sicherheitsgarantie |
| Regressionen | Cloudflare Worker syntaktisch bauen; bestehende Konto-, Overlord-, und V4-Tests; Chromium-Mobiltests; Live-HTTP-Test nach Deployment | Automatisiert; menschlicher Abnahmetest auf echtem Smartphone zusätzlich sinnvoll |
| Fehlerzustände | Nutzbare Fehlermeldungen und gezieltes „Erneut laden“ nur bei echten Ladefehlern, kein verstecktes Pseudo-Refresh | Beibehalten |
| Datenschutz | Keine echten Schülerdaten in Testläufen. Screenshots/Tests mit künstlichem Nutzerprofil. Keine Testüberweisungen, kein Löschen oder Umschreiben realer Daten | Eingehalten |

## Nicht behaupten

Die Mobile-UI-Tests benutzen **synthetische Supabase-Antworten**. Sie beweisen die Layout- und Navigationsfunktion, aber nicht, dass **alle** produktiven, rollenbasierten Oberflächen (Admin, Polizei, Shopverwaltung, ViSA) vollständig visuell abgenommen wurden. Ein Geräte-Audit auf mindestens einem Android-Smartphone und einem iPhone bleibt erforderlich. Lighthouse- und Core-Web-Vitals-Feldwerte liegen nicht vor. Daher niemals „100 % WCAG“, „perfekte Performance“ oder „globaler DDoS-Schutz“ behaupten.

## Technischer Qualitätscheck vor Freigabe

- `node --check app.js` und `node scripts/build-worker.mjs` dürfen nicht scheitern.
- `tests/mobile-browser-polish.mjs` prüft echte gerenderte Browseransichten und WCAG-Axe-Basistests.
- `tests/overlord-gateway.mjs` prüft, dass API/Overlord/Zahlungen unverändert geschützt bleiben.
- `tests/roster-citizen-access.mjs` prüft Anmeldung und Schulbürger-Modell.
- Live-Checks müssen Header, `/index.html`, `/mobile-ui.css`, /app.js, PDF-Proxy und `/api/v1/health` sowie gesperrte API-Routen bestätigen.

**Quellen für Qualitätskriterien**: W3C WCAG 2.2 <https://www.w3.org/TR/WCAG22/> und Google Core Web Vitals <https://developers.google.com/search/docs/appearance/core-web-vitals>.
