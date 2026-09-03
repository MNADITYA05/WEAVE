/**
 * orientation.ts — Component orientation and decoration
 *
 * Stage 3→4 of the pipeline: converts ParsedComponent[] → DecoratedComponent[].
 *
 * This module is a PURE TRANSFORM. It creates a brand-new DecoratedComponent
 * for each ParsedComponent and never mutates the input objects. Every property
 * on DecoratedComponent is readonly; TypeScript enforces this at the call site.
 *
 * Key responsibilities:
 *   - netDepths()          BFS from voltage/current sources over signal nets
 *   - detectOp()           Identify opamp-like pin layout
 *   - chooseRotation()     Pick R0/R90/R180/R270/MR* based on net topology
 *   - decorateComponents() Immutable transform: ParsedComponent[] → DecoratedComponent[]
 */

import { GRID, rot, rotBBox } from '../shared/geometry.js';
import type {
  ParsedComponent,
  DecoratedComponent,
  NetClassMap,
  NetDepthMap,
  RotCode,
  BBox,
  Point,
  EscDir,
} from '../types.js';
import { isFlag } from './classifier.js';

// SYMBOLS is a 1.6 MB browser global loaded via classic <script> tag.
declare const SYMBOLS: Record<string, {
  pins: Point[];
  bbox: BBox;
  synthetic?: boolean;
}>;

// ─── netDepths ────────────────────────────────────────────────────────────────

/**
 * Compute BFS signal-net depths starting from source outputs.
 *
 * Depth 0 = a net directly connected to a voltage or current source.
 * Every hop through a component adds 1. Nets not reachable from any source
 * are absent from the returned map (treated as depth ∞ by callers).
 *
 * @param comps - Parsed components
 * @param cls   - Net classification map from classifyNets()
 * @returns Map from net name to BFS depth
 */
export function netDepths(
  comps: readonly ParsedComponent[],
  cls: NetClassMap,
): NetDepthMap {
  // Build adjacency: net → reachable signal nets (via shared component)
  const adj = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string): void => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };

  for (const c of comps) {
    const sig = c.nets.filter(n => cls.get(n) === 'signal');
    for (const a of sig) {
      for (const b of sig) {
        if (a !== b) addEdge(a, b);
      }
    }
  }

  const depth: NetDepthMap = new Map();
  const queue: string[] = [];

  // Seed: nets on voltage/current sources start at depth 0
  for (const c of comps) {
    if (c.sym === 'voltage' || c.sym === 'current') {
      for (const n of c.nets) {
        if (cls.get(n) === 'signal' && !depth.has(n)) {
          depth.set(n, 0);
          queue.push(n);
        }
      }
    }
  }

  // BFS
  while (queue.length > 0) {
    const n = queue.shift()!;
    const d = depth.get(n)!;
    for (const m of adj.get(n) ?? []) {
      if (!depth.has(m)) {
        depth.set(m, d + 1);
        queue.push(m);
      }
    }
  }

  return depth;
}

// ─── detectOp ────────────────────────────────────────────────────────────────

/**
 * Returns true when a symbol's pin layout looks like an opamp/comparator.
 *
 * Heuristic: ≥3 pins total, exactly one pin on the right edge (output),
 * at least one pin on the left edge (input(s)), and left x < right x.
 *
 * @param pins - Symbol pin positions in local coordinates
 */
export function detectOp(pins: readonly Point[]): boolean {
  if (!pins || pins.length < 3) return false;
  const xs = pins.map(p => p[0]);
  const mn = Math.min(...xs);
  const mx = Math.max(...xs);
  const leftPins  = pins.filter(p => p[0] === mn);
  const rightPins = pins.filter(p => p[0] === mx);
  return leftPins.length >= 1 && rightPins.length === 1 && mn < mx;
}

// ─── chooseRotation ───────────────────────────────────────────────────────────

/**
 * Allow tests to suppress rotation heuristics (WEAVE_NOROT=1).
 * Node.js only — always false in a browser bundle.
 */
// Allow test environments (Node.js) to force R0 for all components.
declare const process: { env: Record<string, string | undefined> } | undefined;
export const NOROT: boolean =
  typeof process !== 'undefined' && !!process?.env?.['WEAVE_NOROT'];

