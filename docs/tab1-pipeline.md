# Tab 1 — Netlist → Schematic Pipeline

Tab 1 converts a plain-text SPICE netlist into a downloadable LTspice `.asc` schematic file. The conversion runs as a **14-stage pipeline** (plus Stage 0) inside `src/tab1/convert.ts`. Every stage is pure TypeScript — no server round-trip is required.

---

## Pipeline Overview

```
Stage 0   lib-resolver.ts      Resolve stdlib references → inject .model/.subckt
Stage 1   netlist-parser.ts    Tokenise SPICE text → component + net graph
Stage 2   classifier.ts        Detect circuit topology
Stage 3   orientation.ts       Assign component depth + initial rotation
Stage 4   feedback.ts          Detect feedback loops
Stage 5   layout.ts (ELK)      Build ELK graph; run hierarchical auto-layout
Stage 6   topology hints       Adjust ELK ranks using topology-aware hints
Stage 7   layout.ts (ELK)      Second ELK pass with adjusted hints
Stage 8   apply-layout.ts      Map ELK node positions → PlacedComponent coords
Stage 9   place-repair.ts      Collision repair: push overlapping components apart
Stage 10  router.ts            Route wires between component pins
Stage 11  net-repair.ts        Repair net connectivity (dangling, crossing)
Stage 12  flag-emit.ts         Place GND / power flag symbols
Stage 13  renderer.ts          Emit LTspice .asc symbol blocks
Stage 14  wire-merge.ts        Merge collinear wire segments; detect junctions
```

---

## Stage 0 — Standard Library Resolution (`lib-resolver.ts`)

**Input:** raw netlist text  
**Output:** enriched netlist text + list of missing `.lib` references

Many SPICE netlists reference parts with `.lib some_file.lib` or use model names that exist in the LTspice standard library (e.g., `1N4148`, `LM741`). Stage 0 resolves these automatically.

- On startup, `stdlibReady` fetches `data/stdlib_db.json` (≈370 KB, ~3500 models, ~5300 subckts)
- `resolveStdlib(text)` scans every `.lib` / `.inc` directive and every `X` (subcircuit) instantiation
- If a referenced name exists in `stdlib_db.json`, the `.model` or `.subckt` definition is **injected inline** into the netlist before parsing
- If a name cannot be resolved (not in stdlib, not pasted inline), it is added to the `missingLibs[]` array
- After conversion, `app.ts` checks `missingLibs` and shows a **yellow bar** listing the unresolved parts with a file-upload button

**Example:** netlist references `.lib standard.lib` and uses `1N4148` — Stage 0 injects the full `.model 1N4148 D(...)` definition before Stage 1 ever sees the text.

---

## Stage 1 — Netlist Parser (`netlist-parser.ts`)

**Input:** enriched netlist text  
**Output:** `ParsedComponent[]`, net → node map

The parser tokenises SPICE syntax line by line:

- Joins continuation lines (lines starting with `+`)
- Identifies element type from first character: `R`, `C`, `L`, `V`, `I`, `D`, `Q`, `M`, `J`, `K`, `X`, `E`, `G`, `F`, `H`, `B`, `S`, `W`, `T`
- Extracts node names, value, and model reference
- Builds a net graph: `Map<netName, Set<pinRef>>`

**RC filter example input:**
```spice
* RC Low-pass filter
V1 in 0 AC 1
R1 in out 1k
C1 out 0 1n
.ac dec 100 1k 1Meg
.end
```

After Stage 1: `ParsedComponent[]` = `[V1(in,0), R1(in,out), C1(out,0)]`, nets = `{in, out, 0}`.

---

## Stage 2 — Topology Classifier (`classifier.ts`)

**Input:** `ParsedComponent[]` + net graph  
**Output:** `TopologyType` — one of `series | parallel | bridge | feedback | mixed`

The classifier analyses the net graph to determine the dominant wiring pattern:

- **Series:** components share one net in a chain (V→R→C→GND)
- **Parallel:** multiple components share the same two nets
- **Bridge:** H-bridge / Wheatstone pattern (4 components, 2 shared rails)
- **Feedback:** output net connects back to an input net
- **Mixed:** no single dominant pattern

**RC filter result:** `TopologyType = 'series'`

---

## Stage 3 — Orientation (`orientation.ts`)

**Input:** classified `ParsedComponent[]`  
**Output:** each component gets a `depth` (column in schematic) + initial `RotCode` (R0–MR270)

- Traverses the net graph in topological order
- Assigns depth 0 to voltage/current sources (left side), increments depth per hop
- Horizontal components (series chain) → `R0`
- Vertical components (shunt to GND) → `R90` or `R270` depending on which rail they connect to

**RC filter result:** `V1` depth=0 R90 (vertical left), `R1` depth=1 R0 (horizontal), `C1` depth=2 R90 (vertical shunt to GND)

---

## Stage 4 — Feedback Detection (`feedback.ts`)

**Input:** `ParsedComponent[]` + net graph  
**Output:** `FeedbackEdge[]` — pairs of components that form a feedback path

Uses DFS on the net graph to find back-edges (cycles). Each back-edge becomes a `FeedbackEdge` that influences ELK rank assignments and can trigger `feedback-placer.ts` for op-amp style layouts.

**RC filter result:** no feedback edges (open-loop filter).

---

## Stages 5–7 — ELK Auto-Layout (`layout.ts`)

**Input:** `ParsedComponent[]` with depth + feedback edges  
**Output:** `ElkNode` positions (x, y, width, height)

