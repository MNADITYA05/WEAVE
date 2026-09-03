/**
 * flag-emit.ts — Flag direction fix-up and flag emission
 *
 * Two passes run after ALL hang-loop placements so allSegs() is complete.
 *
 * fixFlagDirs(comps, allSegs, cls):
 *   For hang-net components, finds an escape direction for each flag pin that
 *   does not land on a foreign wire segment.
 *
 * emitFlags(comps, wires, flags, cls):
 *   Emits 32-unit stub wires and FLAG symbols for every gnd/rail pin.
 */

import type { NetClassMap, Point, WireSegment, FlagEntry } from '../types.js';
import { railLabel } from './classifier.js';

// Internal mutable component shape used during the routing / post-layout phase.
// Only the fields actually accessed by these functions are listed.
interface FlagComp {
  readonly name: string;
  readonly nets: readonly string[];
  readonly isLeg: boolean;
  readonly hangNet?: string;
  abs?: readonly Point[];
  flagDir?: (Point | null)[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ptOnSeg(p: Point, w: WireSegment): boolean {
  if (w[0] === w[2]) return p[0] === w[0] && p[1] >= Math.min(w[1], w[3]) && p[1] <= Math.max(w[1], w[3]);
  if (w[1] === w[3]) return p[1] === w[1] && p[0] >= Math.min(w[0], w[2]) && p[0] <= Math.max(w[0], w[2]);
  return false;
}

// ─── fixFlagDirs ──────────────────────────────────────────────────────────────

/**
 * For every hang-net component, picks an escape direction for each flag pin
 * that does not collide with a foreign wire. Must run after all placements.
 */
export function fixFlagDirs(
  comps: FlagComp[],
  allSegs: () => WireSegment[],
  cls: NetClassMap,
): void {
  for (const c of comps.filter(cc => cc.hangNet && cc.abs && !cc.isLeg)) {
    if (!c.flagDir) c.flagDir = c.nets.map(() => null);
    c.nets.forEach((n, i) => {
      const t = cls.get(n);
      if (t !== 'gnd' && t !== 'rail') return;
      const abs = c.abs!;
      const [px, py] = abs[i]!;
      const cur: Point = (c.flagDir![i] as Point | null) ?? (t === 'rail' ? [0, -1] : [0, 1]);
      const alts: Point[] = ([
        [0, 1], [0, -1], [-1, 0], [1, 0],
      ] as Point[]).filter(d => !(d[0] === cur[0] && d[1] === cur[1]));
      const myFlag = 'FLAG:' + (t === 'gnd' ? '0' : railLabel(n, comps as any));
      let flagPlaced = false;
      for (const d of [cur, ...alts]) {
        const L = d[0] !== 0 ? 64 : 32;
        const ex = px + d[0] * L;
        const ey = py + d[1] * 32;
        const ok = !allSegs().some(w => {
          if (!ptOnSeg([ex, ey], w)) return false;
          if (w[4] === (c as any).hangNet) return false;
          if ((w[4] ?? '').startsWith('FLAG:')) return w[4] !== myFlag;
          return true;
        });
        if (ok) { c.flagDir![i] = d; flagPlaced = true; return; }
      }
      if (!flagPlaced) {
        throw new Error(`${c.name}: no clear direction for flag pin ${i} — all 4 directions blocked`);
      }
    });
  }
}

// ─── emitFlags ────────────────────────────────────────────────────────────────

/**
 * Emits a 32-unit stub wire and a FLAG symbol for every gnd/rail pin.
 * Leg components get only a flag (no stub wire).
 */
export function emitFlags(
  comps: FlagComp[],
  wires: WireSegment[],
  flags: FlagEntry[],
  cls: NetClassMap,
): void {
  for (const c of comps) {
    c.nets.forEach((n, i) => {
      const t = cls.get(n);
      if (t !== 'gnd' && t !== 'rail') return;
      if (!c.abs) throw new Error(`${c.name}: component was never placed (internal)`);
      const [px, py] = c.abs[i]!;
      const label = t === 'gnd' ? '0' : railLabel(n, comps as any);
      if (c.isLeg) {
        flags.push([px, py, label]);
        return;
      }
      const d: Point = (c.flagDir?.[i] as Point | null) ?? (t === 'rail' ? [0, -1] : [0, 1]);
      const L = d[0] !== 0 ? 64 : 32;
      const ex = px + d[0] * L;
      const ey = py + d[1] * 32;
      wires.push([px, py, ex, ey, 'FLAG:' + label]);
      flags.push([ex, ey, label]);
    });
  }
}