/**
 * Choose the LTspice rotation code for a component based on its nets.
 *
 * Rules (in priority order):
 *  1. NOROT env flag → always R0 (test mode)
 *  2. Opamps → R0 (horizontal, output to the right)
 *  3. Sources → R0 (vertical, + terminal on top by LTspice convention)
 *  4. Multi-pin (>2 nets) blocks → R0 (opamp, subckt — don't rotate)
 *  5. One flag net → orient so the flag hangs below (R0 or R180)
 *  6. Series element → horizontal, lower-depth net on the left
 *
 * @param c     - Component (needs .nets, .sym, .isOp)
 * @param cls   - Net class map
 * @param depth - Net depth map
 */
export function chooseRotation(
  c: Pick<ParsedComponent, 'nets' | 'sym'> & { isOp: boolean },
  cls: NetClassMap,
  depth: NetDepthMap,
): RotCode {
  if (NOROT) return 'R0';
  if (c.isOp) return 'R0';
  if (c.sym === 'voltage' || c.sym === 'current') return 'R0';
  if (c.nets.length > 2) return 'R0';

  const [tA, tB] = [cls.get(c.nets[0]!), cls.get(c.nets[1]!)];
  if (isFlag(tB) && !isFlag(tA)) return 'R0';    // pin1 to signal, pin2 to flag at bottom
  if (isFlag(tA) && !isFlag(tB)) return 'R180';  // flip so flag pin is at bottom
  if (isFlag(tA) && isFlag(tB))  return 'R0';    // both flags (bypass/decoupling)

  // Series element: rotate horizontal, lower-depth net on the left
  const dA = depth.get(c.nets[0]!) ?? depth.get(c.nets[1]!) ?? 99;
  const dB = depth.get(c.nets[1]!) ?? depth.get(c.nets[0]!) ?? 99;
  // R270: pin1→top-left, pin2→top-right  ⟹  pin1 is on the left
  // R90:  pin1→top-right, pin2→top-left  ⟹  pin2 is on the left
  return dA <= dB ? 'R270' : 'R90';
}

// ─── decorateComponents ───────────────────────────────────────────────────────

/**
 * Immutable pipeline transform: ParsedComponent[] → DecoratedComponent[].
 *
 * For each parsed component, this function:
 *  1. Looks up the symbol definition in SYMBOLS
 *  2. Detects opamp layout
 *  3. Chooses rotation
 *  4. Rotates pin positions and bounding box
 *  5. Computes escape directions for signal pins
 *  6. Computes escape stub tip positions
 *  7. Computes flag-placement directions for gnd/rail pins
 *  8. Expands the bounding box to cover stubs and flag space
 *  9. Sets inGraph (true when ≥1 signal net)
 *
 * The input ParsedComponent objects are NEVER modified.
 *
 * @param comps - Parsed components from parseNetlist()
 * @param cls   - Net class map from classifyNets()
 * @param depth - Net depth map from netDepths()
 * @returns New DecoratedComponent[] — each is a fresh object extending the input
 * @throws {Error} When a component's symbol is not found in SYMBOLS
 */
