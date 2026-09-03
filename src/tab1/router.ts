/**
 * router.ts — Wire routing stage
 *
 * Routes wires between placed components and places off-graph components.
 *
 * Inputs:
 *   comps     — placed + decorated components (PlacedComponent[] for inGraph ones)
 *   opamps    — subset of comps that are opamp-like
 *   elkEdges  — ELK output edges with routing sections
 *   portId    — maps (component, pinIndex) → ELK port id string
 *   bridges   — same-component repeated-net pin pairs
 *   cls       — net classification map
 *   opts      — routing feature flags
 *
 * Returns: { wires, flags }
 */

import { GRID, snap, rot, rotBBox } from '../shared/geometry.js';
import { SYMBOLS } from './symbols.js';
import { isFlag } from './classifier.js';
import { placeIsolated } from './place-isolated.js';
import { fixFlagDirs, emitFlags } from './flag-emit.js';
import type {
  NetClassMap, WireSegment, FlagEntry, Point, BBox, RotCode, RouteResult,
  ElkEdge,
} from '../types.js';

// ─── Internal mutable component type ─────────────────────────────────────────
//
// During routing the algorithm mutates origin / abs / rot / rpins / rbb on
// off-graph components (hang, fb, far, leg, isolated). The types.ts interfaces
// are immutable (readonly everywhere), so we use a local mutable alias and cast
// at the boundary.

interface WorkComp {
  readonly name:      string;
  readonly sym:       string;
  readonly nets:      readonly string[];
  readonly inGraph:   boolean;
  readonly isFb:      boolean;
  readonly isFar:     boolean;
  readonly isLeg:     boolean;
  readonly isHang:    boolean;
  readonly hangNet?:  string;
  readonly outPinIdx?: number;
  readonly fbInIdx?:  number;
  readonly fbInNet?:  string;
  readonly upNet?:    string;
  readonly legInIdx?: number;
  readonly fbList?:   WorkComp[];
  readonly farList?:  WorkComp[];
  readonly legList?:  WorkComp[];
  // Mutable geometry (set by applyLayout or by routeWires for off-graph comps)
  rot:      RotCode;
  rpins:    Point[];
  rbb:      BBox;
  esc:      (Point | null)[];
  flagDir?: (Point | null)[];
  origin?:  Point;
  abs?:     Point[];
  tips?:    Point[];
  x?:       number;
  y?:       number;
  __lane?:  number;
}

// ─── Routing options ──────────────────────────────────────────────────────────

export interface RouteOpts {
  noLPass?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type WSeg = [number, number, number, number, string?];

function ptOnSeg(p: Point, w: WSeg): boolean {
  if (w[0] === w[2]) return p[0] === w[0] && p[1] >= Math.min(w[1], w[3]) && p[1] <= Math.max(w[1], w[3]);
  if (w[1] === w[3]) return p[1] === w[1] && p[0] >= Math.min(w[0], w[2]) && p[0] <= Math.max(w[0], w[2]);
  return false;
}

function segRectHit(w: WSeg, r: BBox): boolean {
  const [ax, ay, bx, by] = w;
  const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx);
  const y1 = Math.min(ay, by), y2 = Math.max(ay, by);
  return !(x2 < r[0] || x1 > r[2] || y2 < r[1] || y1 > r[3]);
}

function segSegTouch(a: WSeg, b: WSeg): boolean {
  const ax1 = Math.min(a[0], a[2]), ax2 = Math.max(a[0], a[2]);
  const ay1 = Math.min(a[1], a[3]), ay2 = Math.max(a[1], a[3]);
  const bx1 = Math.min(b[0], b[2]), bx2 = Math.max(b[0], b[2]);
  const by1 = Math.min(b[1], b[3]), by2 = Math.max(b[1], b[3]);
  return !(ax2 < bx1 || ax1 > bx2 || ay2 < by1 || ay1 > by2);
}

function fixEnd(pts: Point[], idx: number, target: Point | undefined): void {
  if (!target) return;
  const other = idx === 0 ? 1 : pts.length - 2;
  const p = pts[idx]!;
  if (pts.length >= 2) {
    const q = pts[other]!;
    if (q[1] === p[1]) q[1] = target[1]; else if (q[0] === p[0]) q[0] = target[0];
  }
  pts[idx] = [target[0], target[1]];
}

