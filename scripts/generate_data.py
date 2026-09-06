#!/usr/bin/env python3
"""
generate_data.py — Weave data pipeline

Reads LTspice .asy symbol files and .sub/.lib files from the local LTspice
installation, then generates two consolidated JSON files:

  data/symbols.json  — symbol draw data, pin positions, pin names, attrs
  data/stdlib.json   — .subckt and .model definitions from standard library

Usage:
  python scripts/generate_data.py [--ltspice-path PATH] [--out-dir PATH]

Default LTspice path (macOS):
  ~/Library/Application Support/LTspice/lib

Output goes to ./data/ relative to the script's parent directory (the project root).
"""

from __future__ import annotations
import argparse
import json
import math
import os
import re
import sys
from pathlib import Path

# ─── CLI ──────────────────────────────────────────────────────────────────────

def parse_args():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument(
        '--ltspice-path',
        default=os.path.expanduser('~/Library/Application Support/LTspice/lib'),
        help='Path to LTspice lib folder (default: macOS standard location)',
    )
    ap.add_argument(
        '--out-dir',
        default=None,
        help='Output directory for JSON files (default: <project_root>/data)',
    )
    return ap.parse_args()

# ─── .asy parser ──────────────────────────────────────────────────────────────

def parse_asy(path: Path) -> dict | None:
    """
    Parse one LTspice .asy file.
    Returns a dict with keys: draw, pins, bbox, symType, pinNames, attrs
    Returns None if the file is not a valid symbol.
    """
    try:
        text = path.read_text(encoding='latin-1', errors='replace')
    except OSError:
        return None

    lines = text.splitlines()
    sym_type = 'CELL'
    draw = []
    pins = []           # list of [x, y]
    pin_attrs = {}      # index (0-based insert order) -> {PinName, SpiceOrder}
    current_pin_idx = None
    symattrs = {}

    xs, ys = [], []

    for line in lines:
        parts = line.split()
        if not parts:
            continue
        cmd = parts[0].upper()

        if cmd == 'SYMBOLTYPE' and len(parts) >= 2:
            sym_type = parts[1].upper()

        elif cmd == 'LINE' and len(parts) >= 6:
            try:
                x1, y1, x2, y2 = int(parts[2]), int(parts[3]), int(parts[4]), int(parts[5])
                draw.append({'t': 'line', 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2})
                xs += [x1, x2]; ys += [y1, y2]
            except (ValueError, IndexError):
                pass

        elif cmd == 'RECTANGLE' and len(parts) >= 6:
            try:
                x1, y1, x2, y2 = int(parts[2]), int(parts[3]), int(parts[4]), int(parts[5])
                draw.append({'t': 'rect', 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2})
                xs += [x1, x2]; ys += [y1, y2]
            except (ValueError, IndexError):
                pass

        elif cmd == 'CIRCLE' and len(parts) >= 6:
            try:
                x1, y1, x2, y2 = int(parts[2]), int(parts[3]), int(parts[4]), int(parts[5])
                draw.append({'t': 'circle', 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2})
                xs += [x1, x2]; ys += [y1, y2]
            except (ValueError, IndexError):
                pass

        elif cmd == 'ARC' and len(parts) >= 10:
            # ARC Normal x1 y1 x2 y2 x3 y3 x4 y4
            try:
                x1, y1, x2, y2 = int(parts[2]), int(parts[3]), int(parts[4]), int(parts[5])
                x3, y3, x4, y4 = int(parts[6]), int(parts[7]), int(parts[8]), int(parts[9])
                draw.append({'t': 'arc', 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                             'x3': x3, 'y3': y3, 'x4': x4, 'y4': y4})
                xs += [x1, x2]; ys += [y1, y2]
            except (ValueError, IndexError):
                pass

        elif cmd == 'PIN' and len(parts) >= 3:
            try:
                px, py = int(parts[1]), int(parts[2])
                current_pin_idx = len(pins)
                pins.append([px, py])
                pin_attrs[current_pin_idx] = {}
            except (ValueError, IndexError):
                current_pin_idx = None

        elif cmd == 'PINATTR' and current_pin_idx is not None and len(parts) >= 3:
            attr_name = parts[1]
            attr_val = ' '.join(parts[2:])
            pin_attrs[current_pin_idx][attr_name] = attr_val

        elif cmd == 'SYMATTR' and len(parts) >= 3:
            attr_name = parts[1]
            attr_val = ' '.join(parts[2:])
            symattrs[attr_name] = attr_val

    if not pins and not draw:
        return None

    # Compute bbox from geometry
    if xs and ys:
        bbox = [min(xs), min(ys), max(xs), max(ys)]
    elif pins:
        px_list = [p[0] for p in pins]
        py_list = [p[1] for p in pins]
        bbox = [min(px_list), min(py_list), max(px_list), max(py_list)]
    else:
        bbox = [0, 0, 0, 0]

    # Build pin-name map: spice_order (1-based str) -> name
    pin_names = {}
    for idx, attrs in pin_attrs.items():
        name = attrs.get('PinName', str(idx))
        order = attrs.get('SpiceOrder', str(idx))
        pin_names[str(order)] = name

    return {
        'symType': sym_type,
        'draw': draw,
        'pins': pins,
        'bbox': bbox,
        'pinNames': pin_names,
        'attrs': symattrs,
    }


# ─── .sub / .lib parser ───────────────────────────────────────────────────────

