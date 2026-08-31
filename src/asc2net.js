'use strict';
import { rot } from './shared/geometry.js';
import { SYMBOLS } from './tab1/symbols.js';
import { parseAsc } from './tab1/verifier.js';
// ── TAB 2: asc2net engine ────────────────────────────────────────────────
// Reverse converter: LTspice .asc → SPICE netlist
// Depends on: SYMBOLS (constants.js), rot() (constants.js), parseAsc() (verifier.js)
// We define our own UF locally to avoid conflicts
class UF2 {
  constructor(){this.p=new Map();}
  find(k){
    if(!this.p.has(k)) this.p.set(k,k);
    let r=k;
    while(this.p.get(r)!==r) r=this.p.get(r);
    while(this.p.get(k)!==r){const n=this.p.get(k);this.p.set(k,r);k=n;}
    return r;
  }
  union(a,b){this.p.set(this.find(a),this.find(b));}
}
const key2=p=>p[0]+','+p[1];
const onSeg2=(p,w)=>{
  const[x1,y1,x2,y2]=w;
  if(x1===x2) return p[0]===x1&&p[1]>=Math.min(y1,y2)&&p[1]<=Math.max(y1,y2);
  if(y1===y2) return p[1]===y1&&p[0]>=Math.min(x1,x2)&&p[0]<=Math.max(x1,x2);
  return false;
};

function findSymDef(symName){
  if(!SYMBOLS) return null;
  if(SYMBOLS[symName]) return SYMBOLS[symName];
  const lower=symName.toLowerCase();
  for(const k of Object.keys(SYMBOLS)){
    const parts=k.split('\\');
    if(parts[parts.length-1].toLowerCase()===lower) return SYMBOLS[k];
  }
  return null;
}

function buildNetNames(wires,flags,pinPoints){
  const uf=new UF2();
  const pts=new Set();
  for(const pp of pinPoints) pts.add(key2(pp));
  for(const f of flags) pts.add(key2([f.x,f.y]));
  for(const w of wires){pts.add(key2([w[0],w[1]]));pts.add(key2([w[2],w[3]]));}
  for(const w of wires){
    const on=[...pts].map(k=>k.split(',').map(Number)).filter(p=>onSeg2(p,w));
    on.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    for(let i=1;i<on.length;i++) uf.union(key2(on[i-1]),key2(on[i]));
  }
  const groupName=new Map();
  for(const f of flags){
    const g=uf.find(key2([f.x,f.y]));
    groupName.set(g, f.name==='0'?'0':f.name);
  }
  let autoIdx=1;
  const netOf=pt=>{
    const g=uf.find(key2(pt));
    if(!groupName.has(g)) groupName.set(g,'N'+String(autoIdx++).padStart(3,'0'));
    return groupName.get(g);
  };
  return{netOf};
}

function reorderNets(rawNets,symDef,symAttrSpiceOrder){
  let order=symDef&&symDef.ord?symDef.ord:null;
  if(symAttrSpiceOrder){order=symAttrSpiceOrder.trim().split(/\s+/).map(Number);}
  if(!order) return rawNets;
  const result=new Array(rawNets.length);
  for(let i=0;i<order.length&&i<rawNets.length;i++){
    const spicePos=order[i]-1;
    if(spicePos>=0&&spicePos<rawNets.length) result[spicePos]=rawNets[i];
  }
  for(let i=0;i<result.length;i++) if(result[i]===undefined) result[i]='0';
  return result;
}

