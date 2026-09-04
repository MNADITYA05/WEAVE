/**
 * feedback-placer.ts — Feedback element geometry and wiring for router.ts.
 *
 * Exported functions:
 *   buildFbJobs       — compute FbJob geometry for each local-feedback element
 *   placeDividerLegs  — place leg (divider) components at opamp inputs
 *   wireFeedback      — emit wires for local-feedback FbJobs
 *   wireFarFeedback   — place and wire far-feedback elements
 */

import { GRID, snap } from '../shared/geometry.js';
import type { Point } from '../types.js';
import { type WorkComp, type WSeg, type FbJob } from './route-types.js';
import { LayoutError, RoutingError } from '../errors.js';

// ─── buildFbJobs ─────────────────────────────────────────────────────────────

/**
 * For each opamp with a fbList, computes the geometry for each feedback
 * element (origin, abs, x, y) and returns FbJob descriptors.
 * Wires are NOT emitted here — see wireFeedback.
 */
export function buildFbJobs(opamps: WorkComp[]): FbJob[] {
  const fbJobs: FbJob[] = [];
  for (const u of opamps) {
    if (!u.fbList) continue;
    const cx      = u.origin![0];
    const bodyTop = u.origin![1] + 32;
    u.fbList.forEach((F, k) => {
      const yF    = bodyTop - 128 - 80 * k;
      const left  = F.rpins[0]![0] < F.rpins[1]![0] ? 0 : 1;
      const right = 1 - left;
      F.origin = [cx - 48 - F.rpins[left]![0], yF - F.rpins[left]![1]];
      F.abs    = F.rpins.map(p => [F.origin![0] + p[0], F.origin![1] + p[1]] as Point);
      F.x      = F.origin[0] + F.rbb[0];
      F.y      = F.origin[1] + F.rbb[1];
      const inPin  = u.abs![F.fbInIdx!]!;
      const inTip  = u.tips![F.fbInIdx!]!;
      const outTip = u.tips![u.outPinIdx!]!;
      fbJobs.push({ F, u, yF, left, right, inPin, inTip, outTip });
    });
  }
  return fbJobs;
}

// ─── placeDividerLegs ────────────────────────────────────────────────────────

/**
 * For each opamp with a legList, places each leg (voltage-divider) component
 * horizontally to the left of the opamp input tip, shifting left if a
 * collision is detected. Emits extension wires when shifted.
 */
export function placeDividerLegs(
  opamps: WorkComp[],
  comps:  WorkComp[],
  wires:  WSeg[],
): void {
  const usedLegOrg = new Set(
    comps.filter(o => o.origin).map(o => `${o.origin![0]},${o.origin![1]}`),
  );
  for (const u of opamps) {
    if (!u.legList) continue;
    u.legList.forEach(Lg => {
      const tip   = u.tips![Lg.legInIdx!]!;
      const right = Lg.rpins[0]![0] < Lg.rpins[1]![0] ? 1 : 0;
      const span  = (Lg.rbb[2] - Lg.rbb[0]) + GRID;
      let org: Point = [tip[0] - Lg.rpins[right]![0], tip[1] - Lg.rpins[right]![1]];
      let shift = 0;
      while (usedLegOrg.has(`${org[0]},${org[1]}`) && shift < 8) {
        shift++;
        org = [org[0] - span, org[1]];
      }
      if (usedLegOrg.has(`${org[0]},${org[1]}`))
        throw new LayoutError('routeWires: leg placement still colliding after 8 shifts');
      if (shift > 0) {
        const sigNet = u.nets[Lg.legInIdx!]!;
        wires.push([tip[0], tip[1], tip[0] - shift * span, tip[1], sigNet]);
      }
      Lg.origin = org;
      Lg.abs    = Lg.rpins.map(p => [Lg.origin![0] + p[0], Lg.origin![1] + p[1]] as Point);
      Lg.x = Lg.origin[0] + Lg.rbb[0];
      Lg.y = Lg.origin[1] + Lg.rbb[1];
      usedLegOrg.add(`${Lg.origin[0]},${Lg.origin[1]}`);
    });
  }
}

// ─── wireFeedback ─────────────────────────────────────────────────────────────

/**
 * Emits wires for each local-feedback FbJob.
 * Chooses the least-obstructed vertical drop column for the feedback wire.
 */
