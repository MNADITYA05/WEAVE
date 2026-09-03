/**
 * geometry.ts — Geometry primitives
 *
 * GRID, rotation, snap, bounding-box helpers used throughout the codebase.
 * All coordinates are in LTspice grid units (multiples of GRID = 16).
 * Y-axis increases downward, matching LTspice's coordinate system.
 */

import type { Point, BBox, RotCode } from '../types.js';

/** LTspice schematic grid size in pixels/units. All coordinates are multiples of this. */
export const GRID = 16 as const;

/**
 * Rotate a point by a LTspice rotation code.
 *
 * LTspice rotation semantics:
 *   - M prefix: mirror x → x becomes -x first
 *   - Rk suffix: rotate by k degrees counter-clockwise
 *
 * @param point - [x, y] in symbol-local coordinates
 * @param code  - LTspice rotation string e.g. 'R0', 'R90', 'MR180'
 * @returns Rotated [x, y]
 */
export function rot([x, y]: Point, code: RotCode): Point {
  let rx = x;
  if (code[0] === 'M') rx = -rx;
  const k = parseInt(code.slice(1), 10);
  if (k === 0)   return [rx, y];
  if (k === 90)  return [-y, rx];
  if (k === 180) return [-rx, -y];
  if (k === 270) return [y, -rx];
  throw new Error(`rot: invalid rotation code "${code}"`);
}

/**
 * Rotate a bounding box by a LTspice rotation code.
 * Returns the axis-aligned bounding box of the rotated rectangle.
 *
 * @param b    - [left, top, right, bottom] in local coords
 * @param code - LTspice rotation string
 * @returns Rotated [left, top, right, bottom]
 */
export function rotBBox(b: BBox, code: RotCode): BBox {
  const p1 = rot([b[0], b[1]], code);
  const p2 = rot([b[2], b[3]], code);
  return [
    Math.min(p1[0], p2[0]),
    Math.min(p1[1], p2[1]),
    Math.max(p1[0], p2[0]),
    Math.max(p1[1], p2[1]),
  ];
}

/**
 * Snap a value to the nearest GRID boundary.
 *
 * @param v - Raw coordinate value
 * @returns Snapped value
 */
export const snap = (v: number): number => Math.round(v / GRID) * GRID;

/**
 * SVG transformation matrix strings for each LTspice rotation code.
 * Format: matrix(a, b, c, d, 0, 0) in column-major order: x' = ax + cy, y' = bx + dy
 */
export const ROT_MAT: Readonly<Record<RotCode, readonly [number, number, number, number]>> = {
  R0:    [ 1,  0,  0,  1],
  R90:   [ 0,  1, -1,  0],
  R180:  [-1,  0,  0, -1],
  R270:  [ 0, -1,  1,  0],
  MR0:   [-1,  0,  0,  1],
  MR90:  [ 0,  1,  1,  0],
  MR180: [ 1,  0,  0, -1],
  MR270: [ 0, -1, -1,  0],
} as const;

/**
 * Build an SVG matrix() transform string for the given rotation code.
 *
 * @param rotCode - LTspice rotation string
 * @returns SVG matrix() string
 */
export function svgMat(rotCode: RotCode): string {
  const m = ROT_MAT[rotCode] ?? ROT_MAT['R0'];
  return `matrix(${m[0]},${m[1]},${m[2]},${m[3]},0,0)`;
}

/** @deprecated Use svgMat() — this alias exists for backward compatibility during migration. */
export const _svgMat = svgMat;

// ─── Shared connectivity helpers ──────────────────────────────────────────────

/**
 * Canonical point-to-string key used for all coordinate maps and sets.
 *
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns String key in the form "x,y"
 */
export const ptKey = (x: number, y: number): string => `${x},${y}`;

/**
 * Returns true when the point (px, py) lies on the axis-aligned segment
 * defined by (x1, y1)–(x2, y2), endpoints inclusive.
 *
 * Only horizontal and vertical segments are supported (diagonal → false).
 *
 * @param px - Point x
 * @param py - Point y
 * @param x1 - Segment start x
 * @param y1 - Segment start y
 * @param x2 - Segment end x
 * @param y2 - Segment end y
 */
export function onSeg(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): boolean {
  if (x1 === x2) return px === x1 && py >= Math.min(y1, y2) && py <= Math.max(y1, y2);
  if (y1 === y2) return py === y1 && px >= Math.min(x1, x2) && px <= Math.max(x1, x2);
  return false;
}
