/**
 * route-types.ts — Shared types and pure geometry helpers for the routing stage.
 *
 * Consumed by: direct-connector.ts, bridge-resolver.ts,
 *              feedback-placer.ts, flag-placer.ts, router.ts
 */

import type { Point, BBox, RotCode } from '../types.js';

// ─── WorkComp ────────────────────────────────────────────────────────────────
//
// During routing the algorithm mutates origin/abs/rot/rpins/rbb on off-graph
// components. The types.ts interfaces are immutable, so we use a local mutable
// alias and cast at the public boundary.

export interface WorkComp {
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
  // Mutable geometry (set by applyLayout or routeWires for off-graph comps)
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

// ─── Routing data structures ──────────────────────────────────────────────────

/** Routing options. */
export interface RouteOpts {
  noLPass?: boolean;
}

/** A wire segment: [x1, y1, x2, y2, netName?] */
export type WSeg = [number, number, number, number, string?];

/** An ELK route in progress: a net name plus its point sequence. */
export interface Route {
  net: string;
  pts: Point[];
}

/** Geometry collected for one local-feedback element, used by wireFeedback(). */
export interface FbJob {
  F:      WorkComp;
  u:      WorkComp;
  yF:     number;
  left:   number;
  right:  number;
  inPin:  Point;
  inTip:  Point;
  outTip: Point;
}

/** A stub tip with its escape direction, used by deconflictTips(). */
export interface TipPt {
  x:   number;
  y:   number;
  net: string;
  d:   Point;
}

// ─── Pure geometry helpers ────────────────────────────────────────────────────

export function ptOnSeg(p: Point, w: WSeg): boolean {
  if (w[0] === w[2]) return p[0] === w[0] && p[1] >= Math.min(w[1], w[3]) && p[1] <= Math.max(w[1], w[3]);
  if (w[1] === w[3]) return p[1] === w[1] && p[0] >= Math.min(w[0], w[2]) && p[0] <= Math.max(w[0], w[2]);
  return false;
}

export function segRectHit(w: WSeg, r: BBox): boolean {
  const [ax, ay, bx, by] = w;
  const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx);
  const y1 = Math.min(ay, by), y2 = Math.max(ay, by);
  return !(x2 < r[0] || x1 > r[2] || y2 < r[1] || y1 > r[3]);
}

export function segSegTouch(a: WSeg, b: WSeg): boolean {
  const ax1 = Math.min(a[0], a[2]), ax2 = Math.max(a[0], a[2]);
  const ay1 = Math.min(a[1], a[3]), ay2 = Math.max(a[1], a[3]);
  const bx1 = Math.min(b[0], b[2]), bx2 = Math.max(b[0], b[2]);
  const by1 = Math.min(b[1], b[3]), by2 = Math.max(b[1], b[3]);
  return !(ax2 < bx1 || ax1 > bx2 || ay2 < by1 || ay1 > by2);
}

export function fixEnd(pts: Point[], idx: number, target: Point | undefined): void {
  if (!target) return;
  const other = idx === 0 ? 1 : pts.length - 2;
  const p = pts[idx]!;
  if (pts.length >= 2) {
    const q = pts[other]!;
    if (q[1] === p[1]) q[1] = target[1]; else if (q[0] === p[0]) q[0] = target[0];
  }
  pts[idx] = [target[0], target[1]];
}

export function collinearOverlap(a: WSeg, b: WSeg): boolean {
  if (a[0] === a[2] && b[0] === b[2] && a[0] === b[0])
    return Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3])) < Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3]));
  if (a[1] === a[3] && b[1] === b[3] && a[1] === b[1])
    return Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2])) < Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2]));
  return false;
}

/**
 * Returns all currently known wire segments, combining committed wires and
 * in-progress routes. Called as a snapshot — not a live view.
 */
export function allSegs(wires: WSeg[], routes: Route[]): WSeg[] {
  const list: WSeg[] = [...wires];
  for (const r of routes) {
    for (let i = 1; i < r.pts.length; i++) {
      list.push([r.pts[i - 1]![0], r.pts[i - 1]![1], r.pts[i]![0], r.pts[i]![1], r.net]);
    }
  }
  return list;
}