export function wireFeedback(
  fbJobs:   FbJob[],
  wires:    WSeg[],
  allSegsF: () => WSeg[],
): void {
  const segTouchesForeign = (seg: WSeg, net: string): boolean => {
    for (const w of allSegsF()) {
      if (w[4] === net) continue;
      const ax1 = Math.min(seg[0], seg[2]), ax2 = Math.max(seg[0], seg[2]);
      const ay1 = Math.min(seg[1], seg[3]), ay2 = Math.max(seg[1], seg[3]);
      const vertA = seg[0] === seg[2], vertW = w[0] === w[2];
      if (vertA && vertW && seg[0] === w[0] &&
          Math.max(ay1, Math.min(w[1], w[3])) < Math.min(ay2, Math.max(w[1], w[3]))) return true;
      if (!vertA && !vertW && seg[1] === w[1] &&
          Math.max(ax1, Math.min(w[0], w[2])) < Math.min(ax2, Math.max(w[0], w[2]))) return true;
      const onSeg = (x: number, y: number, g: WSeg): boolean => {
        if ((x === g[0] && y === g[1]) || (x === g[2] && y === g[3])) return false;
        if (g[0] === g[2]) return x === g[0] && y > Math.min(g[1], g[3]) && y < Math.max(g[1], g[3]);
        if (g[1] === g[3]) return y === g[1] && x > Math.min(g[0], g[2]) && x < Math.max(g[0], g[2]);
        return false;
      };
      if (onSeg(w[0], w[1], seg) || onSeg(w[2], w[3], seg)) return true;
      if (onSeg(seg[0], seg[1], w) || onSeg(seg[2], seg[3], w)) return true;
    }
    return false;
  };

  for (const J of fbJobs) {
    const { F, u, yF, left, right, inPin, inTip, outTip } = J;
    const nin  = F.fbInNet!;
    const nout = u.nets[u.outPinIdx!]!;
    const base = F.fbInIdx === 1 ? inTip[0] : inTip[0] - GRID;
    let xDrop  = base;
    for (const cand of [base, base - GRID, base - 2 * GRID, base + GRID, base - 3 * GRID]) {
      const v: WSeg = [cand, yF, cand, inPin[1], nin];
      if (!segTouchesForeign(v, nin)) { xDrop = cand; break; }
    }
    wires.push([F.abs![left]![0], yF, xDrop, yF, nin]);
    wires.push([xDrop, yF, xDrop, inPin[1], nin]);
    if (xDrop !== inTip[0]) wires.push([xDrop, inPin[1], inTip[0], inPin[1], nin]);
    const xOut = u.abs![u.outPinIdx!]![0] + 48;
    wires.push([F.abs![right]![0], yF, xOut, yF, nout]);
    wires.push([xOut, yF, xOut, u.abs![u.outPinIdx!]![1], nout]);
    wires.push([xOut, u.abs![u.outPinIdx!]![1], outTip[0], u.abs![u.outPinIdx!]![1], nout]);
  }
}

// ─── wireFarFeedback ──────────────────────────────────────────────────────────

/**
 * Places each far-feedback element by finding a clean drop column on the
 * upstream net's horizontal wire, then emits the connecting wires.
 */
export function wireFarFeedback(
  opamps:   WorkComp[],
  comps:    WorkComp[],
  wires:    WSeg[],
  allSegsF: () => WSeg[],
): void {
  for (const u of opamps) {
    if (!u.farList) continue;
    const base    = u.fbList ? u.fbList.length : 0;
    const bodyTop = u.origin![1] + 32;
    const xOut    = u.abs![u.outPinIdx!]![0] + 48;
    u.farList.forEach((F, j) => {
      const yF   = bodyTop - 128 - 80 * (base + j);
      const runs = allSegsF().filter(w => w[4] === F.upNet && w[1] === w[3] && w[1] > yF);
      runs.sort((a, b) => Math.abs(a[1] - yF) - Math.abs(b[1] - yF));
      const dropClean = (x: number, y: number): boolean =>
        !allSegsF().some(w => {
          if (w[4] === F.upNet || w[4] === u.nets[u.outPinIdx!]) return false;
          return w[0] === w[2] && w[0] === x &&
            Math.max(yF, Math.min(w[1], w[3])) < Math.min(y, Math.max(w[1], w[3]));
        });
      let xj: number | null = null, yj: number | null = null;
      for (const R of runs) {
        const lo = Math.min(R[0], R[2]), hi = Math.max(R[0], R[2]);
        const mid5 = snap((lo + hi) / 2);
        const cands5: number[] = [];
        for (let cx2 = lo; cx2 <= hi; cx2 += GRID) cands5.push(cx2);
        cands5.sort((a, b) => Math.abs(a - mid5) - Math.abs(b - mid5));
        for (const cx2 of cands5) {
          if (dropClean(cx2, R[1])) { xj = cx2; yj = R[1]; break; }
        }
        if (xj !== null) break;
      }
      if (xj === null && runs.length) {
        const R = runs[0]!;
        xj = snap((Math.min(R[0], R[2]) + Math.max(R[0], R[2])) / 2); yj = R[1];
        throw new RoutingError(`routeWires far-fb: no clean drop column found for upstream net "${F.upNet}" — all candidate columns blocked by foreign wires. Cannot place far-feedback element ${F.name}`);
      }
      if (xj === null) {
        const o  = comps.find(o => o.inGraph && o.nets.includes(F.upNet!));
        const oi = o ? o.nets.indexOf(F.upNet!) : -1;
        if (o && oi >= 0) {
          const tx = o.tips![oi]![0], ty = o.tips![oi]![1];
          throw new RoutingError(`routeWires far-fb: no horizontal run exists for upstream net "${F.upNet}" — cannot anchor far-feedback element ${F.name} (component ${o.name} at tip ${tx},${ty})`);
        } else {
          throw new RoutingError(`routeWires far-fb: no in-graph component found for upstream net "${F.upNet}" — cannot anchor far-feedback element ${F.name}`);
        }
      }
      const left  = F.rpins[0]![0] < F.rpins[1]![0] ? 0 : 1;
      const right = 1 - left;
      F.origin = [xj - F.rpins[left]![0], yF - F.rpins[left]![1]];
      F.abs    = F.rpins.map(p => [F.origin![0] + p[0], F.origin![1] + p[1]] as Point);
      F.x      = F.origin[0] + F.rbb[0];
      F.y      = F.origin[1] + F.rbb[1];
      wires.push([xj, yF, xj, yj!, F.upNet!]);
      wires.push([F.abs[right]![0], yF, xOut, yF, u.nets[u.outPinIdx!]!]);
      wires.push([xOut, yF, xOut, u.abs![u.outPinIdx!]![1], u.nets[u.outPinIdx!]!]);
      wires.push([xOut, u.abs![u.outPinIdx!]![1], u.tips![u.outPinIdx!]![0], u.abs![u.outPinIdx!]![1], u.nets[u.outPinIdx!]!]);
    });
  }
}