function primitiveSpice(sym,nets){
  const n=sym.name, v=sym.value;
  if(!n) return null;
  const prefix=n[0].toUpperCase();
  if(prefix==='V'||prefix==='I') return `${n} ${nets[0]||'?'} ${nets[1]||'?'} ${v||'0'}`;
  if(prefix==='R'||prefix==='C'||prefix==='L') return `${n} ${nets[0]||'?'} ${nets[1]||'?'} ${v||'?'}`;
  if(prefix==='D') return `${n} ${nets[0]||'?'} ${nets[1]||'?'} ${v||'D'}`;
  if(prefix==='Q'){
    if(nets.length>=4) return `${n} ${nets[0]} ${nets[1]} ${nets[2]} ${nets[3]} ${v||'?'}`;
    return `${n} ${nets[0]||'?'} ${nets[1]||'?'} ${nets[2]||'?'} ${v||'?'}`;
  }
  if(prefix==='M'){
    if(nets.length>=4) return `${n} ${nets[0]} ${nets[1]} ${nets[2]} ${nets[3]} ${v||'?'}`;
    return `${n} ${nets[0]||'?'} ${nets[1]||'?'} ${nets[2]||'?'} ${v||'?'}`;
  }
  if(prefix==='J') return `${n} ${nets[0]||'?'} ${nets[1]||'?'} ${nets[2]||'?'} ${v||'?'}`;
  if(prefix==='X'){
    const model=sym.spiceModel||v||sym.sym;
    return `${n} ${nets.join(' ')} ${model}`;
  }
  if('EGFHB'.includes(prefix)) return `${n} ${nets.join(' ')} ${v||'?'}`;
  return `${n} ${nets.join(' ')} ${v||'?'}`;
}

function extractDirectives(text){
  const directives=[];
  for(const ln of text.split(/\r?\n/)){
    const t=ln.trim();
    if(t.startsWith('TEXT')){
      const m=t.match(/TEXT\s+-?\d+\s+-?\d+\s+\w+\s+\d+\s+(!|\|)\s*(.+)/);
      if(m&&m[1]==='!') directives.push(m[2].trim());
    }
  }
  return directives;
}

// Full parser that also captures Value2, SpiceModel, SpiceOrder
function parseAscFull(text){
  const wires=[],flags=[],syms=[];
  let cur=null;
  for(const ln of text.split(/\r?\n/)){
    const t=ln.trim().split(/\s+/);
    if(!t[0]) continue;
    if(t[0]==='WIRE') wires.push(t.slice(1,5).map(Number));
    else if(t[0]==='FLAG') flags.push({x:+t[1],y:+t[2],name:t[3]});
    else if(t[0]==='SYMBOL'){
      cur={sym:t[1],x:+t[2],y:+t[3],rot:t[4]||'R0',
           name:null,value:null,value2:null,spiceModel:null,spiceOrder:null};
      syms.push(cur);
    } else if(t[0]==='SYMATTR'&&cur){
      const attr=t[1], val=t.slice(2).join(' ');
      if(attr==='InstName')    cur.name=val;
      else if(attr==='Value')  cur.value=val;
      else if(attr==='Value2') cur.value2=val;
      else if(attr==='SpiceModel') cur.spiceModel=val;
      else if(attr==='SpiceOrder') cur.spiceOrder=val;
    }
  }
  return{wires,flags,syms};
}

export function asc2net(ascText){
  const{wires,flags,syms}=parseAscFull(ascText);
  const pinCoords=[];
  for(const s of syms){
    if(!s.name) continue;
    const symDef=findSymDef(s.sym);
    if(!symDef) continue;
    symDef.pins.forEach((p,i)=>{
      const rp=rot(p,s.rot);
      const abs=[s.x+rp[0],s.y+rp[1]];
      pinCoords.push({sym:s,pinIdx:i,pt:abs,symDef});
    });
  }
  const{netOf}=buildNetNames(wires,flags,pinCoords.map(pc=>pc.pt));
  const symPins=new Map();
  for(const pc of pinCoords){
    const sname=pc.sym.name;
    if(!symPins.has(sname)) symPins.set(sname,[]);
    symPins.get(sname).push({pinIdx:pc.pinIdx,net:netOf(pc.pt),symDef:pc.symDef});
  }
  const lines=['* Schematic exported by Weave asc2net',''];
  for(const s of syms){
    if(!s.name) continue;
    const pins=symPins.get(s.name);
    if(!pins) continue;
    const sorted=[...pins].sort((a,b)=>a.pinIdx-b.pinIdx);
    const rawNets=sorted.map(p=>p.net);
    const symDef=sorted[0]&&sorted[0].symDef;
    const nets=reorderNets(rawNets,symDef,s.spiceOrder);
    const line=primitiveSpice(s,nets);
    if(line) lines.push(line);
  }
  const directives=extractDirectives(ascText);
  for(const d of directives) lines.push(d);
  lines.push('','* end');
  return lines.join('\n');
}
