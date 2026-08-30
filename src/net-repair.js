'use strict';
import { isFlag, railLabel } from './classifier.js';
// ── Net repair: connectivity repair ──────────────────────────────────────
// Called after routeWires, before emitAsc.
// For every gnd/rail pin that has no wire touching it (router missed it),
// inserts a 32-unit stub wire and a FLAG symbol in the best escape direction.

export function repairNets(comps, wires, flags, cls) {
  function ptOnSeg(p, w) {
    const [x1,y1,x2,y2] = w;
    if (x1===x2) return p[0]===x1 && p[1]>=Math.min(y1,y2) && p[1]<=Math.max(y1,y2);
    if (y1===y2) return p[1]===y1 && p[0]>=Math.min(x1,x2) && p[0]<=Math.max(x1,x2);
    return false;
  }

  const endpoints = new Set();
  for (const w of wires) {
    endpoints.add(w[0]+','+w[1]);
    endpoints.add(w[2]+','+w[3]);
  }

  for (const c of comps) {
    if (!c.abs) continue;
    c.nets.forEach((n, i) => {
      const t = cls.get(n);
      if (t !== 'gnd' && t !== 'rail') return;
      const [px, py] = c.abs[i];
      const pinKey = px+','+py;
      if (endpoints.has(pinKey)) return;
      if (wires.some(w => ptOnSeg([px,py], w))) return;
      const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
      const label = t === 'gnd' ? '0' : (typeof railLabel === 'function' ? railLabel(n, comps) : n);
      for (const [dx, dy] of dirs) {
        const ex = px + dx*32, ey = py + dy*32;
        const endKey = ex+','+ey;
        const endClear = !wires.some(w => {
          if ((w[4]||'').startsWith('FLAG:')) return false;
          return ptOnSeg([ex,ey], w);
        });
        if (endClear) {
          wires.push([px, py, ex, ey, 'FLAG:'+label]);
          flags.push([ex, ey, label]);
          endpoints.add(pinKey);
          endpoints.add(endKey);
          break;
        }
      }
    });
  }
}
