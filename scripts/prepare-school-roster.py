#!/usr/bin/env python3
"""Create confidential roster credentials from the school's .xlsx, OFFLINE.

No network, no Supabase write, no student data logged. Generates:
  - private manifest.json for the separate admin provisioner
  - multi-page printable one-person-per-page PDF for distribution
Uses only Python stdlib for reading Excel; ReportLab (open-source) for PDF.
Run only on a trusted computer. Delete both files securely after delivery.
"""
import argparse
import json
import os
import re
import secrets
import stat
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
LOGIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
HEADERS = {
    "vorname": {"vorname", "rufname", "firstname", "first name"},
    "nachname": {"nachname", "familienname", "surname", "lastname", "last name"},
    "klasse": {"klasse", "klassenbezeichnung", "class", "class label", "lerngruppe"},
}
MAX_ROWS = 5000

def normalized(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).strip().split())

def key(value):
    return normalized(value).casefold()

def cells_from_xlsx(source):
    with zipfile.ZipFile(source) as archive:
        files = set(archive.namelist())
        if "xl/workbook.xml" not in files:
            raise ValueError("Ungültige XLSX-Datei")
        shared = []
        if "xl/sharedStrings.xml" in files:
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for si in root.findall(NS + "si"):
                shared.append("".join(t.text or "" for t in si.iter(NS + "t")))
        if "xl/worksheets/sheet1.xml" not in files:
            raise ValueError("Erstes Tabellenblatt nicht gefunden")
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        for row in sheet.iter(NS + "row"):
            cells = {}
            for cell in row.findall(NS + "c"):
                if cell.find(NS + "f") is not None:
                    raise ValueError("Formelzellen werden aus Sicherheitsgründen nicht importiert.")
                ref = cell.get("r", "")
                m = re.match(r"([A-Z]+)\d+$", ref)
                if not m:
                    continue
                idx = 0
                for letter in m.group(1):
                    idx = idx * 26 + ord(letter) - 64
                idx -= 1
                inline = cell.find(NS + "is")
                value = cell.find(NS + "v")
                if cell.get("t") == "s":
                    content = shared[int(value.text)] if value is not None and value.text else ""
                elif inline is not None:
                    content = "".join(t.text or "" for t in inline.iter(NS + "t"))
                else:
                    content = value.text if value is not None else ""
                cells[idx] = normalized(content)
            if cells:
                yield int(row.get("r", "0")), cells

def read_roster(path):
    rows = list(cells_from_xlsx(path))
    if not rows:
        raise ValueError("Die Excel-Tabelle ist leer.")
    columns = {}
    header_index = None
    for pos, (_, row) in enumerate(rows[:20]):
        trial = {field: next((i for i, val in row.items() if key(val) in aliases), None)
                 for field, aliases in HEADERS.items()}
        if all(v is not None for v in trial.values()) and len(set(trial.values())) == 3:
            columns, header_index = trial, pos
            break
    if header_index is None:
        raise ValueError("Bitte drei Spalten 'Vorname', 'Nachname' und 'Klasse' bereitstellen.")
    results, used = [], set()
    for rownum, row in rows[header_index + 1:]:
        values = {field: normalized(row.get(col, "")) for field, col in columns.items()}
        if not any(values.values()):
            continue
        if not all(values.values()):
            raise ValueError(f"Unvollständige Zeile {rownum}; kein Konto erstellt.")
        if any(len(v) > maximum for v, maximum in
               [(values["vorname"], 80), (values["nachname"], 80), (values["klasse"], 24)]):
            raise ValueError(f"Zu lange Stammdaten in Zeile {rownum}")
        dedup = (key(values["vorname"]), key(values["nachname"]), key(values["klasse"]))
        if dedup in used:
            raise ValueError(f"Mehrfache Identität in Zeile {rownum}; vorher manuell klären.")
        used.add(dedup)
        results.append(values)
    if not results or len(results) > MAX_ROWS:
        raise ValueError("Ungültige Schülerzahl; zulässig sind 1 bis 5000 Einträge.")
    return results

