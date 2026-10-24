#!/usr/bin/env python3
import json, os, subprocess, sys, tempfile, zipfile
from pathlib import Path
from xml.sax.saxutils import escape

root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as temp:
    xlsx=Path(temp)/"testdaten.xlsx"
    ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    people=[["Vorname","Nachname","Klasse"],["Maria","Muster","11A"],["Franz","Test","10B"],["Anna","Mustermann","9C"]]
    rows=[]
    for i,values in enumerate(people,1):
        cells=[]
        for col,value in zip("ABC",values):
            cells.append(f'<c r="{col}{i}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
        rows.append(f'<row r="{i}">{"".join(cells)}</row>')
    sheet=f'<worksheet xmlns="{ns}"><sheetData>{"".join(rows)}</sheetData></worksheet>'
    with zipfile.ZipFile(xlsx,"w") as z:
        z.writestr("xl/workbook.xml",f'<workbook xmlns="{ns}"/>')
        z.writestr("xl/worksheets/sheet1.xml",sheet)
    out=Path(temp)/"private"
    p=subprocess.run(["python3",str(root/"scripts/prepare-school-roster.py"),str(xlsx),"--out",str(out)],capture_output=True,text=True)
    assert p.returncode==0,p.stdout+"\n"+p.stderr
    raw=json.loads((out/"citizens-private.json").read_text())
    records=raw["citizens"]
    assert len(records)==3
    assert len({r["temporary_password"] for r in records})==3
    assert len({r["login_id"] for r in records})==3
    assert all(len(r["temporary_password"])==7 for r in records)
    pdf=out/"zugangsblaetter-vertraulich.pdf"
    assert pdf.read_bytes()[:5]==b"%PDF-"
    assert len(pdf.read_bytes())>1600
    second=subprocess.run(["python3",str(root/"scripts/prepare-school-roster.py"),str(xlsx),"--out",str(out)],capture_output=True,text=True)
    assert second.returncode!=0,"must not overwrite secret documents"
    dry=subprocess.run(["node",str(root/"scripts/provision-school-roster.mjs"),str(out/"citizens-private.json")],capture_output=True,text=True)
    assert dry.returncode==0,dry.stderr
    assert "kein Konto angelegt" in dry.stdout
print("Roster PDF + unique seven-digit credentials + provisioning dry-run passed")
