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

## APK erstellen und laden
1. Die [GitHub-Actions-Pipeline](https://github.com/1234Taschenlampe/Schule-als-Staat-/actions/workflows/android-app.yml) öffnen.
2. Den neuesten erfolgreichen Lauf **Build SaS Android APK** auswählen.
3. Unter **Artifacts** das Archiv **Schule-als-Staat-Android-APK** herunterladen.
4. Archiv entpacken und `app-debug.apk` auf einem Android-Gerät installieren. Android kann eine Freigabe für die Installation aus der verwendeten App verlangen.

Das Debug-APK ist ausschließlich für interne Tests bestimmt, wird mit dem Debug-Schlüssel signiert und sollte vor einer offiziellen Veröffentlichung durch ein regulär signiertes Release ersetzt werden.

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
