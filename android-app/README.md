# SaS Android-App – Admin-Vorschau

**Status:** native Android-App (APK), frühe Testversion. Noch keine NFC-Zahlung.

Die App öffnet ausschließlich das produktive SaS-Portal in einer abgesicherten Android WebView. Bürgerkonten, offizielle Namen, Rollen und Berechtigungen stammen unverändert aus Supabase. Login und Cookies verbleiben auf dem Gerät; die App besitzt keinen JavaScript-Bridge-Zugang mit Sonderrechten.

## Funktionen
- Anmeldung mit SaS-Zugangsdaten und vorhandene Funktionen der Webseite
- QR-Kamera mit Android-Berechtigungsdialog; nur für die HTTPS-Schulseite
- QR-Bild auswählen, HTTPS und Android-Zurück-Navigation
- Fremde Webseiten öffnen außerhalb des Portal-WebViews im Browser
- Keine Klarnamen, Startpasswörter oder geheimen Schlüssel im GitHub-Repository
- Hardware-NFC ist **optional**; Tap-to-Pay/Host Card Emulation und Buchung im Backend sind **noch nicht implementiert**.

## APK direkt herunterladen und installieren

Die aktuelle Android-Admin-Vorschau ist unter [Android-APK direkt herunterladen](https://github.com/1234Taschenlampe/Schule-als-Staat-/releases/download/android-admin-preview/Schule-als-Staat-Admin-Vorschau.apk) als einzelne `.apk` ohne ZIP und ohne GitHub-Actions-Menü verfügbar, sobald der erste erfolgreiche Main-Branch-Build die Release-Datei erstellt hat.

1. Auf einem **Android-Gerät** in der SaS-Webseite als Admin den Bereich **Geschäfte** öffnen und **Android-App herunterladen (.apk)** antippen.
2. Die heruntergeladene APK öffnen und gegebenenfalls die Installation aus dem Browser erlauben.
3. Die App installieren und mit den normalen SaS-Zugangsdaten anmelden.

Die Pipeline `.github/workflows/android-app.yml` erstellt die APK bei Änderungen an der Android-App bzw. an der Workflow-Datei. Bei erfolgreichen Builds auf `main` aktualisiert sie die Datei im GitHub-Release `android-admin-preview` unter einer **dauerhaften Download-Adresse**. Die ZIP-Datei im Actions-Artefakt bleibt für technische Tests verfügbar.

**Wichtig:** Es handelt sich weiterhin um ein mit einem temporären Debug-Schlüssel signiertes Test-APK. Ein späterer CI-Build kann sich deshalb nicht wie ein reguläres App-Update über die alte Installation installieren lassen; gegebenenfalls erst die Vorschau deinstallieren. Vor einer produktiven Verteilung ist eine dauerhaft signierte Release-APK erforderlich. Auf iOS/iPadOS können Android-APKs nicht installiert werden. Der öffentliche Release-Link ist kein Zugriffsschutz; die Autorisierung erfolgt weiterhin ausschließlich im Backend.

## Entwickeln
- Android Studio mit Android SDK 36 und JDK 17
- Android Gradle Plugin 9.4.1, Gradle 9.6.0
- Projekt `android-app` importieren, `app`-Modul erstellen (Debug).
- Android 8.0 (API 26) oder neuer.

## Berechtigungen und Sicherheit
- `INTERNET` für die HTTPS-Verbindung.
- `CAMERA` wird erst beim Scannen nach Genehmigung angefragt.
- NFC wird noch nicht verwendet; keine Zahlungsberechtigung.
- Android Backup ist deaktiviert.
- In der Webseite wird ein Eintrag zur Admin-Vorschau nur für Administratoren gerendert. **Der GitHub-Actions-Artefaktlink ist jedoch bei einem öffentlichen Repository kein privater Downloadschutz.** Die App darf keinerlei Administratorrechte ohne serverseitige Prüfung erhalten.

## Spätere Tap-to-Pay-Implementierung
Ein sicheres NFC-Zahlungssystem benötigt eine serverseitig autorisierte Transaktion, Empfänger/Betrag-Bestätigung, Replay-Schutz, Widerruf, Zeitlimits, Hardware- und Gerätetests. Dieses APK führt ausdrücklich keine NFC-Zahlungen aus.