def create_credentials(roster):
    allocated_pin = set()
    allocated_login = set()
    results = []
    for person in roster:
        while True:
            pin = f"{secrets.randbelow(10_000_000):07d}"
            if pin not in allocated_pin:
                allocated_pin.add(pin)
                break
        while True:
            identity = "".join(secrets.choice(LOGIN_ALPHABET) for _ in range(10))
            if identity not in allocated_login:
                allocated_login.add(identity)
                break
        results.append({
            "first_name": person["vorname"], "last_name": person["nachname"],
            "class_label": person["klasse"],
            "login_id": "SAS-" + identity,
            "email": identity.lower() + "@accounts.schule-als-staat.invalid",
            "temporary_password": pin
        })
    return results

def write_secret_json(path, data):
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        json.dump({"format_version": 1, "citizens": data}, out, ensure_ascii=False, indent=2)
        out.write("\n")

def write_slips(path, citizens):
    try:
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.colors import HexColor
    except ImportError as err:
        raise RuntimeError("ReportLab fehlt. Kostenlos installieren: python -m pip install reportlab") from err
    c = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    c.setTitle("Vertrauliche Bürgerzugänge – Schule als Staat")
    W, H = A4
    for p in citizens:
        c.setFillColor(HexColor("#14263F"))
        c.rect(0, H - 120, W, 120, stroke=0, fill=1)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 19)
        c.drawString(46, H - 59, "SCHULE ALS STAAT")
        c.setFont("Helvetica", 11)
        c.drawString(46, H - 86, "Persoenliche Zugangsdaten – VERTRAULICH")
        y = H - 166
        def item(label, value):
            nonlocal y
            c.setFillColor(HexColor("#4A5A6A"))
            c.setFont("Helvetica", 10)
            c.drawString(46, y, label)
            y -= 25
            c.setFillColor(HexColor("#14263F"))
            c.setFont("Helvetica-Bold", 16)
            # Latin-1 characters cannot all be rendered in standard PDF core fonts.
            # A Unicode font can be configured in a future design upgrade.
            c.drawString(46, y, value.encode("latin-1", errors="replace").decode("latin-1"))
            y -= 54
        item("Vorname", p["first_name"])
        item("Nachname", p["last_name"])
        item("Klasse", p["class_label"])
        item("Buergerkennung", p["login_id"])
        item("Einmaliges 7-stelliges Startpasswort", p["temporary_password"])
        c.setFont("Helvetica", 11)
        c.setFillColor(HexColor("#32455D"))
        c.drawString(46, 204, "Anmeldung: Schule-als-Staat-Webseite aufrufen.")
        c.drawString(46, 183, "Buergerkennung + Startpasswort eingeben.")
        c.drawString(46, 162, "Beim ersten Login ein neues, sicheres Passwort festlegen.")
        c.drawString(46, 141, "Diese Zugangsdaten nicht weitergeben.")
        c.setStrokeColor(HexColor("#CDD6E1"))
        c.line(46, 119, W - 46, 119)
        c.setFont("Helvetica", 9)
        c.drawString(46, 95, "Nur persoenlich an die richtige Person ausgeben. Nicht oeffentlich teilen.")
        c.showPage()
    c.save()
    os.chmod(path, 0o600)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx", type=Path)
    ap.add_argument("--out", required=True, type=Path, help="New PRIVATE output folder")
    args = ap.parse_args()
    if args.out.exists():
        ap.error("Ausgabeordner existiert bereits. Alte Daten niemals überschreiben.")
    people = read_roster(args.xlsx)
    args.out.mkdir(mode=0o700, parents=False)
    try:
        c = create_credentials(people)
        write_secret_json(args.out / "citizens-private.json", c)
        write_slips(args.out / "zugangsblaetter-vertraulich.pdf", c)
    except BaseException:
        # Do not leave a half-ready credential batch.
        for f in args.out.glob("*"):
            f.unlink()
        args.out.rmdir()
        raise
    print(f"{len(people)} Bürgerzugänge vorbereitet, {len(set(x['temporary_password'] for x in c))} eindeutige PINs.")
    print("Private Unterlagen lokal erstellt. Keine Konten angelegt, keine Daten hochgeladen.")

if __name__ == "__main__":
    main()
