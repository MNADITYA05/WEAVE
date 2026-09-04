/**
 * direct-connector.ts — ELK edge routing helpers for router.ts.
 *
 * Exported functions:
 *   buildPortAbs    — collect tip positions + emit escape stubs
 *   routeElkEdges   — convert ELK sections → Route[] polylines
 *   deconflictTips  — nudge routes around foreign stub tips
 *   simplifyAndFlush — L-simplify routes, flush into wires[]
 */

import { GRID, snap, rotBBox } from '../shared/geometry.js';
import { SYMBOLS } from './symbols.js';
import type { Point, BBox, ElkEdge } from '../types.js';
import {
  type WorkComp, type WSeg, type Route, type RouteOpts,
  collinearOverlap, ptOnSeg, fixEnd,
} from './route-types.js';

// ─── buildPortAbs ─────────────────────────────────────────────────────────────

/**
 * Maps every in-graph component pin to its absolute tip position.
 * Also emits escape stub wires (tagged by net) into `wires`.
 */
export function buildPortAbs(
  comps:  WorkComp[],
  portId: (c: WorkComp, i: number) => string,
  wires:  WSeg[],
): Map<string, Point> {
  const portAbs = new Map<string, Point>();
  for (const c of comps.filter(c => c.inGraph)) {
    c.tips!.forEach((p, i) => portAbs.set(portId(c, i), p));
    c.esc.forEach((d, i) => {
      if (d) wires.push([c.abs![i]![0], c.abs![i]![1], c.tips![i]![0], c.tips![i]![1], c.nets[i]!]);
    });
  }
  return portAbs;
}

// ─── routeElkEdges ────────────────────────────────────────────────────────────

/**
 * Converts ELK output edges (with routing sections) into Route[] polylines.
 * Fixes endpoints to portAbs positions, inserts missing corners, orthogonalises.
 */
export function routeElkEdges(
  elkEdges: ElkEdge[],
  portAbs:  Map<string, Point>,
): Route[] {
  const routes: Route[] = [];
  for (const e of (elkEdges ?? [])) {
    for (const s of (e.sections ?? [])) {
      let pts: Point[] = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]
        .map(p => [snap(p.x), snap(p.y)]);
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
  return routes;
}

// ─── deconflictTips ───────────────────────────────────────────────────────────

/**
 * For each route, nudges segments that pass through a foreign stub tip
 * sideways by one GRID to avoid T-junctions with a different net.
 */
export function deconflictTips(comps: WorkComp[], routes: Route[]): void {
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

// ─── simplifyAndFlush ─────────────────────────────────────────────────────────

function bodyRects(comps: WorkComp[]): Array<{ r: BBox }> {
  return comps.filter(c => c.origin).map(c => {
    const b = SYMBOLS[c.sym]!.bbox;
    const r = rotBBox(b, c.rot);
    return {
      r: [
        c.origin![0] + r[0] + 2, c.origin![1] + r[1] + 2,
        c.origin![0] + r[2] - 2, c.origin![1] + r[3] - 2,
      ] as BBox,
    };
  });
}

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

/**
 * Attempts to simplify each route to a single L-bend, then flushes all
 * routes into the committed `wires` array.
 */
export function simplifyAndFlush(
  comps:    WorkComp[],
  routes:   Route[],
  wires:    WSeg[],
  opts:     RouteOpts,
  allSegsF: () => WSeg[],
): void {
  const rects = bodyRects(comps);
  for (const r of routes) {
    if (opts.noLPass) break;
    if (r.pts.length <= 3) continue;
    const P = r.pts[0]!, Q = r.pts[r.pts.length - 1]!;
    const all = allSegsF();
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