See [`elk.md`](./elk.md) for full detail. Summary:

- Builds an `ElkGraph` from the component list: each component → node, each shared net → edge
- Runs ELK.js `elk.layout()` in a **Web Worker** with a 7-second timeout
- ELK uses the **Layered** algorithm: nodes are assigned to layers (columns), then ordered within layers to minimise crossings
- A second pass re-runs ELK with topology hints (e.g., feedback components shifted to a separate rank) to improve aesthetics

**RC filter result:** V1 at x=0, R1 at x=160, C1 at x=320 (y adjusted for the shunt to GND).

---

## Stage 8 — Apply Layout (`apply-layout.ts`)

**Input:** `ElkNode[]` positions  
**Output:** `PlacedComponent[]` with world coordinates

Translates ELK's abstract node positions (grid units) into LTspice world coordinates (multiples of 16). Each component gets:
- `pos: {x, y}` — schematic position
- `rot: RotCode` — possibly overridden from orientation analysis
- `pins: Map<pinName, {x,y}>` — absolute pin world coordinates

---

## Stage 9 — Collision Repair (`place-repair.ts`)

**Input:** `PlacedComponent[]`  
**Output:** adjusted `PlacedComponent[]`

ELK sometimes places nodes that would overlap in LTspice units (ELK uses abstract spacing). This stage:
- Checks every pair of bounding boxes
- Pushes overlapping components apart along the dominant axis
- Repeats up to 10 iterations or until no overlaps remain

---

## Stage 10 — Wire Router (`router.ts`)

**Input:** `PlacedComponent[]` with pin world coords  
**Output:** `RouteSegment[]` — axis-aligned wire segments

For each net:
1. Collect all pin world-coords that share the net name
2. Compute a minimum spanning tree (MST) of the pins using Manhattan distance
3. Route each MST edge as an L-shaped or straight wire segment
4. Special cases: GND net gets a GND flag symbol, not a wire to a GND pin

**RC filter result:**  
- Net `in`: wire from V1(+) to R1(left pin)  
- Net `out`: wire from R1(right pin) to C1(top pin)  
- Net `0` (GND): GND flags on V1(−) and C1(bottom pin)

---

## Stage 11 — Net Repair (`net-repair.ts`)

**Input:** `RouteSegment[]`  
**Output:** repaired `RouteSegment[]`

Finds and fixes:
- **Dangling wires** — segments that start or end with no connected pin
- **Crossing wires** — two segments that intersect but don't share a net (adds a junction or reroutes)
- **Duplicate segments** — collinear overlapping segments on the same net

---

## Stage 12 — Flag Emitter (`flag-emit.ts` + `flag-placer.ts`)

**Input:** net list  
**Output:** `FlagSymbol[]` — GND / power flag `.asc` blocks

LTspice requires a `FLAG` line + `IOPIN` for net ports and GND symbols. This stage:
- Places `GND` symbols at every net-`0` / `GND` connection
- Places `VCC` / `VDD` / `VSS` flags for named power nets
- `flag-placer.ts` computes a position that doesn't overlap placed components

---

## Stage 13 — Renderer (`renderer.ts`)

**Input:** `PlacedComponent[]` + `FlagSymbol[]`  
**Output:** LTspice `.asc` text

Emits the complete `.asc` file:
```
Version 4
SHEET 1 <width> <height>
WIRE x1 y1 x2 y2
...
SYMBOL res <x> <y> R0
SYMATTR InstName R1
SYMATTR Value 1k
...
FLAG <x> <y> 0
IOPIN <x> <y> BiDir
```

Symbol names are mapped via `symbols.ts` (e.g., SPICE `R` → LTspice `res`, `C` → `cap`, `D` → `diode`).

---

## Stage 14 — Wire Merge (`wire-merge.ts`)

**Input:** `RouteSegment[]`  
**Output:** merged segments + `Junction[]`

Final cleanup:
- Merges collinear adjacent segments on the same net into single longer `WIRE` lines
- Detects T-junctions (a wire endpoint touching the middle of another wire) and emits `JUNCTION` markers

---

## Complete RC Filter Example

**Input netlist:**
```spice
* RC Low-pass filter
V1 in 0 AC 1
R1 in out 1k
C1 out 0 1n
.ac dec 100 1k 1Meg
.end
```

**Output `.asc` (abbreviated):**
```
Version 4
SHEET 1 880 680
WIRE 80 192 208 192
WIRE 208 192 336 192
WIRE 336 192 464 192
WIRE 336 192 336 272
FLAG 80 272 0
IOPIN 80 272 BiDir
FLAG 464 272 0
IOPIN 464 272 BiDir
SYMBOL voltage 80 192 R90
SYMATTR InstName V1
SYMATTR Value AC 1
SYMBOL res 208 192 R0
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL cap 336 272 R0
SYMATTR InstName C1
SYMATTR Value 1n
```

The resulting `.asc` can be opened directly in LTspice for simulation.

---

## Error Handling

Each stage throws typed errors that extend `WeaveError`:

| Error Class | Stage | Cause |
|---|---|---|
| `ParseError` | 1 | Unrecognised element type, malformed syntax |
| `SymbolError` | 13 | Unknown SPICE type → no LTspice symbol mapping |
| `LayoutError` | 5–7 | ELK timeout (>7s) or ELK returns empty positions |
| `RoutingError` | 10 | Net with pins on same world coord (zero-length route) |

All errors are caught in `convert.ts` and displayed in the UI error pane with the stage name.
