/**
 * layout.ts — ELK graph construction
 *
 * Stage 5→6 of the pipeline: converts AnnotatedComponent[] into an ElkGraph
 * suitable for passing to elk.layout().
 *
 * Key responsibilities:
 *   - Maps each in-graph component to an ELK node with FIXED_POS ports
 *   - Converts signal net connections to ELK edges
 *   - Detects self-edges (same component on both ends of a net) and replaces
 *     them with external bridges (tip-to-tip wires placed after ELK layout)
 *   - BFS cycle detection to avoid ELK treating feedback paths as forward edges
 *   - Returns a portId() function so the router can look up ELK port IDs
 */

import { GRID } from '../shared/geometry.js';
import type {
  AnnotatedComponent,
  NetClassMap,
  NetDepthMap,
  ElkGraph,
  ElkGraphResult,
  Bridge,
  ElkPort,
  Point,
} from '../types.js';
import { isFlag } from './classifier.js';

declare const SYMBOLS: Record<string, { pins: unknown[]; synthetic?: boolean }>;

/** Options forwarded from convert(). */
export interface LayoutOpts {
  spacingX?: number;
  bridge?:   boolean;
}

// ─── buildElkGraph ────────────────────────────────────────────────────────────

/**
 * Build the ELK JSON graph from annotated, decorated components.
 *
 * Only components with inGraph=true participate. Signal nets with ≥2 endpoints
 * become ELK edges. Bridge pairs are returned separately for post-layout wiring.
 *
 * @param comps  - Annotated components from classifyFeedback()
 * @param opts   - Layout spacing options
 * @param cls    - Net class map
 * @param depth  - Net depth map
 * @returns ElkGraphResult — graph, portId function, and bridge list
 */
