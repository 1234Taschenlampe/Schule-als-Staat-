#!/usr/bin/env python3
"""Read all seven official RNG floorplan pages with Poppler; no Adobe/paid API.

Emits exhaustive *text-derived* room-code positions. A directory hit is not
mistaken for a physical room. Missing markers remain explicitly unresolved.
"""
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

PDF = Path(sys.argv[1] if len(sys.argv) > 1 else "rng-floorplan.pdf")
ROOM = re.compile(r"(?<![A-Z0-9])([A-E])-?(\d{3})(?!\d)")
# 'A-102' (basement) is different from 'A102' (upstairs).
DASHED = re.compile(r"(?<![A-Z0-9])([A-E])(-?)(\d{3})(?!\d)")
def get_words(line):
    return [w for w in line.iter() if w.tag.rsplit("}", 1)[-1] == "word"]
def parse():
    info = subprocess.check_output(["pdfinfo", str(PDF)], text=True)
    m = re.search(r"^Pages:\s+(\d+)", info, re.M)
    assert m and int(m.group(1)) == 7, "Expected exactly seven official PDF pages"
    out = subprocess.check_output(["pdftotext", "-bbox-layout", str(PDF), "-"])
    root = ET.fromstring(out)
    pages = [node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "page"]
    assert len(pages) == 7
    result = {"source": "official RNG PDF (Poppler pdftotext -bbox-layout)",
              "pages": [], "candidates": [], "page_room_codes": {}}
    for page_no, page in enumerate(pages, 1):
        pw, ph = float(page.attrib["width"]), float(page.attrib["height"])
        result["pages"].append({"page": page_no, "width": pw, "height": ph})
        page_codes = set()
        lines = [n for n in page.iter() if n.tag.rsplit("}", 1)[-1] == "line"]
        for line in lines:
            spans, joined = [], ""
            for word in get_words(line):
                s = "".join((word.text or "").upper().split())
                if not s: continue
                start, end = len(joined), len(joined)+len(s)
                spans.append((start,end,word))
                joined += s
            for match in DASHED.finditer(joined):
                code = "".join(match.groups())
                words = [w for start,end,w in spans if start < match.end() and end > match.start()]
                if not words: continue
                x0 = min(float(w.attrib["xMin"]) for w in words)
                y0 = min(float(w.attrib["yMin"]) for w in words)
                x1 = max(float(w.attrib["xMax"]) for w in words)
                y1 = max(float(w.attrib["yMax"]) for w in words)
                # For adjacent labels in a single text span, estimate substring center.
                if len(words)==1:
                    start,end,w = next((start,end,w) for start,end,w in spans if w is words[0])
                    wx0,wx1=float(w.attrib["xMin"]),float(w.attrib["xMax"])
                    x0=wx0+(wx1-wx0)*(match.start()-start)/(end-start)
                    x1=wx0+(wx1-wx0)*(match.end()-start)/(end-start)
                x = round(50*(x0+x1)/pw, 2)
                y = round(50*(y0+y1)/ph, 2)
                if not (0 < x < 100 and 0 < y < 100): continue
                page_codes.add(code)
                result["candidates"].append({
                    "page": page_no, "code": code, "x": x, "y": y,
                    "zone": "plan" if x < 68 else "directory",
                    "line": joined[:80]
                })
        result["page_room_codes"][str(page_no)] = sorted(page_codes)
    return result

if __name__ == "__main__":
    data = parse()
    output = Path(sys.argv[2] if len(sys.argv)>2 else "rng-floorplan-audit.json")
    output.write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n")
    print("RNG_AUDIT_BEGIN")
    print(json.dumps(data, ensure_ascii=False, separators=(",",":")))
    print("RNG_AUDIT_END")
