'use strict';
// ── route-helpers.js — pure geometry utilities for the wire router ────────
// All functions here are stateless: they take their inputs as parameters and
// return results without reading or writing any module-level state.

// Does an orthogonal wire segment [ax,ay,bx,by] hit a rect [x1,y1,x2,y2]?
export function segRectHit(w, r){
  const [ax,ay,bx,by] = w;
  const x1=Math.min(ax,bx), x2=Math.max(ax,bx), y1=Math.min(ay,by), y2=Math.max(ay,by);
  return !(x2<r[0] || x1>r[2] || y2<r[1] || y1>r[3]);
}

// Do two orthogonal segments share any point (including endpoints)?
export function segSegTouch(a, b){
  const ax1=Math.min(a[0],a[2]), ax2=Math.max(a[0],a[2]);
  const ay1=Math.min(a[1],a[3]), ay2=Math.max(a[1],a[3]);
  const bx1=Math.min(b[0],b[2]), bx2=Math.max(b[0],b[2]);
  const by1=Math.min(b[1],b[3]), by2=Math.max(b[1],b[3]);
  return !(ax2<bx1 || ax1>bx2 || ay2<by1 || ay1>by2);
}

// Is point p strictly on the interior of orthogonal segment w (not at endpoints)?
export function ptOnSeg(p, w){
  if (w[0]===w[2]) return p[0]===w[0] && p[1]>Math.min(w[1],w[3]) && p[1]<Math.max(w[1],w[3]);
  if (w[1]===w[3]) return p[1]===w[1] && p[0]>Math.min(w[0],w[2]) && p[0]<Math.max(w[0],w[2]);
  return false;
}

// Does point p lie anywhere on segment w (including endpoints)?
export function ptOnSegInclusive(p, w){
  if (w[0]===w[2]) return p[0]===w[0] && p[1]>=Math.min(w[1],w[3]) && p[1]<=Math.max(w[1],w[3]);
  if (w[1]===w[3]) return p[1]===w[1] && p[0]>=Math.min(w[0],w[2]) && p[0]<=Math.max(w[0],w[2]);
  return false;
}

// Do two collinear orthogonal segments overlap (strictly — not just touching at endpoints)?
export function collinearOverlap(a, b){
  if (a[0]===a[2] && b[0]===b[2] && a[0]===b[0])
    return Math.max(Math.min(a[1],a[3]),Math.min(b[1],b[3])) < Math.min(Math.max(a[1],a[3]),Math.max(b[1],b[3]));
  if (a[1]===a[3] && b[1]===b[3] && a[1]===b[1])
    return Math.max(Math.min(a[0],a[2]),Math.min(b[0],b[2])) < Math.min(Math.max(a[0],a[2]),Math.max(b[0],b[2]));
  return false;
}

// Is segment isV (vertical)?
export const isVert = w => w[0]===w[2];

// Adjust endpoint pts[idx] toward target so the adjacent segment stays orthogonal.
export function fixEnd(pts, idx, target){
  if (!target) return;
  const other = idx===0 ? 1 : pts.length-2;
  const p = pts[idx];
  if (pts.length>=2){
    const q = pts[other];
    if (q[1]===p[1]) q[1]=target[1]; else if (q[0]===p[0]) q[0]=target[0];
  }
  pts[idx]=[target[0],target[1]];
}

// Can a proposed L-bend (segs) be placed without hitting any body rect or
// colliding with a wire from a different net?
export function lClean(segs, net, allWires, rects){
  for (const g of segs){
    for (const {r} of rects){
      const x1=Math.min(g[0],g[2]),x2=Math.max(g[0],g[2]),y1=Math.min(g[1],g[3]),y2=Math.max(g[1],g[3]);
      if (!(x2<r[0]||x1>r[2]||y2<r[1]||y1>r[3])) return false;
    }
    for (const w of allWires){
      if (w[4]===net) continue;
      if (collinearOverlap(g,w)) return false;
      if (ptOnSeg([w[0],w[1]],g) || ptOnSeg([w[2],w[3]],g)) return false;
      if (ptOnSeg([g[0],g[1]],w) || ptOnSeg([g[2],g[3]],w)) return false;
    }
  }
  return true;
}
