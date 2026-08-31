'use strict';
import { rot } from '../shared/geometry.js';
import { SYMBOLS } from './symbols.js';
import { parseNetlist } from './netlist-parser.js';
import { classifyNets, isFlag, railLabel } from './classifier.js';
export function parseAsc(text){
  const wires=[], flags=[], syms=[];
  let cur=null;
  for (const ln of text.split(/\r?\n/)){
    const t = ln.trim().split(/\s+/);
    if (t[0]==='WIRE') wires.push(t.slice(1,5).map(Number));
    else if (t[0]==='FLAG') flags.push({x:+t[1],y:+t[2],name:t[3]});
    else if (t[0]==='SYMBOL'){ cur={sym:t[1], x:+t[2], y:+t[3], rot:t[4]}; syms.push(cur); }
    else if (t[0]==='SYMATTR' && cur){
      if (t[1]==='InstName') cur.name=t.slice(2).join(' ');
      if (t[1]==='Value') cur.value=t.slice(2).join(' ');
    }
  }
  return {wires,flags,syms};
}

export class UF {
  constructor(){ this.p=new Map(); }
  find(k){ if(!this.p.has(k)) this.p.set(k,k); let r=k; while(this.p.get(r)!==r) r=this.p.get(r);
    while(this.p.get(k)!==r){const n=this.p.get(k); this.p.set(k,r); k=n;} return r; }
  union(a,b){ this.p.set(this.find(a), this.find(b)); }
}
const key = p => p[0]+','+p[1];
const onSeg = (p,w) => {
  const [x1,y1,x2,y2]=w;
  if (x1===x2) return p[0]===x1 && p[1]>=Math.min(y1,y2) && p[1]<=Math.max(y1,y2);
  if (y1===y2) return p[1]===y1 && p[0]>=Math.min(x1,x2) && p[0]<=Math.max(x1,x2);
  return false;
};

export function connectivity(asc){
  const {wires,flags,syms} = parseAsc(asc);
  const uf = new UF();
  const pts = new Set();
  const pinRecs=[];
  for (const s of syms){
    const S = SYMBOLS[s.sym];
    if (!S) throw new Error('unknown symbol in asc: '+s.sym);
    S.pins.forEach((p,i)=>{
      const rp = rot(p, s.rot);
      const abs=[s.x+rp[0], s.y+rp[1]];
      pinRecs.push({comp:s.name, idx:i, pt:abs, sym:s.sym, value:s.value});
      pts.add(key(abs));
    });
  }
  for (const f of flags) pts.add(key([f.x,f.y]));
  for (const w of wires){ pts.add(key([w[0],w[1]])); pts.add(key([w[2],w[3]])); }
  // split wires at all interesting points lying on them, union consecutive
  for (const w of wires){
    const on=[...pts].map(k=>k.split(',').map(Number)).filter(p=>onSeg(p,w));
    on.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    for (let i=1;i<on.length;i++) uf.union(key(on[i-1]), key(on[i]));
  }
  // flags name their group
  const groupName=new Map();
  for (const f of flags){
    const g = uf.find(key([f.x,f.y]));
    groupName.set(g, f.name==='0' ? '0' : f.name);
  }
  // group pins into nets; same-named flag groups merge (VCC == VCC across sheet)
  const nets=new Map(); // netKey -> Set("comp:idx")
  for (const pr of pinRecs){
    let g = uf.find(key(pr.pt));
    let nk = groupName.has(g) ? 'FLAG:'+groupName.get(g) : 'G:'+g;
    if (!nets.has(nk)) nets.set(nk,new Set());
    nets.get(nk).add(pr.comp+':'+pr.idx);
  }
  return nets;
}

export function netlistPartition(text){
  const {comps}=parseNetlist(text);
  const cls=classifyNets(comps);
  const nets=new Map();
  for (const c of comps) c.nets.forEach((n,i)=>{
    const t=cls.get(n);
    const nk = t==='gnd' ? 'FLAG:0' : t==='rail' ? 'FLAG:'+railLabel(n,comps) : 'NET:'+n;
    if(!nets.has(nk)) nets.set(nk,new Set());
    nets.get(nk).add(c.name+':'+i);
  });
  return nets;
}

export function compare(nlText, ascText){
  const A=netlistPartition(nlText), B=connectivity(ascText);
  const sig=s=>[...s].sort().join('|');
  const errs=[];
  const mapB=new Map([...B.values()].map(v=>[sig(v),v]));
  for (const [nk,pins] of A){
    if (pins.size<1) continue;
    if (!mapB.get(sig(pins))){ errs.push('missing net '+nk+' ['+[...pins].join(' ')+']'); continue; }
    if (nk.startsWith('FLAG:')){
      const found=[...B.entries()].find(([k,v])=>sig(v)===sig(pins));
      if (found[0]!==nk) errs.push('flag name mismatch '+nk+' vs '+found[0]);
    }
  }
  const mapA=new Map([...A.values()].map(v=>[sig(v),v]));
  for (const [nk,pins] of B){
    if (!mapA.get(sig(pins))) errs.push('extra net in asc '+nk+' ['+[...pins].join(' ')+']');
  }
  // Pin-wire proximity check: every pin in the ASC must have a wire endpoint
  // or flag at its exact coordinate (or a wire passing through it via onSeg).
  // This catches wires that are offset by 1 grid cell from a pin — a class of
  // bug the connectivity union-find misses because the pin is still "connected"
  // via a flag placed at the same net but at the wrong location.
  const pinPts = new Set();
  const {wires:ascWires, flags:ascFlags} = parseAsc(ascText);
  for (const w of ascWires){
    pinPts.add(key([w[0],w[1]])); pinPts.add(key([w[2],w[3]]));
  }
  for (const f of ascFlags) pinPts.add(key([f.x,f.y]));
  // For each component pin, check it is covered by a wire endpoint, a flag,
  // or lies on a wire segment
  const {syms:ascSyms} = parseAsc(ascText);
  for (const s of ascSyms){
    const S = SYMBOLS[s.sym]; if (!S) continue;
    S.pins.forEach((p,i)=>{
      const rp = rot(p, s.rot);
      const abs=[s.x+rp[0], s.y+rp[1]];
      const k2 = key(abs);
      if (pinPts.has(k2)) return;  // wire endpoint or flag exactly here — OK
      // check if any wire passes through this pin
      const onAny = ascWires.some(w=>onSeg(abs,w));
      if (!onAny) errs.push('pin not reached by wire: '+s.name+'['+i+'] at '+abs[0]+','+abs[1]);
    });
  }
  return errs;
}


/* weave-asc UI v1.4: viewer removed. Convert, verify, download.
   Core (convert) and verifier (compare) injected at build time from CLI sources. */



/* ── Weave bidirectional UI v5.0 ───────────────────────────────────────── */