export function decorateComponents(
  comps: readonly ParsedComponent[],
  cls: NetClassMap,
  depth: NetDepthMap,
): DecoratedComponent[] {
  return comps.map(c => {
    const S = SYMBOLS[c.sym];
    if (!S) throw new Error(`no symbol for ${c.name}`);

    // ── opamp detection ─────────────────────────────────────────────────────
    const isOp = detectOp(S.pins);
    const outPinIdx: number | undefined = isOp
      ? (() => {
          const xs = S.pins.map(p => p[0]);
          const mx = Math.max(...xs);
          return S.pins.findIndex(p => p[0] === mx);
        })()
      : undefined;

    // ── rotation ─────────────────────────────────────────────────────────────
    const rotCode = chooseRotation({ ...c, isOp }, cls, depth);
    const rpins: Point[] = S.pins.map(p => rot(p, rotCode));

    // ── bounding box (start with symbol bbox, will expand below) ─────────────
    let rbb: BBox = [...rotBBox(S.bbox, rotCode)];

    // Ensure bbox covers all rotated pins
    for (const p of rpins) {
      rbb[0] = Math.min(rbb[0], p[0]);
      rbb[1] = Math.min(rbb[1], p[1]);
      rbb[2] = Math.max(rbb[2], p[0]);
      rbb[3] = Math.max(rbb[3], p[1]);
    }

    // ── pin direction helper ──────────────────────────────────────────────────
    const cx = (rbb[0] + rbb[2]) / 2;
    const cy = (rbb[1] + rbb[3]) / 2;
    const bodyBox: BBox = [...rbb];
    const big = rpins.length > 5;

    const pinDir = (px: number, py: number): Point => {
      // Synthetic bridge symbols always escape left/right
      if (S.synthetic) return [px < 0 ? -1 : 1, 0];

      if (!big) {
        // Small symbol: escape away from centroid
        const dx = px - cx;
        const dy = py - cy;
        return Math.abs(dy) >= Math.abs(dx)
          ? [0, Math.sign(dy || 1) as -1 | 0 | 1]
          : [Math.sign(dx) as -1 | 0 | 1, 0];
      }

      // Large symbol: escape toward the nearest body edge
      const dl = px - bodyBox[0];
      const dr = bodyBox[2] - px;
      const dt = py - bodyBox[1];
      const db = bodyBox[3] - py;
      const m = Math.min(dl, dr, dt, db);
      const tied: Point[] = [];
      if (m === dr) tied.push([ 1,  0]);
      if (m === dl) tied.push([-1,  0]);
      if (m === dt) tied.push([ 0, -1]);
      if (m === db) tied.push([ 0,  1]);
      const horiz = tied.filter(d => d[1] === 0);
      return (horiz.length > 0 ? horiz : tied)[0]!;
    };

    // ── flag directions for gnd/rail pins ────────────────────────────────────
    const flagDir: (Point | null)[] = c.nets.map((n, i) => {
      if (!isFlag(cls.get(n))) return null;
      return pinDir(rpins[i]![0], rpins[i]![1]);
    });

    // Expand bbox for flag space
    const rbbMut: BBox = [...rbb];
    flagDir.forEach((d, i) => {
      if (!d) return;
      const RES = d[0] !== 0 ? 80 : 48;
      const [px, py] = rpins[i]!;
      rbbMut[0] = Math.min(rbbMut[0], px + d[0] * RES);
      rbbMut[1] = Math.min(rbbMut[1], py + d[1] * RES);
      rbbMut[2] = Math.max(rbbMut[2], px + d[0] * RES);
      rbbMut[3] = Math.max(rbbMut[3], py + d[1] * RES);
    });

    // ── escape directions for signal pins ────────────────────────────────────
    const esc: EscDir[] = c.nets.map((n, i) => {
      if (cls.get(n) !== 'signal') return null;
      if (c.sym === 'voltage' || c.sym === 'current') return [1, 0];

      const dir = pinDir(rpins[i]![0], rpins[i]![1]);
      const [px, py] = rpins[i]!;

      // If a flag pin is collinear with this escape direction, shift to avoid overlap
      const collinear = c.nets.some((fn, fi) => {
        if (fi === i || !isFlag(cls.get(fn))) return false;
        const [fx, fy] = rpins[fi]!;
        return dir[0] === 0 ? fx === px : fy === py;
      });

      return collinear ? [1, 0] : dir;
    });

    // Escape stub tips (one GRID unit beyond pin in escape direction)
    const rtips: Point[] = rpins.map((p, i) =>
      esc[i] ? [p[0] + esc[i]![0] * GRID, p[1] + esc[i]![1] * GRID] : [...p]
    );

    // Expand bbox to cover stub tips
    esc.forEach((d, i) => {
      if (!d) return;
      const [tx, ty] = rtips[i]!;
      rbbMut[0] = Math.min(rbbMut[0], tx);
      rbbMut[1] = Math.min(rbbMut[1], ty);
      rbbMut[2] = Math.max(rbbMut[2], tx);
      rbbMut[3] = Math.max(rbbMut[3], ty);
    });

    const inGraph = c.nets.some(n => cls.get(n) === 'signal');

    // ── assemble DecoratedComponent (spread base, add decoration) ────────────
    const decorated: DecoratedComponent = {
      // Carry all ParsedComponent fields unchanged (readonly in DecoratedComponent)
      name:      c.name,
      sym:       c.sym,
      nets:      c.nets,
      value:     c.value,
      // Decoration (all new, computed above)
      isOp,
      outPinIdx,
      rot:       rotCode,
      rpins,
      rbb:       rbbMut,
      esc,
      rtips,
      flagDir,
      inGraph,
    };

    return decorated;
  });
}
