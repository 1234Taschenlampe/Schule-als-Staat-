#!/usr/bin/env python3
"""Reject confidential school data in tracked repository content.

No filenames or data values are logged: CI output is intentionally non-identifying.
Run locally BEFORE git push: python3 scripts/check-confidential-repo.py
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DENIED_EXT = {
    ".xls", ".xlsx", ".xlsm", ".ods", ".csv", ".tsv",
    ".pdf", ".doc", ".docx", ".odt", ".zip", ".7z",
    ".sqlite", ".sqlite3", ".db", ".pem", ".p12", ".pfx", ".key"
}
PRIVATE_NAMES = re.compile(
    r"(?:vertraulich|confidential|citizens-private|citizens-progress|"
    r"roster-private|roster-secrets|teacher-credentials|staff-credentials|"
    r"student-credentials|zugangsliste|zugangsblaetter|zugangsabschnitte|"
    r"passwortliste|passwort-liste|password-list|lehrerliste|"
    r"mitarbeiterliste|personal-liste|schuelerliste|schülerliste)",
    flags=re.IGNORECASE,
)
PERSONAL_MANIFEST = re.compile(
    r'"citizens"\s*:\s*\[|(?:Bürgerkennung|Buergerkennung)[;,\t].*(?:Startpasswort|Passwort)',
    flags=re.IGNORECASE,
)
# Exact citizen identifiers paired with PINs indicate potentially real credential records.
CREDENTIAL_RECORD = re.compile(
    r"SAS-[A-HJ-NP-Z2-9]{10}[^\r\n]{0,130}(?:\b\d{7,8}\b|temporary_password)",
    flags=re.IGNORECASE,
)
def main():
    result = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "-z"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True,
    )
    blocked = 0
    for raw in result.stdout.split(b"\0"):
        if not raw:
            continue
        relative = raw.decode("utf-8", errors="replace")
        path = ROOT / relative
        if path.suffix.lower() in DENIED_EXT or PRIVATE_NAMES.search(path.name):
            # General source documentation and safety checks are permitted.
            if path.suffix.lower() not in {".md", ".py", ".js", ".mjs", ".yml", ".yaml"}:
                blocked += 1
                continue
        if path.suffix.lower() not in {".json", ".txt", ".md", ".xml", ".html", ".js", ".mjs", ".py", ".sql", ".yml", ".yaml"}:
            continue
        try:
            data = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            blocked += 1
            continue
        if PERSONAL_MANIFEST.search(data) and path.suffix.lower() in {".json", ".txt", ".csv"}:
            blocked += 1
        elif CREDENTIAL_RECORD.search(data) and path.suffix.lower() in {".json", ".txt", ".md", ".html"}:
            blocked += 1
    if blocked:
        print("SCHUTZPRÜFUNG FEHLGESCHLAGEN: Vertrauliche Dateien oder Zugangsdaten im Git-Index.")
        print("Keine Dateinamen oder Inhalte werden aus Datenschutzgründen angezeigt.")
        return 1
    print("SCHUTZPRÜFUNG BESTANDEN: Keine erkannten vertraulichen Exportdateien im Git-Index.")
    print("Dies ist keine Garantie; geheime Dateien stets außerhalb des Repositorys speichern.")
    return 0
if __name__ == "__main__":
    sys.exit(main())
