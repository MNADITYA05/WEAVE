/**
 * place-repair.ts — Collision resolution
 *
 * Called after ELK snap/nudge, before routeWires.
 * Detects any two placed components that share the same origin or whose
 * bounding boxes physically intersect. Displaces the later one rightward by
 * GRID until clear. Handles any component type.
 */

import { GRID } from '../shared/geometry.js';
import type { BBox, Point } from '../types.js';

// Mutable shape of a placed component during the post-layout / collision phase.
interface RepairComp {
  readonly rbb: BBox;
  readonly rpins: readonly Point[];
  readonly rtips?: readonly Point[];
  origin?: Point;
  abs?: Point[];
  tips?: Point[];
  x?: number;
  y?: number;
  name?: string;
}

function recompute(b: RepairComp): void {
  if (!b.origin) return;
  b.x   = b.origin[0] + b.rbb[0];
  b.abs = b.rpins.map(p => [b.origin![0] + p[0], b.origin![1] + p[1]] as Point);
  if (b.rtips) {
    b.tips = b.rtips.map(p => [b.origin![0] + p[0], b.origin![1] + p[1]] as Point);
  }
}

/**
 * Displaces colliding components rightward by GRID until all bounding boxes
 * are disjoint.
 *
 * @throws if still overlapping after 500 iterations.
 */
export function resolveCollisions(comps: RepairComp[]): void {
  const G       = GRID;
  const placed  = comps.filter(c => c.origin) as (RepairComp & { origin: Point })[];

  let changed = true;
  let iters   = 0;
  while (changed && iters++ < 500) {
    changed = false;
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i]!;
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j]!;
        const sameOrigin = a.origin[0] === b.origin[0] && a.origin[1] === b.origin[1];
        if (sameOrigin) {
          b.origin[0] += G;
          recompute(b);
          changed = true;
          continue;
        }
        const ax0 = a.origin[0] + a.rbb[0], ay0 = a.origin[1] + a.rbb[1];
        const ax1 = a.origin[0] + a.rbb[2], ay1 = a.origin[1] + a.rbb[3];
        const bx0 = b.origin[0] + b.rbb[0], by0 = b.origin[1] + b.rbb[1];
        const bx1 = b.origin[0] + b.rbb[2], by1 = b.origin[1] + b.rbb[3];
        if (ax1 <= bx0 || bx1 <= ax0 || ay1 <= by0 || by1 <= ay0) continue;
        b.origin[0] += G;
        recompute(b);
        changed = true;
      }
    }
  }

  if (changed) {
    let pa: RepairComp | null = null;
    let pb: RepairComp | null = null;
    outer: for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!, b = placed[j]!;
        if (a.origin[0] === b.origin[0] && a.origin[1] === b.origin[1]) {
          pa = a; pb = b; break outer;
        }
        const ax1 = a.x ?? a.origin[0] + a.rbb[0];
        const ay1 = a.y ?? a.origin[1] + a.rbb[1];
        const ax2 = ax1 + (a.rbb[2] - a.rbb[0]);
        const ay2 = ay1 + (a.rbb[3] - a.rbb[1]);
        const bx1 = b.x ?? b.origin[0] + b.rbb[0];
        const by1 = b.y ?? b.origin[1] + b.rbb[1];
        const bx2 = bx1 + (b.rbb[2] - b.rbb[0]);
        const by2 = by1 + (b.rbb[3] - b.rbb[1]);
        if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) {
          pa = a; pb = b; break outer;
        }
      }
    }
    const who = pa
      ? `"${pa.name ?? '?'}" and "${pb?.name ?? '?'}" at origin (${pa.origin}) vs (${pb?.origin})`
      : '(pair unidentified)';
    throw new Error(`resolveCollisions: still overlapping after 500 iterations — ${who}`);
  }
}
