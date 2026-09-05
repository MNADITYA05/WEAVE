#!/usr/bin/env python3
"""
build_symbols.py — Parse LTspice .asy symbol files and output data/symbols_db.json

Run from Mac terminal:
    python3 ~/Desktop/weave/build_symbols.py

Output:
    data/symbols_db.json  — symbol geometry + pins for all core LTspice components
"""

import os, re, json
from pathlib import Path

# ─── Paths ────────────────────────────────────────────────────────────────────

LTspice_SYM = Path.home() / "Library/Application Support/LTspice/lib/sym"
OUT_DIR      = Path(__file__).parent / "data"
OUT_FILE     = OUT_DIR / "symbols_db.json"

# ─── Which .asy files to parse (maps filename → canonical SPICE prefix) ───────

TARGET_FILES = {
    "res.asy":      "R",
    "res2.asy":     "R",
    "cap.asy":      "C",
    "polcap.asy":   "C",
    "ind.asy":      "L",
    "ind2.asy":     "L",
    "voltage.asy":  "V",
    "current.asy":  "I",
    "diode.asy":    "D",
    "zener.asy":    "D",
    "schottky.asy": "D",
    "LED.asy":      "D",
    "TVSdiode.asy": "D",
    "varactor.asy": "D",
    "npn.asy":      "Q",
    "npn2.asy":     "Q",
    "npn3.asy":     "Q",
    "npn4.asy":     "Q",
    "pnp.asy":      "Q",
    "pnp2.asy":     "Q",
    "pnp4.asy":     "Q",
    "lpnp.asy":     "Q",
    "nmos.asy":     "M",
    "nmos4.asy":    "M",
    "pmos.asy":     "M",
    "pmos4.asy":    "M",
    "njf.asy":      "J",
    "pjf.asy":      "J",
    "mesfet.asy":   "J",
    "e.asy":        "E",
    "e2.asy":       "E",
    "g.asy":        "G",
    "g2.asy":       "G",
    "f.asy":        "F",
    "h.asy":        "H",
    "bi.asy":       "B",
    "bi2.asy":      "B",
    "sw.asy":       "S",
    "csw.asy":      "W",
    "tline.asy":    "T",
    "ltline.asy":   "T",
    "FerriteBead.asy":  "L",
    "FerriteBead2.asy": "L",
}

# ─── Parser ───────────────────────────────────────────────────────────────────

def parse_asy(path: Path) -> dict:
    """Parse a single .asy file into a structured dict."""
    lines_raw = path.read_text(encoding="utf-8", errors="replace").splitlines()

    lines_out  = []   # LINE segments
    circles    = []   # CIRCLE elements
    arcs       = []   # ARC elements
    rects      = []   # RECTANGLE elements
    pins       = []   # PIN definitions
    attrs      = {}   # SYMATTR key→value

    current_pin = None

    for raw in lines_raw:
        tok = raw.strip().split()
        if not tok:
            continue
        cmd = tok[0].upper()

        if cmd == "LINE":
            # LINE <style> x1 y1 x2 y2 [pattern]
            if len(tok) >= 6:
                try:
                    lines_out.append({
                        "x1": int(tok[2]), "y1": int(tok[3]),
                        "x2": int(tok[4]), "y2": int(tok[5]),
                        "style": tok[1]
                    })
                except ValueError:
                    pass

        elif cmd == "CIRCLE":
            # CIRCLE <style> x1 y1 x2 y2  (bounding box)
            if len(tok) >= 6:
                try:
                    x1,y1,x2,y2 = int(tok[2]),int(tok[3]),int(tok[4]),int(tok[5])
                    cx = (x1+x2)//2
                    cy = (y1+y2)//2
                    r  = abs(x2-x1)//2
                    circles.append({"cx": cx, "cy": cy, "r": r, "style": tok[1]})
                except ValueError:
                    pass

        elif cmd == "ARC":
            # ARC <style> x1 y1 x2 y2 x3 y3 x4 y4
            if len(tok) >= 10:
                try:
                    arcs.append({
                        "x1": int(tok[2]), "y1": int(tok[3]),
                        "x2": int(tok[4]), "y2": int(tok[5]),
                        "x3": int(tok[6]), "y3": int(tok[7]),
                        "x4": int(tok[8]), "y4": int(tok[9]),
                        "style": tok[1]
                    })
                except ValueError:
                    pass

        elif cmd == "RECTANGLE":
            if len(tok) >= 6:
                try:
                    rects.append({
                        "x1": int(tok[2]), "y1": int(tok[3]),
                        "x2": int(tok[4]), "y2": int(tok[5]),
                        "style": tok[1]
                    })
                except ValueError:
                    pass

        elif cmd == "PIN":
            # PIN x y <rotation> <length>
            if len(tok) >= 3:
                try:
                    current_pin = {
                        "x": int(tok[1]), "y": int(tok[2]),
                        "rotation": tok[3] if len(tok) > 3 else "NONE",
                        "length":   int(tok[4]) if len(tok) > 4 else 0,
                        "name": "",
                        "spiceOrder": 0,
                    }
                    pins.append(current_pin)
                except ValueError:
                    pass

        elif cmd == "PINATTR" and current_pin is not None:
            if len(tok) >= 3:
                attr = tok[1].upper()
                val  = " ".join(tok[2:])
                if attr == "PINNAME":
                    current_pin["name"] = val
                elif attr == "SPICEORDER":
                    try:
                        current_pin["spiceOrder"] = int(val)
                    except ValueError:
                        pass

        elif cmd == "SYMATTR":
            if len(tok) >= 3:
                attrs[tok[1]] = " ".join(tok[2:])
            elif len(tok) == 2:
                attrs[tok[1]] = ""

    # Sort pins by SpiceOrder
    pins.sort(key=lambda p: p["spiceOrder"])

    return {
        "lines":     lines_out,
        "circles":   circles,
        "arcs":      arcs,
        "rects":     rects,
        "pins":      pins,
        "attrs":     attrs,
    }


