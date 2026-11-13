# Transaktionszentrale – Umsetzung und Abnahme (Issue #56)

**Status:** Code auf Entwicklungszweig; **kein produktives SQL- oder Cloudflare-Deployment**. Basis: `privacy/kennungen-ohne-klarnamen-20261109`.

## Bereits vorhanden

- Wallets und Ledger mit RLS, serverseitiger Adminprüfung sowie atomarer QR-Zahlung.
- 09.11.2026: Finanz-Audit, unveränderliches Buchungsjournal, deferred Saldo-Abgleich, Admin-Integritätsreport.
- `issue_credits` und `admin_credit_scanned_card_ids` protokollieren Gutschriften; QR-Gutschriften haben Operation-ID-Belege.
- Bürgerkennungen statt Klarnamen (offener Datenschutz-PR #55).

## Neu im Entwicklungszweig

- Eigener Navigationsbereich `Transaktionen` nur für die Rolle `admin`; direkte Navigation ebenfalls abgewehrt.
- Datenbank-RPC `admin_list_transactions`: globales, paginiertes Journal digitaler Zahlungen, Guthabenausgaben, Gegenbuchungen und **separat gekennzeichneter** Barverkäufe; Filter: ID, Kurzkennung, Typ, Zeitraum, exakter Betrag. Nur Administratoren, höchstens 100 Einträge je Aufruf.
- Status: gebucht, rückgebucht, Gegenbuchung oder Barverkauf. CSV nur der angezeigten Seite, keine Klarname-Auflösung.
- RPC `admin_reverse_transaction`: serverseitige Adminprüfung, Begründung, Operation-ID für idempotente Wiederholungen, einzig zulässiger Gegenbeleg je Ursprung, stabile Wallet-Sperrreihenfolge, **keine negativen Kontostände**.
- Ursprungsbelege unveränderlich; Reversal trägt Gegenbeleg-ID, Originalreferenz, Admin-UUID, Grund und Zeitstempel. Vorhandener Financial-Audit-Trigger zeichnet die Aktion auf.
- Bestehender Saldo-/Integritätsabgleich berücksichtigt die negative Wirkung einer Gegenbuchung. Persönliche Kontobewegungen zeigen Erstattungen und Stornos mit korrektem Vorzeichen.
- Physische Barumsätze werden **nie** automatisch durch Wallet-Veränderungen rückgebucht; externe EUR-Zahlungen erfordern einen separaten Erstattungsprozess.

## Vor Freigabe zwingend testen (Staging, fiktive Konten)

1. SQL-Migration `supabase/migrations/20261110100000_admin_transaction_centre.sql` nur auf Staging anwenden; vorher Snapshot/Backup der Staging-Datenbank sichern.
2. Als normaler Bürger, Operator und Kassenperson beide RPCs direkt über PostgREST aufrufen: **42501** erwarten. Admin darf lesen und für valide Originalbelege buchen.
3. Fiktive `issue_credits`-Gutschrift und `settle_payment_request`-Bezahlung durchführen; beide Arten stornieren. `admin_financial_integrity_report` muss `mismatch_count = 0` und `wallet_audit_coverage_ok = true` melden.
4. Ursprungsbeleg unverändert, Gegenbuchung eindeutig verknüpft, Guthaben und Buchungsjournal im Testsaldo konsistent.
5. Gleiche Operation-ID erneut verwenden: identische Gegenbuchungs-ID und `already_processed = true`, keine Saldoänderung. Zwei parallele Adminrequests auf **dieselbe** Ursprungsbuchung mit verschiedenen Operation-IDs: genau einer erfolgreich.
6. Ursprungsbuchung ohne Deckung am Empfängerkonto, bereits rückgebuchte Buchung, Reverse-on-Reverse, unbekannte ID, fehlerhafte Beträge/Filter: sicher abweisen, keine Ledger-Einträge.
7. Auf iPad und Android die Adminnavigation, Suchfilter, Pagination, Rückbuchungsdialog sowie Kontoauszüge prüfen. Cash-/Shop-Belege mit vollständig rückgebuchten digitalen Zahlungen manuell gegenprüfen.
8. CSV-Formel-Injection testen. Keine personenbezogenen Listen, Klarnamen oder Secrets in öffentliche Artefakte oder Logs aufnehmen.
9. Kassen-/Shopansicht bezüglich stornierter digitaler Verkäufe fachlich abstimmen: `shop_sales.status` bleibt bewusst als historischer Zahlungsstatus erhalten; eine zusätzliche Retouren-/Warenrückgabe-Funktion ist noch **nicht** enthalten. Für eine endgültige fachliche Abnahme sind diese Fälle zu klären.

### Freigabe-Reihenfolge

Staging-SQL → serverseitige Tests → Review → Migration im kontrollierten Produktionsfenster → Cloudflare Worker aus aktualisiertem `main` bauen und deployen → Mehrrollen- und Geräteabnahme. Kein GitHub-Push aktiviert die Live-Funktion von selbst.

**Offene Punkte:** Live-E2E-/Parallelitätstest, Shop-Retourenabgleich und organisatorische Freigabe. Es wurde kein Echtgeld-/Euro-Refund implementiert und kein produktives Geld bewegt.