function collinearOverlap(a: WSeg, b: WSeg): boolean {
  if (a[0] === a[2] && b[0] === b[2] && a[0] === b[0])
    return Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3])) < Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3]));
  if (a[1] === a[3] && b[1] === b[3] && a[1] === b[1])
    return Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2])) < Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2]));
  return false;
}

// ─── routeWires ───────────────────────────────────────────────────────────────

/**
 * Routes wires between all placed components and places off-graph components
 * (feedback, far-feedback, leg, hang, isolated).
 */
export function routeWires(
  comps:    WorkComp[],
  opamps:   WorkComp[],
  elkEdges: ElkEdge[],
  portId:   (c: WorkComp, i: number) => string,
  bridges:  Array<{ c: WorkComp; i: number; j: number }>,
  cls:      NetClassMap,
  opts:     RouteOpts,
): RouteResult {
  const wires: WSeg[] = [];

  // ── Port absolute positions ───────────────────────────────────────────────

  const portAbs = new Map<string, Point>();
  for (const c of comps.filter(c => c.inGraph)) {
    c.tips!.forEach((p, i) => portAbs.set(portId(c, i), p));
    // emit escape stubs (tagged with their net)
    c.esc.forEach((d, i) => {
      if (d) wires.push([c.abs![i]![0], c.abs![i]![1], c.tips![i]![0], c.tips![i]![1], c.nets[i]!]);
    });
  }

  // ── Feedback layout (geometry only — wires deferred) ─────────────────────

  interface FbJob {
    F: WorkComp; u: WorkComp; yF: number; left: number; right: number;
    inPin: Point; inTip: Point; outTip: Point;
  }
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
      F.x      = F.origin[0] + F.rbb[0]; F.y = F.origin[1] + F.rbb[1];
      const inPin  = u.abs![F.fbInIdx!]!;
      const inTip  = u.tips![F.fbInIdx!]!;
      const outTip = u.tips![u.outPinIdx!]!;
      fbJobs.push({ F, u, yF, left, right, inPin, inTip, outTip });
    });
  }

  // ── Divider leg placement ─────────────────────────────────────────────────

  {
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
          shift++; org = [org[0] - span, org[1]];
        }
        if (usedLegOrg.has(`${org[0]},${org[1]}`))
          throw new Error('routeWires: leg placement still colliding after 8 shifts');
        if (shift > 0) {
          const sigNet = u.nets[Lg.legInIdx!]!;
          wires.push([tip[0], tip[1], tip[0] - shift * span, tip[1], sigNet]);
        }
        Lg.origin = org;
        Lg.abs    = Lg.rpins.map(p => [Lg.origin![0] + p[0], Lg.origin![1] + p[1]] as Point);
        Lg.x = Lg.origin[0] + Lg.rbb[0]; Lg.y = Lg.origin[1] + Lg.rbb[1];
        usedLegOrg.add(`${Lg.origin[0]},${Lg.origin[1]}`);
      });
    }
  }

  // ── ELK edge routes ───────────────────────────────────────────────────────

  interface Route { net: string; pts: Point[] }
  const routes: Route[] = [];

  for (const e of (elkEdges ?? [])) {
    for (const s of (e.sections ?? [])) {
      let pts: Point[] = [
        s.startPoint,
        ...(s.bendPoints ?? []),
        s.endPoint,
      ].map(p => [snap(p.x), snap(p.y)]);
      const A = portAbs.get(e.sources[0]!);
      const B = portAbs.get(e.targets[0]!);
      fixEnd(pts, 0, A);
      fixEnd(pts, pts.length - 1, B);
      if (A) pts[0] = [A[0], A[1]];
      if (B) pts[pts.length - 1] = [B[0], B[1]];
      // insert corners at diagonal adjacencies
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k]!, b = pts[k + 1]!;
        if (a[0] !== b[0] && a[1] !== b[1]) pts.splice(k + 1, 0, [a[0], b[1]]);
      }
      // deduplicate collinear pts
      for (let k = pts.length - 2; k >= 0; k--) {
        if (pts[k]![0] === pts[k + 1]![0] && pts[k]![1] === pts[k + 1]![1]) pts.splice(k + 1, 1);
      }
      // orthogonalize residual diagonals
      const path: Point[] = [pts[0]!];
      for (let i = 1; i < pts.length; i++) {
        const p = path[path.length - 1]!, q = pts[i]!;
        if (p[0] !== q[0] && p[1] !== q[1]) path.push([q[0], p[1]]);
        path.push(q);
      }
      routes.push({ net: e.netName ?? e.id, pts: path });
    }
  }

  // ── External bridges ──────────────────────────────────────────────────────

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
      const topPref = (Math.abs(eA[1] - bb[1]) + Math.abs(eB[1] - bb[1]))
                   <= (Math.abs(eA[1] - bb[3]) + Math.abs(eB[1] - bb[3]));
      const outY = topPref ? bb[1] - GRID * c.__lane : bb[3] + GRID * c.__lane;
      wires.push([eA[0], eA[1], eA[0], outY, n]);
      wires.push([eA[0], outY, eB[0], outY, n]);
      wires.push([eB[0], outY, eB[0], eB[1], n]);
    }
  }

  // ── Deconflict ELK routes vs stub tips ───────────────────────────────────

  {
    const tipPts: Array<{ x: number; y: number; net: string; d: Point }> = [];
    for (const c of comps.filter(c => c.inGraph)) {
      c.tips!.forEach((p, i) => {
        if (c.esc[i]) tipPts.push({ x: p[0], y: p[1], net: c.nets[i]!, d: c.esc[i]! });
      });
    }
    for (const r of routes) {
      for (let pass = 0; pass < 2; pass++) {
        let changed = false;
        for (let i = 0; i + 1 < r.pts.length; i++) {
          const a = r.pts[i]!, b = r.pts[i + 1]!;
          for (const t of tipPts) {
            if (t.net === r.net) continue;
            const vert   = a[0] === b[0];
            const inside = vert
              ? (t.x === a[0] && t.y > Math.min(a[1], b[1]) && t.y < Math.max(a[1], b[1]))
              : (t.y === a[1] && t.x > Math.min(a[0], b[0]) && t.x < Math.max(a[0], b[0]));
            if (!inside) continue;
            const sh = GRID;
            if (vert) {
              const nx = a[0] + (t.d[0] !== 0 ? t.d[0] * sh : sh);
              r.pts.splice(i + 1, 0, [nx, a[1]], [nx, b[1]]);
            } else {
              const ny = a[1] + (t.d[1] !== 0 ? t.d[1] * sh : sh);
              r.pts.splice(i + 1, 0, [a[0], ny], [b[0], ny]);
            }
            changed = true; break;
          }
          if (changed) break;
        }
        if (!changed) break;
      }
    }
  }

  // ── allSegs closure ───────────────────────────────────────────────────────

  const allSegs = (): WSeg[] => {
    const list: WSeg[] = [...wires];
    for (const r of routes) {
      for (let i = 1; i < r.pts.length; i++) {
        list.push([r.pts[i - 1]![0], r.pts[i - 1]![1], r.pts[i]![0], r.pts[i]![1], r.net]);
      }
    }
    return list;
  };

  // ── segTouchesForeign helper ──────────────────────────────────────────────

  const segTouchesForeign = (seg: WSeg, net: string): boolean => {
    for (const w of allSegs()) {
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

  // ── Feedback wiring ───────────────────────────────────────────────────────

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

  // ── Far feedback ─────────────────────────────────────────────────────────

  for (const u of opamps) {
    if (!u.farList) continue;
    const base    = u.fbList ? u.fbList.length : 0;
    const bodyTop = u.origin![1] + 32;
    const xOut    = u.abs![u.outPinIdx!]![0] + 48;
    u.farList.forEach((F, j) => {
      const yF   = bodyTop - 128 - 80 * (base + j);
      const runs = allSegs().filter(w => w[4] === F.upNet && w[1] === w[3] && w[1] > yF);
      runs.sort((a, b) => Math.abs(a[1] - yF) - Math.abs(b[1] - yF));
      const dropClean = (x: number, y: number): boolean =>
        !allSegs().some(w => {
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
        throw new Error(`routeWires far-fb: no clean drop column found for upstream net "${F.upNet}" — all candidate columns blocked by foreign wires. Cannot place far-feedback element ${F.name}`);
      }
      if (xj === null) {
        const o  = comps.find(o => o.inGraph && o.nets.includes(F.upNet!));
        const oi = o ? o.nets.indexOf(F.upNet!) : -1;
        if (o && oi >= 0) {
          const tx = o.tips![oi]![0], ty = o.tips![oi]![1];
          throw new Error(`routeWires far-fb: no horizontal run exists for upstream net "${F.upNet}" — cannot anchor far-feedback element ${F.name} (component ${o.name} at tip ${tx},${ty})`);
        } else {
          throw new Error(`routeWires far-fb: no in-graph component found for upstream net "${F.upNet}" — cannot anchor far-feedback element ${F.name}`);
        }
      }
      const left  = F.rpins[0]![0] < F.rpins[1]![0] ? 0 : 1;
      const right = 1 - left;
      F.origin = [xj - F.rpins[left]![0], yF - F.rpins[left]![1]];
      F.abs    = F.rpins.map(p => [F.origin![0] + p[0], F.origin![1] + p[1]] as Point);
      F.x      = F.origin[0] + F.rbb[0]; F.y = F.origin[1] + F.rbb[1];
      wires.push([xj, yF, xj, yj!, F.upNet!]);
      wires.push([F.abs[right]![0], yF, xOut, yF, u.nets[u.outPinIdx!]!]);
      wires.push([xOut, yF, xOut, u.abs![u.outPinIdx!]![1], u.nets[u.outPinIdx!]!]);
      wires.push([xOut, u.abs![u.outPinIdx!]![1], u.tips![u.outPinIdx!]![0], u.abs![u.outPinIdx!]![1], u.nets[u.outPinIdx!]!]);
    });
  }

  // ── Isolated component placement ──────────────────────────────────────────

  placeIsolated(comps as any, allSegs as any);

  // ── L-simplification ─────────────────────────────────────────────────────

  const bodyRects = (): Array<{ c: WorkComp; r: BBox }> =>
    comps.filter(c => c.origin).map(c => {
      const b = SYMBOLS[c.sym]!.bbox;
      const r = rotBBox(b, c.rot);
      return {
        c,
        r: [
          c.origin![0] + r[0] + 2, c.origin![1] + r[1] + 2,
          c.origin![0] + r[2] - 2, c.origin![1] + r[3] - 2,
        ],
      };
    });

  const flagPinOnNet = (origin: Point, rpins: Point[], sigIdx: number, hangNet: string): boolean => {
    const segs = allSegs().filter(w => w[4] === hangNet);
    return rpins.some((p, i) => {
      if (i === sigIdx) return false;
      const abs: Point = [origin[0] + p[0], origin[1] + p[1]];
      return segs.some(w => ptOnSeg(abs, w));
    });
  };
  void flagPinOnNet; // referenced indirectly below

  function lClean(segs: WSeg[], net: string, allS: WSeg[], rects: Array<{ r: BBox }>): boolean {
    for (const g of segs) {
      for (const { r } of rects) {
        const x1 = Math.min(g[0], g[2]), x2 = Math.max(g[0], g[2]);
        const y1 = Math.min(g[1], g[3]), y2 = Math.max(g[1], g[3]);
        if (!(x2 < r[0] || x1 > r[2] || y2 < r[1] || y1 > r[3])) return false;
      }
      for (const w of allS) {
        if (w[4] === net) continue;
        if (collinearOverlap(g, w)) return false;
        if (ptOnSeg([w[0], w[1]], g) || ptOnSeg([w[2], w[3]], g)) return false;
        if (ptOnSeg([g[0], g[1]], w) || ptOnSeg([g[2], g[3]], w)) return false;
      }
    }
    return true;
  }

  {
    const rects = bodyRects();
    for (const r of routes) {
      if (opts.noLPass) break;
      if (r.pts.length <= 3) continue;
      const P = r.pts[0]!, Q = r.pts[r.pts.length - 1]!;
      const all = allSegs();
      for (const corner of [[P[0], Q[1]], [Q[0], P[1]]] as Point[]) {
        const segs: WSeg[] = [
          [P[0], P[1], corner[0], corner[1]],
          [corner[0], corner[1], Q[0], Q[1]],
        ].filter(g => g[0] !== g[2] || g[1] !== g[3]) as WSeg[];
        if (lClean(segs, r.net, all, rects)) { r.pts = [P, corner, Q]; break; }
      }
    }
    for (const r of routes) {
      for (let i = 1; i < r.pts.length; i++) {
        const p = r.pts[i - 1]!, q = r.pts[i]!;
        if (p[0] !== q[0] || p[1] !== q[1]) wires.push([p[0], p[1], q[0], q[1], r.net]);
      }
    }
  }

  // ── Hang shunt placement ──────────────────────────────────────────────────

  const tipUse = new Map<string, number>();

  for (const c of comps.filter(c => c.isHang)) {
    const bus    = allSegs().filter(w => w[4] === c.hangNet && w[1] === w[3] && Math.abs(w[2] - w[0]) >= GRID);
    const maxRun = bus.reduce((m, w) => Math.max(m, Math.abs(w[2] - w[0])), 0);

    if (!bus.length || maxRun < 48) {
      // no horizontal run: pull-up style
      const o  = comps.find(o => o.inGraph && o.nets.includes(c.hangNet!));
      if (!o) throw new Error(`${c.name}: net ${c.hangNet} has no placed partner`);
      const i      = o.nets.indexOf(c.hangNet!);
      const tip    = o.tips![i]!;
      let dir: Point = o.esc[i] ?? [0, -1];
      if (dir[0] === 0) {
        const vNet = allSegs().filter(w => w[4] === c.hangNet && w[0] === w[2] && w[0] === tip[0]);
        if (vNet.length) {
          const flagApproxY = tip[1] + dir[1] * 96;
          if (vNet.some(w => Math.min(w[1], w[3]) <= flagApproxY && flagApproxY <= Math.max(w[1], w[3])))
            dir = [1, 0];
        }
      }
      const tk = `${tip[0]},${tip[1]}`;
      tipUse.set(tk, (tipUse.get(tk) ?? 0) + 1);
      const k      = tipUse.get(tk)! - 1;
      const sigIdx = c.nets.findIndex(n => n === c.hangNet);
      // choose rotation
      {
        let rotc: RotCode;
        if      (dir[1] === -1) rotc = (sigIdx === 0) ? 'R180' : 'R0';
        else if (dir[1] ===  1) rotc = (sigIdx === 0) ? 'R0'   : 'R180';
        else if (dir[0] ===  1) rotc = (sigIdx === 0) ? 'R270' : 'R90';
        else                    rotc = (sigIdx === 0) ? 'R90'  : 'R270';
        c.rot   = rotc;
        const S = SYMBOLS[c.sym]!;
        c.rpins = S.pins.map(p => rot(p, c.rot));
        c.rbb   = rotBBox(S.bbox, c.rot);
        for (const p of c.rpins) {
          c.rbb[0] = Math.min(c.rbb[0], p[0]); c.rbb[1] = Math.min(c.rbb[1], p[1]);
          c.rbb[2] = Math.max(c.rbb[2], p[0]); c.rbb[3] = Math.max(c.rbb[3], p[1]);
        }
      }
      const usedOrgF = new Set(comps.filter(o2 => o2.origin && o2 !== c)
        .map(o2 => `${o2.origin![0]},${o2.origin![1]}`));
      const landing = (b: Point): string => {
        const pp: Point = [b[0] + dir[0] * GRID, b[1] + dir[1] * GRID];
        return `${pp[0] - c.rpins[sigIdx]![0]},${pp[1] - c.rpins[sigIdx]![1]}`;
      };
      const others = allSegs().filter(w => w[4] !== c.hangNet);
      const bodies = comps.filter(o2 => o2.origin && o2 !== c && o2 !== o).map(o2 => {
        const r = rotBBox(SYMBOLS[o2.sym]!.bbox, o2.rot);
        return [o2.origin![0] + r[0], o2.origin![1] + r[1], o2.origin![0] + r[2], o2.origin![1] + r[3]] as BBox;
      });
      const clean = (b: Point): boolean => {
        const seg: WSeg = [tip[0], tip[1], b[0], b[1]];
        if (others.some(w => segSegTouch(seg, w))) return false;
        if (bodies.some(r => segRectHit(seg, r))) return false;
        if (usedOrgF.has(landing(b))) return false;
        return true;
      };
      let base: Point | null = null;
      let kk = k;
      for (let step = 0; step < 10 && base === null; step++, kk++) {
        if (kk === 0) {
          const b0: Point = [tip[0], tip[1]];
          if (!usedOrgF.has(landing(b0))) base = b0;
          continue;
        }
        const cand: Point[] = [
          [tip[0] - dir[1] * kk * 96, tip[1] + dir[0] * kk * 96],
          [tip[0] + dir[1] * kk * 96, tip[1] - dir[0] * kk * 96],
          [tip[0] + dir[0] * kk * 112, tip[1] + dir[1] * kk * 112],
        ];
        base = cand.find(clean) ?? cand.find(b => !usedOrgF.has(landing(b))) ?? null;
      }
      if (base === null) base = [tip[0], tip[1]];
      const kEff   = (base[0] === tip[0] && base[1] === tip[1]) ? 0 : 1;
      const pinPt: Point = [base[0] + dir[0] * GRID, base[1] + dir[1] * GRID];
      c.origin = [pinPt[0] - c.rpins[sigIdx]![0], pinPt[1] - c.rpins[sigIdx]![1]];
      c.abs    = c.rpins.map(p => [c.origin![0] + p[0], c.origin![1] + p[1]] as Point);
      c.x      = c.origin[0] + c.rbb[0]; c.y = c.origin[1] + c.rbb[1];
      c.flagDir = c.nets.map((n, i2) => i2 === sigIdx ? null : dir as Point);
      if (kEff > 0) wires.push([tip[0], tip[1], base[0], base[1], c.hangNet!]);
      wires.push([base[0], base[1], pinPt[0], pinPt[1], c.hangNet!]);
      continue;
    }

    const sigIdx   = c.nets.findIndex(n => n === c.hangNet);
    const flagIdx2 = c.nets.findIndex(n => isFlag(cls.get(n)));
    const dirSign  = cls.get(c.nets[flagIdx2]!) === 'rail' ? -1 : 1;
    const oxs      = opamps.filter(u => u.origin).map(u => u.origin![0]);

    if (dirSign < 0) {
      c.rot = c.rot === 'R0' ? 'R180' : c.rot === 'R180' ? 'R0' : c.rot;
      const S = SYMBOLS[c.sym]!;
      c.rpins = S.pins.map(p => rot(p, c.rot));
      c.rbb   = rotBBox(S.bbox, c.rot);
      for (const p of c.rpins) {
        c.rbb[0] = Math.min(c.rbb[0], p[0]); c.rbb[1] = Math.min(c.rbb[1], p[1]);
        c.rbb[2] = Math.max(c.rbb[2], p[0]); c.rbb[3] = Math.max(c.rbb[3], p[1]);
      }
      c.flagDir = c.nets.map((n, i2) => i2 === flagIdx2 ? [0, -1] as Point : null);
    }

    const cands: Array<[number, number, WSeg]> = [];
    for (const B of bus) {
      const xl = Math.min(B[0], B[2]), xr = Math.max(B[0], B[2]);
      for (const x of new Set([
        snap((xl + xr) / 2),
        snap(xl + (xr - xl) * 0.25),
        snap(xl + (xr - xl) * 0.75),
        xl + GRID > xr ? xl : xl + GRID,
        xr - GRID < xl ? xr : xr - GRID,
      ])) {
        if (x >= xl && x <= xr) cands.push([x, B[1], B]);
      }
    }
    cands.sort((a, b) => {
      const da = Math.min(...oxs.map(o => Math.abs(a[0] - o)), 1e9);
      const db = Math.min(...oxs.map(o => Math.abs(b[0] - o)), 1e9);
      return db - da;
    });

    const placed = comps.filter(o => o.origin && o !== c);
    let done = false;

    for (const [x, y0, B] of cands) {
      const topPin: Point = [x, y0 + dirSign * GRID];
      const origin: Point = [topPin[0] - c.rpins[sigIdx]![0], topPin[1] - c.rpins[sigIdx]![1]];
      const oy1 = origin[1] + c.rbb[1], oy2 = origin[1] + c.rbb[3];
      const rect: BBox = [
        origin[0] + c.rbb[0] - GRID,
        dirSign > 0 ? y0 + 1 : oy1 - GRID,
        origin[0] + c.rbb[2] + GRID,
        dirSign > 0 ? oy2 + GRID : y0 - 1,
      ];
      const drop: WSeg = [x, y0, x, y0 + dirSign * GRID];
      const fy   = origin[1] + c.rpins[flagIdx2]![1];
      const fpy  = fy;
      const fey  = fpy + dirSign * 32;
      const fpx  = origin[0] + c.rpins[flagIdx2]![0];
      const clash =
        allSegs().some(w =>
          !(w[0] === B[0] && w[1] === B[1] && w[2] === B[2] && w[3] === B[3]) &&
          (segRectHit(w, rect) || segSegTouch(w, drop))
        ) ||
        allSegs().some(w => w[4] === c.hangNet && w[0] === w[2] && w[0] === x &&
          Math.min(w[1], w[3]) <= fy && fy <= Math.max(w[1], w[3])) ||
        allSegs().some(w =>
          w[4] !== c.hangNet && !(w[4] ?? '').startsWith('FLAG:') && ptOnSeg([fpx, fey], w)
        ) ||
        placed.some(o => {
          const R: BBox = [o.origin![0] + o.rbb[0], o.origin![1] + o.rbb[1], o.origin![0] + o.rbb[2], o.origin![1] + o.rbb[3]];
          return !(R[2] < rect[0] || R[0] > rect[2] || R[3] < rect[1] || R[1] > rect[3]);
        });
      if (clash) continue;
      c.origin = origin;
      c.abs    = c.rpins.map(p => [origin[0] + p[0], origin[1] + p[1]] as Point);
      c.x      = origin[0] + c.rbb[0]; c.y = origin[1] + c.rbb[1];
      wires.push([x, y0, x, y0 + dirSign * GRID, c.hangNet!]);
      done = true; break;
    }

    if (!done) {
      const usedOrg = new Set(comps.filter(o => o.origin && o !== c).map(o => `${o.origin![0]},${o.origin![1]}`));
      const ext: Array<[number, number, WSeg]> = [...cands];
      for (const B of bus) {
        const xl = Math.min(B[0], B[2]), xr = Math.max(B[0], B[2]);
        for (let x = xl; x <= xr; x += 6 * GRID) ext.push([x, B[1], B]);
      }
      let pick: [number, number, Point] | null = null;
      for (const [x, y0] of ext) {
        const tp: Point  = [x, y0 + dirSign * GRID];
        const org: Point = [tp[0] - c.rpins[sigIdx]![0], tp[1] - c.rpins[sigIdx]![1]];
        if (!usedOrg.has(`${org[0]},${org[1]}`)) {
          const fy2  = org[1] + c.rpins[flagIdx2]![1];
          const fey2 = fy2 + dirSign * 32;
          const fpx2 = org[0] + c.rpins[flagIdx2]![0];
          const vertOk = !allSegs().some(w =>
            w[4] === c.hangNet && w[0] === w[2] && w[0] === x &&
            Math.min(w[1], w[3]) <= fy2 && fy2 <= Math.max(w[1], w[3])
          );
          const flagOk = !allSegs().some(w =>
            w[4] !== c.hangNet && !(w[4] ?? '').startsWith('FLAG:') && ptOnSeg([fpx2, fey2], w)
          );
          if (vertOk && flagOk) { pick = [x, y0, org]; break; }
        }
      }
      if (!pick) {
        const [x, y0] = cands[0]!;
        const tp: Point = [x, y0 + dirSign * GRID];
        pick = [x, y0, [tp[0] - c.rpins[sigIdx]![0], tp[1] - c.rpins[sigIdx]![1]]];
      }
      const [x, y0, org] = pick;
      c.origin = org;
      c.abs    = c.rpins.map(p => [c.origin![0] + p[0], c.origin![1] + p[1]] as Point);
      c.x      = c.origin[0] + c.rbb[0]; c.y = c.origin[1] + c.rbb[1];
      wires.push([x, y0, x, y0 + dirSign * GRID, c.hangNet!]);
    }
  }

  // ── Cross-net contact guard ───────────────────────────────────────────────

  {
    const isV    = (w: WSeg): boolean => w[0] === w[2];
    const inInt  = (x: number, y: number, w: WSeg): boolean => {
      if ((x === w[0] && y === w[1]) || (x === w[2] && y === w[3])) return false;
      if (isV(w)) return x === w[0] && y > Math.min(w[1], w[3]) && y < Math.max(w[1], w[3]);
      if (w[1] === w[3]) return y === w[1] && x > Math.min(w[0], w[2]) && x < Math.max(w[0], w[2]);
      return false;
    };
    const colOverlap = (a: WSeg, b: WSeg): WSeg | null => {
      if (isV(a) && isV(b) && a[0] === b[0]) {
        const lo = Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3]));
        const hi = Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3]));
        if (lo < hi) return [a[0], lo, a[0], hi];
      }
      if (!isV(a) && !isV(b) && a[1] === b[1] && a[1] === b[3]) {
        const lo = Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2]));
        const hi = Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2]));
        if (lo < hi) return [lo, a[1], hi, a[1]];
      }
      return null;
    };
    const anyContact = (seg: WSeg, net: string): boolean =>
      wires.some(w => {
        if ((w[4] ?? '') === net) return false;
        if (colOverlap(seg, w)) return true;
        if (inInt(w[0], w[1], seg) || inInt(w[2], w[3], seg)) return true;
        if (inInt(seg[0], seg[1], w) || inInt(seg[2], seg[3], w)) return true;
        return false;
      });

    const bump = (idx: number, lo: number, hi: number, off: number): boolean => {
      const w   = wires[idx]!;
      const net = w[4] ?? '';
      const m   = GRID;
      if (isV(w)) {
        const x  = w[0], y1 = Math.min(w[1], w[3]), y2 = Math.max(w[1], w[3]);
        const a  = Math.max(y1, lo - m), b = Math.min(y2, hi + m);
        const nx = x + off;
        const parts: WSeg[] = [[x, y1, x, a, net], [x, a, nx, a, net], [nx, a, nx, b, net], [nx, b, x, b, net], [x, b, x, y2, net]];
        if (!parts.slice(1, 4).every(g => !anyContact(g, net))) return false;
        wires.splice(idx, 1, ...parts.filter(g => g[0] !== g[2] || g[1] !== g[3]));
        return true;
      } else {
        const y  = w[1], x1 = Math.min(w[0], w[2]), x2 = Math.max(w[0], w[2]);
        const a  = Math.max(x1, lo - m), b = Math.min(x2, hi + m);
        const ny = y + off;
        const parts: WSeg[] = [[x1, y, a, y, net], [a, y, a, ny, net], [a, ny, b, ny, net], [b, ny, b, y, net], [b, y, x2, y, net]];
        if (!parts.slice(1, 4).every(g => !anyContact(g, net))) return false;
        wires.splice(idx, 1, ...parts.filter(g => g[0] !== g[2] || g[1] !== g[3]));
        return true;
      }
    };

    for (let round = 0; round < 24; round++) {
      let fixed = false;
      outer:
      for (let i = 0; i < wires.length; i++) {
        for (let j = 0; j < wires.length; j++) {
          if (i === j) continue;
          const A = wires[i]!, B = wires[j]!;
          const ka = A[4] ?? '', kb = B[4] ?? '';
          if (ka === kb || !ka || !kb) continue;
          const ov = colOverlap(A, B);
          let lo: number, hi: number;
          const vert = isV(A);
          if (ov) { lo = vert ? ov[1] : ov[0]; hi = vert ? ov[3] : ov[2]; }
          else {
            let pt: [number, number] | null = null;
            if (inInt(B[0], B[1], A)) pt = [B[0], B[1]];
            else if (inInt(B[2], B[3], A)) pt = [B[2], B[3]];
            if (!pt) continue;
            lo = hi = vert ? pt[1] : pt[0];
          }
          for (const off of [GRID, -GRID, 2 * GRID, -2 * GRID, 3 * GRID, -3 * GRID]) {
            if (bump(i, lo, hi, off)) { fixed = true; break outer; }
          }
          {
            const vert2 = isV(B);
            let lo2 = lo, hi2 = hi;
            if (!ov) {
              let pt: [number, number] | null = null;
              if (inInt(A[0], A[1], B)) pt = [A[0], A[1]];
              else if (inInt(A[2], A[3], B)) pt = [A[2], A[3]];
              if (pt) { lo2 = hi2 = vert2 ? pt[1] : pt[0]; }
              else {
                lo2 = vert2 ? Math.min(B[1], B[3]) : Math.min(B[0], B[2]);
                hi2 = vert2 ? Math.max(B[1], B[3]) : Math.max(B[0], B[2]);
              }
            }
            for (const off of [GRID, -GRID, 2 * GRID, -2 * GRID, 3 * GRID, -3 * GRID]) {
              if (bump(j, lo2, hi2, off)) { fixed = true; break outer; }
            }
          }
        }
      }
      if (!fixed) break;
    }
  }

  // ── Flag direction fix-up and emission ────────────────────────────────────

  fixFlagDirs(comps as any, allSegs as any, cls);
  const flags: FlagEntry[] = [];
  emitFlags(comps as any, wires as any, flags, cls);

  return { wires: wires as WireSegment[], flags };
}