_SUBCKT_RE  = re.compile(r'^\s*\.subckt\s+(\S+)\s+(.+)', re.IGNORECASE)
_ENDS_RE    = re.compile(r'^\s*\.ends\b', re.IGNORECASE)
_MODEL_RE   = re.compile(r'^\s*\.model\s+(\S+)\s+(\S+)', re.IGNORECASE)

def parse_lib(path: Path) -> tuple[dict, dict]:
    """
    Parse one .sub or .lib file.
    Returns (subckts, models) dicts.
    subckts: { name_lower: { pins: [...], body: "full text" } }
    models:  { name_lower: { type: "..." } }
    """
    try:
        text = path.read_text(encoding='latin-1', errors='replace')
    except OSError:
        return {}, {}

    subckts = {}
    models  = {}

    # Join continuation lines (lines starting with '+')
    joined_lines = []
    for raw in text.splitlines():
        stripped = raw.rstrip()
        if joined_lines and stripped.startswith('+'):
            joined_lines[-1] += ' ' + stripped[1:].lstrip()
        else:
            joined_lines.append(stripped)

    in_subckt = False
    current_name = None
    current_pins = []
    current_body_lines = []

    for line in joined_lines:
        if not line or line.lstrip().startswith('*'):
            if in_subckt:
                current_body_lines.append(line)
            continue

        # .model outside subckt
        m = _MODEL_RE.match(line)
        if m and not in_subckt:
            mname, mtype = m.group(1), m.group(2).lower()
            base_type = re.split(r'[(\s]', mtype)[0]
            models[mname.lower()] = {'type': base_type}
            continue

        # .subckt start
        sm = _SUBCKT_RE.match(line)
        if sm and not in_subckt:
            in_subckt = True
            current_name = sm.group(1)
            current_pins = sm.group(2).split()
            current_body_lines = [line]
            continue

        # .ends
        if _ENDS_RE.match(line) and in_subckt:
            current_body_lines.append(line)
            body = '\n'.join(current_body_lines)
            subckts[current_name.lower()] = {
                'pins': current_pins,
                'body': body,
            }
            in_subckt = False
            current_name = None
            current_pins = []
            current_body_lines = []
            continue

        if in_subckt:
            current_body_lines.append(line)

    return subckts, models


# ─── Key normalisation ────────────────────────────────────────────────────────

def make_sym_key(rel_path: Path) -> str:
    """
    Convert a relative .asy path to a forward-slash lowercase key.
    e.g. "Comparators/LT1011.asy" -> "comparators/lt1011"
    """
    parts = rel_path.with_suffix('').parts
    return '/'.join(p.lower() for p in parts)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()
    ltspice_lib = Path(args.ltspice_path)
    sym_root = ltspice_lib / 'sym'
    sub_root = ltspice_lib / 'sub'
    cmp_root = ltspice_lib / 'cmp'

    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    out_dir = Path(args.out_dir) if args.out_dir else project_root / 'data'
    out_dir.mkdir(parents=True, exist_ok=True)

    if not sym_root.exists():
        print(f'ERROR: LTspice sym directory not found: {sym_root}', file=sys.stderr)
        print('Use --ltspice-path to specify the correct path.', file=sys.stderr)
        sys.exit(1)

    # ── 1. Process .asy files -> symbols.json ─────────────────────────────────

    print('Scanning .asy files...')
    symbols = {}
    asy_files = sorted(sym_root.rglob('*.asy'))
    print(f'  Found {len(asy_files)} .asy files')

    ok = skip = 0
    for asy_path in asy_files:
        rel = asy_path.relative_to(sym_root)
        key = make_sym_key(rel)
        entry = parse_asy(asy_path)
        if entry is None:
            skip += 1
            continue
        symbols[key] = entry
        ok += 1

    print(f'  Parsed: {ok}  Skipped: {skip}')

    out_sym = out_dir / 'symbols.json'
    out_sym.write_text(json.dumps(symbols, separators=(',', ':')), encoding='utf-8')
    print(f'  Written: {out_sym}  ({out_sym.stat().st_size // 1024} KB)')

    # ── 2. Process .sub / .lib / .cmp files -> stdlib.json ───────────────────

    print('\nScanning .sub / .lib files...')
    all_subckts: dict = {}
    all_models:  dict = {}

    lib_files = []
    if sub_root.exists():
        lib_files += list(sub_root.rglob('*.sub'))
        lib_files += list(sub_root.rglob('*.lib'))
    if cmp_root.exists():
        lib_files += list(cmp_root.rglob('*.lib'))
        lib_files += list(cmp_root.rglob('*.sub'))
    lib_files = sorted(set(lib_files))
    print(f'  Found {len(lib_files)} lib files')

    for lib_path in lib_files:
        subs, mods = parse_lib(lib_path)
        all_subckts.update(subs)
        all_models.update(mods)

    print(f'  Subckts: {len(all_subckts)}  Models: {len(all_models)}')

    stdlib = {'models': all_models, 'subckts': all_subckts}
    out_std = out_dir / 'stdlib.json'
    out_std.write_text(json.dumps(stdlib, separators=(',', ':')), encoding='utf-8')
    print(f'  Written: {out_std}  ({out_std.stat().st_size // 1024} KB)')

    print('\nDone.')
    print('Next steps:')
    print('  1. Update src/tab1/symbols.ts  — fetch data/symbols.json instead of 3 files')
    print('  2. Update src/tab1/lib-resolver.ts — fetch data/stdlib.json instead of stdlib_db.json')
    print('  3. Delete the old JSON files from data/')


if __name__ == '__main__':
    main()
