# Data Pipeline — Symbol & Standard Library Files

All static data consumed by Weave lives in the `data/` directory.
Two of the three files are **generated** from your local LTspice installation;
one is **static** and checked in permanently.

---

## Files at a Glance

| File | Size | Source | Purpose |
|------|------|--------|---------|
| `data/symbols.json` | ~5.5 MB | Generated | LTspice symbol geometry, pin positions, pin names, and attrs for every `.asy` file |
| `data/stdlib.json` | ~6.4 MB | Generated | `.subckt` and `.model` definitions from LTspice's standard library |
| `data/symbols_db.json` | ~82 KB | Static (checked in) | Curated primitive overrides — resistor, capacitor, inductor, opamp, transistor draw data |

---

## Generated Files

### `data/symbols.json`

Produced by parsing every `.asy` file under LTspice's `lib/sym/` tree.

**Key format:** forward-slash, lowercase — e.g. `comparators/lt1011`

**Entry shape:**
```json
{
  "comparators/lt1011": {
    "symType": "CELL",
    "draw": [
      { "t": "line", "x1": -32, "y1": -48, "x2": 48, "y2": 0 },
      ...
    ],
    "pins": [[-16, 48], [-32, 16], ...],
    "bbox": [-32, -48, 48, 48],
    "pinNames": { "1": "GND", "2": "In+", "3": "In-", "7": "OUT", "8": "V+" },
    "attrs": { "Value": "LT1011", "Prefix": "X", "SpiceModel": "LTC1.lib" }
  }
}
```

**Draw primitive types:**

| `t` | Fields |
|-----|--------|
| `line` | `x1 y1 x2 y2` |
| `rect` | `x1 y1 x2 y2` |
| `circle` | `x1 y1 x2 y2` (bounding box) |
| `arc` | `x1 y1 x2 y2` (bbox) + `x3 y3 x4 y4` (start/end points) |

**Consumed by:**
- `src/tab1/symbols.ts` — `symbolsReady`, `getFullSymDraw`, `SYMBOLS`, `SYM_PIN_NAMES`
- `src/tab2/schematic-symbols.ts` — IC picker search and `makeIcSymDef`

---

### `data/stdlib.json`

Produced by parsing every `.sub` and `.lib` file under LTspice's `lib/sub/` and `lib/cmp/` trees.

**Key format:** lowercase — e.g. `lt1011`, `4n25`

**Entry shape:**
```json
{
  "models": {
    "1n4148": { "type": "d" },
    "bc547":  { "type": "npn" }
  },
  "subckts": {
    "4n25": {
      "pins": ["1", "2", "3", "4", "5"],
      "body": ".subckt 4N25 1 2 3 4 5\n...\n.ends 4N25"
    }
  }
}
```

**Consumed by:**
- `src/tab1/lib-resolver.ts` — `stdlibReady`, `resolveStdlib`

---

## Regenerating the Files

Run once from the project root whenever your LTspice library updates:

```bash
python scripts/generate_data.py
```

The script auto-detects the default macOS LTspice path:
`~/Library/Application Support/LTspice/lib`

For a custom path:
```bash
python scripts/generate_data.py --ltspice-path /path/to/ltspice/lib
```

For a custom output directory:
```bash
python scripts/generate_data.py --out-dir /path/to/data
```

**Expected output:**
```
Scanning .asy files...
  Found 6276 .asy files
  Parsed: 6162  Skipped: 114
  Written: data/symbols.json  (5592 KB)

Scanning .sub / .lib files...
  Found 4492 lib files
  Subckts: 5270  Models: 3
  Written: data/stdlib.json  (6407 KB)
```

---

## Static File

### `data/symbols_db.json`

Hand-curated draw data for the primitive component types that Weave renders
inline without fetching from `symbols.json` (resistor, capacitor, inductor,
voltage source, current source, diode, transistors, opamp, switch).

**Do not regenerate or overwrite this file.** Edit it directly if a primitive
symbol needs to be adjusted.

---

## Key Format Conventions

Both generated files use **forward-slash, lowercase** keys throughout.
This replaced the earlier mixed format (`Comparators\LT1011` in `symtable.json`)
and ensures consistent lookup across all consumers.

| Old format | New format |
|-----------|------------|
| `Comparators\LT1011` | `comparators/lt1011` |
| `OpAmps\LM741` | `opamps/lm741` |
| `Digital\7400` | `digital/7400` |

---

## History

Prior to this pipeline (pre-September 2026), six separate JSON files existed:

- `data/symtable.json` — symbol pin tables (backslash mixed-case keys)
- `data/sym-draw-full.json` — raw LTspice draw geometry
- `data/sym-pin-names.json` — pin name maps
- `data/stdlib_db.json` — subckt/model index (no body text)
- `data/stdlib_db_full.json` — subckt/model index with full body text
- `data/symbols_db.json` — primitive overrides (retained)

These were consolidated into `symbols.json` + `stdlib.json` by
`scripts/generate_data.py`. The script reads directly from the LTspice
installation so the data is always current and self-consistent.
