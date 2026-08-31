'use strict';
import { GRID, rot, rotBBox } from '../shared/geometry.js';
import { SYMBOLS } from './symbols.js';
import { isFlag } from './classifier.js';
// ---------- orientation ----------
export function netDepths(comps, cls){
  // BFS over signal nets starting from source outputs
  const adj = new Map(); // net -> Set(net) via shared component
  const add=(a,b)=>{ if(!adj.has(a)) adj.set(a,new Set()); adj.get(a).add(b); };
  for (const c of comps){
    const sig = c.nets.filter(n=>cls.get(n)==='signal');
    for (const a of sig) for (const b of sig) if (a!==b){ add(a,b); }
  }
  const depth = new Map(); const q=[];
  for (const c of comps){
    if (c.sym==='voltage'||c.sym==='current'){
      for (const n of c.nets) if (cls.get(n)==='signal' && !depth.has(n)){ depth.set(n,0); q.push(n); }
    }
  }
  while(q.length){
    const n=q.shift();
    for (const m of (adj.get(n)||[])) if (!depth.has(m)){ depth.set(m, depth.get(n)+1); q.push(m); }
  }
  return depth;
}

// opamp-like: 5 pins, SpiceOrder 1-2 on the left edge, 5 on the right edge
// (matches LTspice opamps and comparators: In+ In- V+ V- OUT)
export function detectOp(pins){
  if (!pins || pins.length < 3) return false;
  const xs = pins.map(p => p[0]);
  const mn = Math.min(...xs), mx = Math.max(...xs);
  const leftPins  = pins.filter(p => p[0] === mn);
  const rightPins = pins.filter(p => p[0] === mx);
  return leftPins.length >= 1 && rightPins.length === 1 && mn < mx;
}

export const NOROT = (typeof process!=='undefined') && !!process.env.WEAVE_NOROT;

export function chooseRotation(c, cls, depth){
  if (NOROT) return 'R0';
  if (c.isOp) return 'R0';
  if (c.sym==='voltage' || c.sym==='current') return 'R0'; // vertical, + on top
  if (c.nets.length>2) return 'R0';                        // multi-pin X blocks
  const [tA,tB] = c.nets.map(n=>cls.get(n));
  if (isFlag(tB) && !isFlag(tA)) return 'R0';    // pin1 top signal, pin2 bottom to flag
  if (isFlag(tA) && !isFlag(tB)) return 'R180';  // flip so flag pin is at bottom
  if (isFlag(tA) && isFlag(tB))  return 'R0';    // both flags (rail decoupling etc.)
  // series element: horizontal, lower-depth net on the left
  const dA = depth.get(c.nets[0]) ?? depth.get(c.nets[1]) ?? 99;
  const dB = depth.get(c.nets[1]) ?? depth.get(c.nets[0]) ?? 99;
  // R270: pin1 -> (y,-x). res pin1 (16,16)->(16,-16), pin2 (16,96)->(96,-16): pin1 LEFT
  // R90 : pin1 -> (-16,16), pin2 -> (-96,16): pin1 RIGHT
  return (dA <= dB) ? 'R270' : 'R90';
}

// >>> decorateComponents — extracted from convert.js
export function decorateComponents(comps, cls, depth){
  for (const c of comps){
    if (!SYMBOLS[c.sym]) throw new Error('no symbol for '+c.name);
    c.isOp = detectOp(SYMBOLS[c.sym].pins);
    if (c.isOp) {
      const xs = SYMBOLS[c.sym].pins.map(p => p[0]);
      const mx = Math.max(...xs);
      c.outPinIdx = SYMBOLS[c.sym].pins.findIndex(p => p[0] === mx);
    }
    c.rot = chooseRotation(c, cls, depth);
    const S = SYMBOLS[c.sym];
    c.rpins = S.pins.map(p => rot(p, c.rot));
    c.rbb = rotBBox(S.bbox, c.rot);
    for (const p of c.rpins){
      c.rbb[0]=Math.min(c.rbb[0],p[0]); c.rbb[1]=Math.min(c.rbb[1],p[1]);
      c.rbb[2]=Math.max(c.rbb[2],p[0]); c.rbb[3]=Math.max(c.rbb[3],p[1]);
    }
    const cx=(c.rbb[0]+c.rbb[2])/2, cy=(c.rbb[1]+c.rbb[3])/2;
    const bodyBox=[c.rbb[0],c.rbb[1],c.rbb[2],c.rbb[3]];
    const big = c.rpins.length>5;
    const pinDir=(px,py)=>{
      if (SYMBOLS[c.sym] && SYMBOLS[c.sym].synthetic)
        return [px<0?-1:1, 0];
      if (!big){
        const dx=px-cx, dy=py-cy;
        return (Math.abs(dy)>=Math.abs(dx)) ? [0,Math.sign(dy||1)] : [Math.sign(dx),0];
      }
      const dl=px-bodyBox[0], dr=bodyBox[2]-px, dt=py-bodyBox[1], db=bodyBox[3]-py;
      const m=Math.min(dl,dr,dt,db);
      const tied3=[];
      if(m===dr) tied3.push([1,0]);
      if(m===dl) tied3.push([-1,0]);
      if(m===dt) tied3.push([0,-1]);
      if(m===db) tied3.push([0,1]);
      const horiz3=tied3.filter(d=>d[1]===0);
      return (horiz3.length ? horiz3 : tied3)[0];
    };
    c.flagDir = c.nets.map((n,i)=>{
      if (!isFlag(cls.get(n))) return null;
      return pinDir(c.rpins[i][0], c.rpins[i][1]);
    });
    c.flagDir.forEach((d,i)=>{
      if (!d) return;
      const RES = d[0]!==0 ? 80 : 48;
      const [px,py]=c.rpins[i];
      c.rbb[0]=Math.min(c.rbb[0],px+d[0]*RES); c.rbb[1]=Math.min(c.rbb[1],py+d[1]*RES);
      c.rbb[2]=Math.max(c.rbb[2],px+d[0]*RES); c.rbb[3]=Math.max(c.rbb[3],py+d[1]*RES);
    });
    c.esc = c.nets.map((n,i)=>{
      if (cls.get(n)!=='signal') return null;
      if (c.sym==='voltage' || c.sym==='current') return [1,0];
      const dir = pinDir(c.rpins[i][0], c.rpins[i][1]);
      const [px,py] = c.rpins[i];
      const collinear = c.nets.some((fn,fi)=>{
        if (fi===i || !isFlag(cls.get(fn))) return false;
        const [fx,fy] = c.rpins[fi];
        return dir[0]===0 ? fx===px : fy===py;
      });
      if (collinear) return [1,0];
      return dir;
    });
    c.rtips = c.rpins.map((p,i)=> c.esc[i] ? [p[0]+c.esc[i][0]*GRID, p[1]+c.esc[i][1]*GRID] : p);
    c.esc.forEach((d,i)=>{
      if (!d) return;
      const [tx,ty]=c.rtips[i];
      c.rbb[0]=Math.min(c.rbb[0],tx); c.rbb[1]=Math.min(c.rbb[1],ty);
      c.rbb[2]=Math.max(c.rbb[2],tx); c.rbb[3]=Math.max(c.rbb[3],ty);
    });
    c.inGraph = c.nets.some(n => cls.get(n)==='signal');
  }
}
// <<< decorateComponents
