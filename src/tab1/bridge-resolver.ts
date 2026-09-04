/**
 * bridge-resolver.ts — Routes external bridge connections for router.ts.
 *
 * A "bridge" is a pair of pins on the same component that share a net but
 * are not internally connected in the symbol — their stubs must be joined
 * with an explicit wire routed around the component body.
 */

import { GRID } from '../shared/geometry.js';
import type { Point, BBox } from '../types.js';
import type { WorkComp, WSeg } from './route-types.js';

// ─── routeBridges ─────────────────────────────────────────────────────────────

/**
 * For each bridge pair {c, i, j} emits the stubs and the connecting wire
 * that loops around the component body.
 */
export function routeBridges(
  bridges: Array<{ c: WorkComp; i: number; j: number }>,
  wires:   WSeg[],
): void {
  for (const B of bridges) {
    const c = B.c;
    const n = c.nets[B.i]!;
    const tA = c.tips![B.i]!;
    const tB = c.tips![B.j]!;
    const dA: Point = c.esc[B.i] ?? [1, 0];
    const dB: Point = c.esc[B.j] ?? [1, 0];
    const eA: Point = [tA[0] + dA[0] * GRID, tA[1] + dA[1] * GRID];
    const eB: Point = [tB[0] + dB[0] * GRID, tB[1] + dB[1] * GRID];
    wires.push([tA[0], tA[1], eA[0], eA[1], n]);
    wires.push([tB[0], tB[1], eB[0], eB[1], n]);
    const bb: BBox = [
      c.origin![0] + c.rbb[0], c.origin![1] + c.rbb[1],
      c.origin![0] + c.rbb[2], c.origin![1] + c.rbb[3],
    ];
    c.__lane = (c.__lane ?? 0) + 1;
    if (dA[0] === dB[0] && dA[1] === dB[1]) {
      // same escape direction — route a U around that side
      if (dA[0] !== 0) {
        const bx = (dA[0] > 0 ? Math.max(eA[0], eB[0]) : Math.min(eA[0], eB[0])) + dA[0] * GRID * (c.__lane - 1);
        wires.push([eA[0], eA[1], bx, eA[1], n]);
        wires.push([bx, eA[1], bx, eB[1], n]);
        wires.push([bx, eB[1], eB[0], eB[1], n]);
      } else {
        const by = (dA[1] > 0 ? Math.max(eA[1], eB[1]) : Math.min(eA[1], eB[1])) + dA[1] * GRID * (c.__lane - 1);
        wires.push([eA[0], eA[1], eA[0], by, n]);
        wires.push([eA[0], by, eB[0], by, n]);
        wires.push([eB[0], by, eB[0], eB[1], n]);
      }
    } else {
      // opposite / perpendicular escape — prefer top or bottom rail
      const topPref = (Math.abs(eA[1] - bb[1]) + Math.abs(eB[1] - bb[1]))
                   <= (Math.abs(eA[1] - bb[3]) + Math.abs(eB[1] - bb[3]));
      const outY = topPref ? bb[1] - GRID * c.__lane : bb[3] + GRID * c.__lane;
      wires.push([eA[0], eA[1], eA[0], outY, n]);
      wires.push([eA[0], outY, eB[0], outY, n]);
      wires.push([eB[0], outY, eB[0], eB[1], n]);
    }
  }
}
