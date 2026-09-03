/**
 * net-repair.ts — Connectivity repair
 *
 * Called after routeWires, before emitAsc.
 * For every gnd/rail pin that has no wire touching it (router missed it),
 * inserts a 32-unit stub wire and a FLAG symbol in the best escape direction.
 */

import type { NetClassMap, WireSegment, FlagEntry, Point } from '../types.js';
import { onSeg } from '../shared/geometry.js';
import { railLabel } from './classifier.js';

// Minimal shape of a placed component needed by this pass.
interface RepairComp {
  readonly name: string;
  readonly nets: readonly string[];
  abs?: readonly Point[];
}

/**
 * Repairs missed gnd/rail connections by inserting stub wires and flag symbols.
 */
export function repairNets(
  comps: RepairComp[],
  wires: WireSegment[],
  flags: FlagEntry[],
  cls: NetClassMap,
): void {
  const endpoints = new Set<string>();
  for (const w of wires) {
    endpoints.add(`${w[0]},${w[1]}`);
    endpoints.add(`${w[2]},${w[3]}`);
  }

  for (const c of comps) {
    if (!c.abs) continue;
    c.nets.forEach((n, i) => {
      const t = cls.get(n);
      if (t !== 'gnd' && t !== 'rail') return;
      const [px, py] = c.abs![i]!;
      const pinKey   = `${px},${py}`;
      if (endpoints.has(pinKey)) return;
      if (wires.some(w => onSeg(px, py, w[0], w[1], w[2], w[3]))) return;

      const label = t === 'gnd' ? '0' : railLabel(n, comps as any);
      const dirs: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [dx, dy] of dirs) {
        const ex = px + dx * 32, ey = py + dy * 32;
        const endClear = !wires.some(w => {
          if ((w[4] ?? '').startsWith('FLAG:')) return false;
          return onSeg(ex, ey, w[0], w[1], w[2], w[3]);
        });
        if (endClear) {
          wires.push([px, py, ex, ey, 'FLAG:' + label]);
          flags.push([ex, ey, label]);
          endpoints.add(pinKey);
          endpoints.add(`${ex},${ey}`);
          break;
        }
      }
    });
  }
}
