'use strict';
import { GRID, snap } from '../shared/geometry.js';
// ── place-isolated.js — supply-corner placement ───────────────────────────
// Places components whose every net is a flag (e.g. V1 vcc 0 12) in a
// single vertical column to the RIGHT of the main schematic extent.
// Reads: comps, existing wires+routes (via allSegs)
// Writes: c.origin, c.abs, c.x, c.y on each isolated component

export function placeIsolated(comps, allSegs) {
  // Compute right edge and vertical midpoint of main extent
  let minY=1e9, maxY=-1e9, maxX=-1e9;
  for (const c of comps.filter(c=>c.origin)){
    maxX=Math.max(maxX, c.origin[0]+c.rbb[2]);
    minY=Math.min(minY, c.origin[1]+c.rbb[1]);
    maxY=Math.max(maxY, c.origin[1]+c.rbb[3]);
  }
  for (const w of allSegs()){
    maxX=Math.max(maxX,w[0],w[2]);
    minY=Math.min(minY,w[1],w[3]);
    maxY=Math.max(maxY,w[1],w[3]);
  }
  if (maxX<0) maxX=0;
  if (minY>maxY){ minY=0; maxY=200; }
  const midY = snap((minY+maxY)/2);

  const isolated = comps.filter(c=>!c.inGraph && !c.isFb && !c.isLeg && !c.isHang && !c.isFar);

  // Dynamic startX: right edge of main circuit + widest isolated body overhang + 4-grid clearance
  const maxIsoLeftOvhg = isolated.reduce((m,c)=>Math.max(m,-c.rbb[0]),0);
  const startX = snap(maxX + GRID*4 + maxIsoLeftOvhg);

  // Dynamic GAP: GRID*2 of breathing room between components
  const GAP = GRID * 2;
  const totalH = isolated.reduce((s,c)=>s+(c.rbb[3]-c.rbb[1]),0)
                 + Math.max(0, isolated.length-1)*GAP;
  let curY = snap(midY - totalH/2);

  for (const c of isolated){
    c.origin = [startX, snap(curY - c.rbb[1])];
    c.abs = c.rpins.map(p=>[c.origin[0]+p[0], c.origin[1]+p[1]]);
    c.x = c.origin[0]+c.rbb[0];
    c.y = c.origin[1]+c.rbb[1];
    curY += (c.rbb[3]-c.rbb[1]) + GAP;
  }
}
