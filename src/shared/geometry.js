'use strict';
// ── Geometry primitives ───────────────────────────────────────────────────
// GRID, rotation, snap, bounding-box helpers used throughout the codebase.

export const GRID = 16;

// LTspice rotation: M applies x -> -x first, then Rk rotates by k deg
export function rot([x,y], code){
  if (code[0]==='M') x = -x;
  const k = parseInt(code.slice(1),10);
  if (k===0)   return [x,y];
  if (k===90)  return [-y,x];
  if (k===180) return [-x,-y];
  if (k===270) return [y,-x];
  throw new Error('bad rot '+code);
}

export function rotBBox(b, code){
  const p1 = rot([b[0],b[1]],code), p2 = rot([b[2],b[3]],code);
  return [Math.min(p1[0],p2[0]),Math.min(p1[1],p2[1]),Math.max(p1[0],p2[0]),Math.max(p1[1],p2[1])];
}

export const snap = v => Math.round(v/GRID)*GRID;

// LTspice rotation → SVG matrix(a,b,c,d,0,0)  (col-major: x'=ax+cy, y'=bx+dy)
export const ROT_MAT = {
  'R0':   [1,0,0,1],
  'R90':  [0,1,-1,0],
  'R180': [-1,0,0,-1],
  'R270': [0,-1,1,0],
  'MR0':  [-1,0,0,1],
  'MR90': [0,1,1,0],
  'MR180':[1,0,0,-1],
  'MR270':[0,-1,-1,0],
};

export function _svgMat(rot) {
  const m = ROT_MAT[rot] || ROT_MAT['R0'];
  return `matrix(${m[0]},${m[1]},${m[2]},${m[3]},0,0)`;
}