def compute_bbox(sym: dict) -> dict:
    """Compute the bounding box of all geometry in a symbol."""
    xs, ys = [], []
    for ln in sym["lines"]:
        xs += [ln["x1"], ln["x2"]]
        ys += [ln["y1"], ln["y2"]]
    for c in sym["circles"]:
        xs += [c["cx"]-c["r"], c["cx"]+c["r"]]
        ys += [c["cy"]-c["r"], c["cy"]+c["r"]]
    for a in sym["arcs"]:
        xs += [a["x1"], a["x2"]]
        ys += [a["y1"], a["y2"]]
    for r in sym["rects"]:
        xs += [r["x1"], r["x2"]]
        ys += [r["y1"], r["y2"]]
    for p in sym["pins"]:
        xs.append(p["x"]); ys.append(p["y"])
    if not xs:
        return {"minX": 0, "minY": 0, "maxX": 0, "maxY": 0, "w": 0, "h": 0}
    return {
        "minX": min(xs), "minY": min(ys),
        "maxX": max(xs), "maxY": max(ys),
        "w": max(xs)-min(xs), "h": max(ys)-min(ys),
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not LTspice_SYM.exists():
        print(f"❌ LTspice sym folder not found: {LTspice_SYM}")
        print("   Make sure LTspice is installed on this Mac.")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    db = {}
    missing = []

    for filename, prefix in TARGET_FILES.items():
        path = LTspice_SYM / filename
        if not path.exists():
            missing.append(filename)
            continue

        sym = parse_asy(path)
        bbox = compute_bbox(sym)
        key = filename.replace(".asy", "").lower()

        db[key] = {
            "file":    filename,
            "prefix":  prefix,
            "bbox":    bbox,
            "lines":   sym["lines"],
            "circles": sym["circles"],
            "arcs":    sym["arcs"],
            "rects":   sym["rects"],
            "pins":    sym["pins"],
            "attrs":   sym["attrs"],
        }
        print(f"  ✅ {filename:30s}  {len(sym['lines'])} lines, "
              f"{len(sym['circles'])} circles, {len(sym['arcs'])} arcs, "
              f"{len(sym['pins'])} pins")

    OUT_FILE.write_text(json.dumps(db, indent=2), encoding="utf-8")
    size_kb = OUT_FILE.stat().st_size // 1024

    print()
    print(f"✅ Wrote {OUT_FILE}")
    print(f"   {len(db)} symbols, {size_kb} KB")

    if missing:
        print(f"\n⚠️  Not found ({len(missing)}):")
        for f in missing:
            print(f"   {f}")


if __name__ == "__main__":
    main()
