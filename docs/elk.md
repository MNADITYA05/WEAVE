# ELK — Eclipse Layout Kernel

ELK (Eclipse Layout Kernel) is an open-source graph layout engine used in Tab 1 to automatically position schematic components on the canvas. Weave uses the JavaScript port **elkjs**.

---

## Why ELK?

A SPICE netlist has no position information — it only specifies connectivity. To produce a readable schematic, components must be placed at (x, y) coordinates and connected by wires that don't overlap awkwardly. This is the **graph layout problem**.

ELK is chosen because:
- It implements the **Layered** algorithm (also known as the Sugiyama framework), which is ideal for directed circuits: sources on the left, loads on the right
- It handles large graphs (100+ components) in reasonable time
- The elkjs npm bundle runs entirely in the browser — no server round-trip
- It supports explicit rank/layer constraints, which Weave uses for topology-aware placement

---

## How ELK is Invoked (`layout.ts`)

ELK runs inside a **Web Worker** to keep the main thread responsive:

```typescript
// layout.ts
const elk = new ELK({ workerUrl: '/lib/elk-worker.js' });

export async function runLayout(graph: ElkGraph): Promise<ElkGraph> {
  const result = await Promise.race([
    elk.layout(graph),
    new Promise((_, reject) =>
      setTimeout(() => reject(new LayoutError('ELK timeout')), 7000)
    )
  ]);
  return result as ElkGraph;
}
```

**Timeout:** If ELK takes more than 7 seconds (unusual for typical circuits), a `LayoutError` is thrown and the pipeline falls back to a simple linear placement algorithm.

---

## ELK Graph Format

ELK operates on a JSON graph structure of nodes and edges. Weave builds this from `PlacedComponent[]`:

```typescript
interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

interface ElkNode {
  id: string;                    // component id (e.g. 'c1')
  width: number;                 // bounding box width in abstract units
  height: number;                // bounding box height
  layoutOptions?: Record<string, string>;  // per-node overrides
  ports?: ElkPort[];             // one port per pin
}

interface ElkPort {
  id: string;          // e.g. 'c1.p' (pin name)
  properties: {
    'port.side': 'WEST' | 'EAST' | 'NORTH' | 'SOUTH';
  };
}

interface ElkEdge {
  id: string;          // e.g. 'e_net_N001'
  sources: string[];   // ['c1.p']  (port id)
  targets: string[];   // ['c2.n']  (port id)
}
```

### Port sides

Pin direction is assigned based on the component's orientation hint from Stage 3:

| Pin role | Port side |
|---|---|
| Input (left-hand net) | WEST |
| Output (right-hand net) | EAST |
| Shunt (connects to GND rail) | SOUTH |
| Shunt (connects to power rail) | NORTH |

---

## ELK Layout Options

Global layout options passed in `layoutOptions`:

```json
{
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "48",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF"
}
```

| Option | Value | Purpose |
|---|---|---|
| `elk.algorithm` | `layered` | Sugiyama hierarchical layout |
| `elk.direction` | `RIGHT` | Signal flows left-to-right |
| `nodeNodeBetweenLayers` | `80` | Horizontal gap between component columns |
| `spacing.nodeNode` | `48` | Vertical gap between components in the same column |
| `crossingMinimization.strategy` | `LAYER_SWEEP` | Reduce wire crossings iteratively |
| `nodePlacement.strategy` | `BRANDES_KOEPF` | Balance node positions within a layer |

---

## Two-Pass Layout

Tab 1 runs ELK **twice**:

### Pass 1 — Initial layout

The first pass produces a coarse layout based purely on connectivity. This gives ELK an unbiased starting point.

### Pass 2 — Topology-aware layout

After the classifier and orientation stages have run, Weave injects per-node rank constraints:

```json
{
  "elk.layered.layering.layer": "2"
}
```

This pins feedback components to a specific layer, preventing ELK from placing a feedback resistor to the left of the op-amp output it connects to. The second pass re-runs ELK with these constraints applied.

---

## Layered Algorithm (Sugiyama Framework)

The Layered algorithm runs in four phases:

### Phase 1 — Cycle Removal

Directed graphs can have cycles (feedback loops). ELK temporarily reverses some edges to make the graph acyclic, then restores them after layout.

### Phase 2 — Layer Assignment

Each node is assigned to a **layer** (column in the schematic). ELK uses the **longest path** heuristic: a node's layer = 1 + max(layer of all predecessors). This ensures signal sources are always to the left of their loads.

**Example for RC filter:**
- V1 (source) → layer 0
- R1 (depends on V1's output) → layer 1
- C1 (depends on R1's output) → layer 2

### Phase 3 — Crossing Minimisation

Within each layer, nodes are reordered to minimise wire crossings between layers. ELK uses the **Layer Sweep** strategy: sweep left-to-right and right-to-left alternately, sorting nodes by their median neighbour position.

### Phase 4 — Node Placement

Within each layer, nodes are given exact y-coordinates using the **Brandes-Köpf** algorithm, which balances nodes symmetrically around their median neighbour position to produce compact, aesthetically pleasing results.

---

## Translating ELK Output to World Coordinates

ELK returns positions in abstract units (not LTspice world units). `apply-layout.ts` maps them:

```typescript
// ELK position → LTspice world coordinate
const worldX = snap(elkNode.x * SCALE_FACTOR + ORIGIN_X);
const worldY = snap(elkNode.y * SCALE_FACTOR + ORIGIN_Y);
```

`SCALE_FACTOR` is chosen so that the average component spacing is ~160 px (10 × GRID = 10 × 16). `ORIGIN_X = 160`, `ORIGIN_Y = 160` to give a left/top margin.

The `snap()` function rounds to the nearest `GRID = 16` boundary — LTspice requires all coordinates to be multiples of 16.

---

## Timeout Handling

If ELK takes more than 7 seconds (which can happen on very large netlists or if the worker fails to initialise), the pipeline catches the `LayoutError` and falls back to a **grid placement** algorithm:

```typescript
// Fallback: place components in a grid, left-to-right, top-to-bottom
for (let i = 0; i < comps.length; i++) {
  comps[i].pos = {
    x: ORIGIN_X + (i % COLS) * COL_SPACING,
    y: ORIGIN_Y + Math.floor(i / COLS) * ROW_SPACING,
  };
}
```

The fallback produces a readable (if not optimal) schematic that the user can then manually adjust in Tab 2.

---

## ELK and the Web Worker

The elkjs worker is loaded from `lib/elk-worker.js` (bundled by Vite from the `elkjs` npm package). The worker handles all ELK computation off the main thread:

```
Main thread                      Web Worker
──────────────────               ───────────────────────────
layout.ts                        elk-worker.js
  elk.layout(graph)  ──postMessage──►  ELK.layout(graph)
                     ◄──postMessage──  result / error
```

If the worker is unavailable (e.g., CSP blocks worker script), ELK can fall back to running synchronously on the main thread, but this blocks the UI during layout.

---

## Debugging ELK Issues

If the schematic layout looks wrong:

1. **Open the browser console** — ELK errors and warnings are logged there
2. **Check for `LayoutError: ELK timeout`** — increase the timeout in `layout.ts` (line `7000`) or simplify the netlist
3. **Inspect the ELK graph** — add `console.log(JSON.stringify(graph, null, 2))` before the `elk.layout()` call to see the raw input
4. **Port sides wrong** — if wires cross excessively, the WEST/EAST assignment in `layout.ts` may be incorrect for that topology; check `orientation.ts` output
5. **Rank constraints** — if a component is in the wrong column, check the `elk.layered.layering.layer` value assigned to it in Pass 2