export function buildElkGraph(
  comps: readonly AnnotatedComponent[],
  opts: LayoutOpts,
  cls: NetClassMap,
  depth: NetDepthMap,
): ElkGraphResult {
  const children: ElkGraph['children'] = [];
  const edges: ElkGraph['edges'] = [];

  /** Stable port ID for component c, pin index i. */
  const portId = (c: AnnotatedComponent, i: number): string => `${c.name}.p${i}`;

  // ── ELK nodes ─────────────────────────────────────────────────────────────
  for (const c of comps.filter(c => c.inGraph)) {
    children.push({
      id: c.name,
      width:  c.rbb[2] - c.rbb[0],
      height: c.rbb[3] - c.rbb[1],
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: c.rtips.map((p: Point, i: number): ElkPort => {
        const esc = c.esc[i];
        const side =
          !esc       ? undefined
          : esc[0] > 0 ? 'EAST'
          : esc[0] < 0 ? 'WEST'
          : esc[1] < 0 ? 'NORTH'
          : 'SOUTH';
        const lo: Record<string, string> = side ? { 'elk.portSide': side } : {};
        return {
          id: portId(c, i),
          x: p[0] - c.rbb[0],
          y: p[1] - c.rbb[1],
          width:  0,
          height: 0,
          layoutOptions: lo,
        };
      }),
    });
  }

  // ── Net → pin list ────────────────────────────────────────────────────────
  // Same-component repeated pins on one net → bridge externally (self-edges
  // make ELK hug the node boundary and destroy neighbouring port positions).
  const nets = new Map<string, Array<{ c: AnnotatedComponent; i: number }>>();
  const bridges: Bridge[] = [];

  for (const c of comps.filter(c => c.inGraph)) {
    const forceBridge =
      opts.bridge === true || !!(SYMBOLS[c.sym] && SYMBOLS[c.sym]!.synthetic);
    const seen = new Map<string, number>(); // net → representative pin index

    c.nets.forEach((n: string, i: number) => {
      if (cls.get(n) !== 'signal') return;
      if (forceBridge && seen.has(n)) {
        const r = seen.get(n)!;
        const dr = c.esc[r];
        const di = c.esc[i];
        if (dr && di && dr[0] === di[0] && dr[1] === di[1]) {
          bridges.push({ c, i: r, j: i });
          return;
        }
      } else if (!seen.has(n)) {
        seen.set(n, i);
      }
      if (!nets.has(n)) nets.set(n, []);
      nets.get(n)!.push({ c, i });
    });
  }

  // ── Cycle detection (BFS) ─────────────────────────────────────────────────
  // Build adjacency over two-terminal signal↔signal components only.
  const compEdges = new Map<string, Array<{ net: string; via: AnnotatedComponent }>>();
  for (const cc of comps) {
    if (!cc.inGraph || cc.nets.length !== 2 || cc.isOp) continue;
    const n0 = cc.nets[0]!;
    const n1 = cc.nets[1]!;
    if (cls.get(n0) !== 'signal' || cls.get(n1) !== 'signal') continue;
    if (!compEdges.has(n0)) compEdges.set(n0, []);
    if (!compEdges.has(n1)) compEdges.set(n1, []);
    compEdges.get(n0)!.push({ net: n1, via: cc });
    compEdges.get(n1)!.push({ net: n0, via: cc });
  }

  const hasPath = (
    src: string,
    dst: string,
    excludeC: AnnotatedComponent,
  ): boolean => {
    const visited = new Set<string>([src]);
    const queue: string[] = [src];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const { net: nb, via } of compEdges.get(cur) ?? []) {
        if (via === excludeC) continue;
        if (nb === dst) return true;
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
      }
    }
    return false;
  };

  const isLoopComp = (c: AnnotatedComponent): boolean => {
    if (c.nets.length !== 2 || c.isOp) return false;
    const n0 = c.nets[0]!;
    const n1 = c.nets[1]!;
    if (cls.get(n0) === 'signal' && cls.get(n1) === 'signal') {
      return hasPath(n0, n1, c);
    }
    // Signal↔flag shunt: depth-difference heuristic
    return Math.abs((depth.get(n0) ?? 0) - (depth.get(n1) ?? 0)) >= 2;
  };

  // ── ELK edges ─────────────────────────────────────────────────────────────
  const isDriver = (entry: { c: AnnotatedComponent; i: number }): boolean =>
    (entry.c.isOp && entry.i === (entry.c.outPinIdx ?? 4)) ||
    ((entry.c.sym === 'voltage' || entry.c.sym === 'current') && entry.i === 0);

  let eid = 0;

  for (const [n, pins] of nets) {
    if (pins.length < 2) continue;
    let a = pins.findIndex(isDriver);
    if (a < 0) a = 0;
    const aPin = pins[a]!;

    for (let k = 0; k < pins.length; k++) {
      if (k === a) continue;
      const kPin = pins[k]!;

      const kForceBridge =
        opts.bridge === true ||
        !!(SYMBOLS[kPin.c.sym] && SYMBOLS[kPin.c.sym]!.synthetic);

      if (kForceBridge && kPin.c === aPin.c) {
        // Self-edge: route via a different pin if possible, else bridge
        const other = pins.findIndex((q, z) => z !== a && q.c !== aPin.c);
        if (other >= 0) {
          const oPin = pins[other]!;
          const loop2 = isLoopComp(oPin.c) || isLoopComp(kPin.c);
          edges.push({
            id: `e${eid++}`,
            netName: n,
            sources: [portId(oPin.c, oPin.i)],
            targets: [portId(kPin.c, kPin.i)],
            layoutOptions: loop2
              ? { 'elk.layered.priority.straightness': '0' }
              : { 'elk.layered.priority.straightness': '10' },
          });
        } else {
          bridges.push({ c: aPin.c, i: aPin.i, j: kPin.i });
        }
        continue;
      }

      const loop = isLoopComp(aPin.c) || isLoopComp(kPin.c);
      edges.push({
        id: `e${eid++}`,
        netName: n,
        sources: [portId(aPin.c, aPin.i)],
        targets: [portId(kPin.c, kPin.i)],
        layoutOptions: loop
          ? { 'elk.layered.priority.straightness': '0' }
          : { 'elk.layered.priority.straightness': '10' },
      });
    }
  }

  // ── ELK graph ─────────────────────────────────────────────────────────────
  const spacingFactor = opts.spacingX ?? 1;
  const graph: ElkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm':                                    'layered',
      'elk.direction':                                    'RIGHT',
      'elk.spacing.nodeNode':
        String(Math.round(80 * spacingFactor / 16) * 16),
      'elk.layered.spacing.nodeNodeBetweenLayers':
        String(Math.round(64 * spacingFactor / 16) * 16),
      'elk.spacing.edgeNode':                             '32',
      'elk.spacing.edgeEdge':                             '16',
      'elk.layered.spacing.edgeEdgeBetweenLayers':        '16',
      'elk.layered.spacing.edgeNodeBetweenLayers':        '16',
      'elk.edgeRouting':                                  'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy':               'NETWORK_SIMPLEX',
      'org.eclipse.elk.partitioning.activate':            'true',
    },
    children,
    edges,
  };

  return { graph, portId, bridges };
}
