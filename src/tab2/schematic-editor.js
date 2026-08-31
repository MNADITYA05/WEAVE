'use strict';
import { SYMDEFS, PALETTE_GROUPS } from './schematic-symbols.js';

const GRID = 16;
const snap = v => Math.round(v / GRID) * GRID;

// ── Rotation helpers ──────────────────────────────────────────────────────
function rotPt([x,y], code) {
  if (code[0]==='M') x=-x;
  const k=parseInt(code.slice(1),10);
  if(k===0)   return [x,y];
  if(k===90)  return [-y,x];
  if(k===180) return [-x,-y];
  if(k===270) return [y,-x];
  return [x,y];
}
function nextRot(code) {
  const seq=['R0','R90','R180','R270'];
  return seq[(seq.indexOf(code)+1)%4];
}
function svgAng(rotCode) {
  return -parseInt(rotCode.replace(/^M/,'').slice(1)||'0',10);
}

// ── State ─────────────────────────────────────────────────────────────────
const S = {
  comps:[], wires:[], junctions:[],
  sel:null,
  mode:'select',
  placing:null, placingRot:'R0',
  wireStart:null,
  mouse:{x:0,y:0},
  pan:{x:200,y:200}, zoom:1,
  counters:{},
  lastNet:'',
};
let _nid=1;
const uid=()=>'c'+(_nid++);

// ── DOM refs ──────────────────────────────────────────────────────────────
let svgEl,pzEl,compL,wireL,juncL,ghostL,selL;
let statusEl,infoEl,netlistEl,propsBodyEl,dlBtn,hintEl;
let _panDrag=null;

// ── CSS injection ─────────────────────────────────────────────────────────
function injectCSS() {
  if(document.getElementById('sc-css')) return;
  const s=document.createElement('style'); s.id='sc-css';
  s.textContent=`
#sc-editor{display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:system-ui,sans-serif;background:#1a1a1a}
#sc-toolbar{display:flex;align-items:center;gap:4px;padding:5px 8px;background:#2d2d2d;flex-shrink:0;border-bottom:1px solid #111}
#sc-toolbar button{padding:3px 10px;border:none;border-radius:3px;cursor:pointer;font-size:12px;background:#3a3a3a;color:#ccc}
#sc-toolbar button:hover{background:#4a4a4a}
#sc-toolbar button.sc-active{background:#1a7fd4;color:#fff}
#sc-toolbar button:disabled{opacity:.35;cursor:default}
.sc-sep{width:1px;height:18px;background:#444;margin:0 3px;flex-shrink:0}
#sc-status{font-size:11px;padding:0 4px}
#sc-status.ok{color:#5c5}
#sc-status.bad{color:#f66}
#sc-main{display:flex;flex:1;min-height:0}
#sc-palette{width:152px;min-width:152px;background:#252525;overflow-y:auto;flex-shrink:0;border-right:1px solid #111}
.sc-pg-title{font-size:9px;color:#666;padding:6px 8px 2px;text-transform:uppercase;letter-spacing:.6px}
.sc-pb{display:flex;align-items:center;gap:5px;width:100%;padding:4px 8px;background:none;border:none;color:#bbb;cursor:pointer;font-size:11px;text-align:left;box-sizing:border-box}
.sc-pb:hover,.sc-pb.sc-active{background:#1a7fd4;color:#fff}
.sc-pb svg{flex-shrink:0}
#sc-cwrap{flex:1;min-width:0;overflow:hidden;position:relative;background:#fff}
#sc-canvas{width:100%;height:100%;display:block;cursor:crosshair}
#sc-panel{width:210px;min-width:210px;background:#1e1e1e;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0;border-left:1px solid #111}
.sc-ps{padding:8px;border-bottom:1px solid #2a2a2a;flex-shrink:0}
.sc-pt{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px}
#sc-netlist-wrap{flex:1;min-height:0;display:flex;flex-direction:column;padding:0}
#sc-netlist{flex:1;min-height:0;margin:0;padding:8px;font-size:10px;line-height:1.6;color:#8c8;background:#111;font-family:monospace;overflow:auto;white-space:pre}
.sc-pr{display:flex;flex-direction:column;gap:2px;margin-bottom:7px}
.sc-pl{font-size:10px;color:#777}
.sc-pi{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:3px;color:#ddd;padding:3px 5px;font-size:12px;font-family:monospace;width:100%;box-sizing:border-box}
.sc-pi:focus{outline:none;border-color:#1a7fd4}
.sc-pbs{display:flex;gap:4px;margin-top:3px}
.sc-pbtn{flex:1;padding:3px 0;background:#2e2e2e;border:none;border-radius:3px;color:#bbb;cursor:pointer;font-size:11px}
.sc-pbtn:hover{background:#3e3e3e}
.sc-pbtn.del{background:#3a1a1a;color:#f88}
.sc-pbtn.del:hover{background:#4a2a2a}
.sc-hint{font-size:11px;color:#666;font-style:italic}
#sc-hintbar{padding:3px 10px;background:#181818;font-size:10px;color:#555;flex-shrink:0;border-top:1px solid #111}
`;
  document.head.appendChild(s);
}

// ── HTML skeleton ─────────────────────────────────────────────────────────
function buildHTML() {
  return `<div id="sc-editor">
<div id="sc-toolbar">
  <button id="sc-btn-sel" class="sc-active" title="Select (Esc)">&#9654; Select</button>
  <button id="sc-btn-wire" title="Wire (W)">&#9135; Wire</button>
  <div class="sc-sep"></div>
  <button id="sc-btn-clear">Clear</button>
  <div class="sc-sep"></div>
  <button id="sc-btn-conv">&#9889; Convert</button>
  <button id="sc-dl" disabled>&#8595; .net</button>
  <span id="sc-status"></span>
  <span style="flex:1"></span>
  <span id="sc-info" style="font-size:11px;color:#666;margin-right:6px"></span>
</div>
<div id="sc-main">
  <div id="sc-palette"></div>
  <div id="sc-cwrap">
    <svg id="sc-canvas" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="sc-gp" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse">
          <circle cx="${GRID/2}" cy="${GRID/2}" r="0.7" fill="#ccc" opacity="0.5"/>
        </pattern>
      </defs>
      <g id="sc-pz">
        <rect x="-8000" y="-8000" width="16000" height="16000" fill="url(#sc-gp)"/>
        <g id="sc-wires"></g>
        <g id="sc-comps"></g>
        <g id="sc-juncs"></g>
        <g id="sc-sel"></g>
        <g id="sc-ghost"></g>
      </g>
    </svg>
  </div>
  <div id="sc-panel">
    <div class="sc-ps">
      <div class="sc-pt">Properties</div>
      <div id="sc-props-body"><em class="sc-hint">Select a component</em></div>
    </div>
    <div id="sc-netlist-wrap" class="sc-ps" style="flex:1;min-height:0;display:flex;flex-direction:column;padding:0;border-bottom:none">
      <div class="sc-pt" style="padding:8px 8px 0">Netlist Output</div>
      <pre id="sc-netlist"></pre>
    </div>
  </div>
</div>
<div id="sc-hintbar"><span id="sc-hint-txt">Click palette &#8594; place &middot; W=wire &middot; Esc=select &middot; R=rotate &middot; Del=delete</span></div>
</div>`;
}

// ── Palette ────────────────────────────────────────────────────────────────
function buildPalette(el) {
  let h='';
  for(const grp of PALETTE_GROUPS){
    h+=`<div class="sc-pg-title">${grp.name}</div>`;
    for(const t of grp.types){
      const def=SYMDEFS[t];
      if(!def) continue;
      // mini SVG preview: render symbol at ~32x32 viewBox
      const preview=`<svg width="28" height="28" viewBox="-36 -36 72 72" style="overflow:visible">
<g stroke="#aaa" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${def.svg}</g></svg>`;
      h+=`<button class="sc-pb" data-type="${t}" title="${def.label}">${preview}<span>${def.label}</span></button>`;
    }
  }
  el.innerHTML=h;
  el.querySelectorAll('.sc-pb').forEach(btn=>{
    btn.addEventListener('click',()=>enterPlace(btn.dataset.type));
  });
}

// ── Mode helpers ──────────────────────────────────────────────────────────
function enterPlace(type) {
  S.mode='place'; S.placing=type; S.placingRot='R0'; S.sel=null; S.wireStart=null;
  document.getElementById('sc-btn-sel').classList.remove('sc-active');
  document.getElementById('sc-btn-wire').classList.remove('sc-active');
  document.querySelectorAll('.sc-pb').forEach(b=>b.classList.toggle('sc-active',b.dataset.type===type));
  svgEl.style.cursor='crosshair';
  updateHint(`Placing ${SYMDEFS[type].label} — Left-click to place, Right-click/R to rotate, Esc to cancel`);
  renderGhost();
}
function enterSelect() {
  S.mode='select'; S.placing=null; S.wireStart=null;
  document.getElementById('sc-btn-sel').classList.add('sc-active');
  document.getElementById('sc-btn-wire').classList.remove('sc-active');
  document.querySelectorAll('.sc-pb').forEach(b=>b.classList.remove('sc-active'));
  svgEl.style.cursor='default';
  ghostL.innerHTML='';
  updateHint('Click to select &middot; Drag to move &middot; W=wire &middot; R=rotate selected &middot; Del=delete');
  render();
}
function enterWire() {
  S.mode='wire'; S.wireStart=null; S.sel=null;
  document.getElementById('sc-btn-sel').classList.remove('sc-active');
  document.getElementById('sc-btn-wire').classList.add('sc-active');
  document.querySelectorAll('.sc-pb').forEach(b=>b.classList.remove('sc-active'));
  svgEl.style.cursor='crosshair';
  ghostL.innerHTML='';
  updateHint('Click start point, then end point &middot; Esc=cancel wire &middot; Double-click to finish');
  render();
}
function updateHint(msg) { if(hintEl) hintEl.innerHTML=msg; }

// ── World ↔ screen ────────────────────────────────────────────────────────
function evToWorld(e) {
  const r=svgEl.getBoundingClientRect();
  return [snap((e.clientX-r.left-S.pan.x)/S.zoom), snap((e.clientY-r.top-S.pan.y)/S.zoom)];
}

// ── Auto-name ─────────────────────────────────────────────────────────────
function autoName(type) {
  const def=SYMDEFS[type];
  const pfx=def.prefix;
  if(!S.counters[pfx]) S.counters[pfx]=1;
  // Find highest existing index for this prefix
  let max=0;
  for(const c of S.comps){
    if(c.name && c.name.toUpperCase().startsWith(pfx)){
      const n=parseInt(c.name.slice(pfx.length),10);
      if(!isNaN(n)&&n>max) max=n;
    }
  }
  S.counters[pfx]=max+1;
  return pfx+S.counters[pfx];
}
function defaultValue(type) {
  const map={R:'1k',C:'1n',L:'1u',V:'5',I:'1m',D:'1N4148',Q_NPN:'2N3904',Q_PNP:'2N3906',
    M_NMOS:'NMOS',M_PMOS:'PMOS',J_N:'J2N3819',J_P:'J2N3819',B:'V=0',K:'1',T:'Td=1n Z0=50',
    E:'1',G:'1',F:'1',H:'1',S:'0 1',W:'0 1',X:'SUBCKT',GND:'0',VDD:'VDD',VCC:'VCC',VSS:'VSS'};
  return map[type]||'?';
}

// ── Point-on-segment ──────────────────────────────────────────────────────
function ptOnSeg(px,py,x1,y1,x2,y2) {
  if(x1===x2) return px===x1&&py>=Math.min(y1,y2)&&py<=Math.max(y1,y2);
  if(y1===y2) return py===y1&&px>=Math.min(x1,x2)&&px<=Math.max(x1,x2);
  return false;
}

// ── Junction detection ────────────────────────────────────────────────────
function detectJunctions() {
  const cnt=new Map();
  const bump=k=>cnt.set(k,(cnt.get(k)||0)+1);
  for(const w of S.wires){ bump(w.x1+','+w.y1); bump(w.x2+','+w.y2); }
  // T-intersections: endpoint on interior of another wire
  for(const w of S.wires){
    for(const w2 of S.wires){
      if(w===w2) continue;
      for(const[ex,ey] of [[w.x1,w.y1],[w.x2,w.y2]]){
        if(ptOnSeg(ex,ey,w2.x1,w2.y1,w2.x2,w2.y2)&&
          !(ex===w2.x1&&ey===w2.y1)&&!(ex===w2.x2&&ey===w2.y2)){
          cnt.set(ex+','+ey,99);
        }
      }
    }
  }
  S.junctions=[];
  for(const[k,n] of cnt){
    if(n>=3){const[x,y]=k.split(',').map(Number);S.junctions.push({x,y});}
  }
}

// ── Render ────────────────────────────────────────────────────────────────
function render() {
  pzEl.setAttribute('transform',`translate(${S.pan.x},${S.pan.y}) scale(${S.zoom})`);
  detectJunctions();

  // Wires
  wireL.innerHTML=S.wires.map(w=>`<line id="scw-${w.id}" data-wid="${w.id}"
    x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}"
    stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" style="cursor:default"/>`).join('');

  // Comps
  let csvg='';
  for(const c of S.comps){
    const def=SYMDEFS[c.type];
    if(!def) continue;
    const ang=svgAng(c.rot);
    const isSel=c.id===S.sel;
    const stroke=isSel?'#1a7fd4':'#1a1a1a';
    csvg+=`<g id="scc-${c.id}" data-cid="${c.id}" transform="translate(${c.x},${c.y}) rotate(${ang})" style="cursor:pointer">`;
    if(isSel) csvg+=`<rect x="-38" y="-44" width="76" height="88" fill="#1a7fd440" stroke="#1a7fd4" stroke-width="1" rx="3" stroke-dasharray="4,2"/>`;
    csvg+=`<g stroke="${stroke}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" color="${stroke}">`;
    csvg+=def.svg;
    csvg+='</g>';
    // Labels
    if(def.refOffset&&c.name) csvg+=`<text x="${def.refOffset[0]}" y="${def.refOffset[1]}" font-size="11" fill="${stroke}" font-family="monospace" style="user-select:none">${c.name}</text>`;
    if(def.valOffset&&c.value) csvg+=`<text x="${def.valOffset[0]}" y="${def.valOffset[1]}" font-size="10" fill="#666" font-family="monospace" style="user-select:none">${c.value}</text>`;
    // pin dots
    for(const[px,py] of def.pins) csvg+=`<circle cx="${px}" cy="${py}" r="2.5" fill="${isSel?'#1a7fd4':'#888'}" stroke="none"/>`;
    // transparent hit area
    csvg+=`<rect x="-38" y="-44" width="76" height="88" fill="transparent"/>`;
    csvg+='</g>';
  }
  compL.innerHTML=csvg;

  // Junctions
  juncL.innerHTML=S.junctions.map(j=>`<circle cx="${j.x}" cy="${j.y}" r="4" fill="#1a1a1a"/>`).join('');

  selL.innerHTML='';
  if(S.mode!=='place') ghostL.innerHTML='';
  infoEl.textContent=`${S.comps.filter(c=>!SYMDEFS[c.type]?.netName).length} comp · ${S.wires.length} wire`;
}

// ── Ghost (placement preview) ─────────────────────────────────────────────
function renderGhost() {
  if(S.mode!=='place'||!S.placing) { ghostL.innerHTML=''; return; }
  const def=SYMDEFS[S.placing];
  if(!def) return;
  const ang=svgAng(S.placingRot);
  const {x,y}=S.mouse;
  ghostL.innerHTML=`<g transform="translate(${x},${y}) rotate(${ang})" opacity="0.55">
<g stroke="#1a7fd4" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" color="#1a7fd4">
${def.svg}</g>
${def.pins.map(([px,py])=>`<circle cx="${px}" cy="${py}" r="3" fill="#1a7fd4" stroke="none"/>`).join('')}
</g>`;
}

// ── Wire preview ──────────────────────────────────────────────────────────
function renderWirePreview(ex,ey) {
  if(!S.wireStart) { ghostL.innerHTML=''; return; }
  const {x:sx,y:sy}=S.wireStart;
  // L-bend: horizontal then vertical
  let segs='';
  if(sx!==ex&&sy!==ey){
    segs+=`<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${sy}" stroke="#1a7fd4" stroke-width="2" stroke-dasharray="4,3"/>`;
    segs+=`<line x1="${ex}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#1a7fd4" stroke-width="2" stroke-dasharray="4,3"/>`;
  } else {
    segs+=`<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#1a7fd4" stroke-width="2" stroke-dasharray="4,3"/>`;
  }
  ghostL.innerHTML=segs+`<circle cx="${sx}" cy="${sy}" r="3" fill="#1a7fd4"/>`;
}

// ── Properties panel ──────────────────────────────────────────────────────
function showProps(comp) {
  if(!comp){ propsBodyEl.innerHTML='<em class="sc-hint">Select a component</em>'; return; }
  const def=SYMDEFS[comp.type];
  let h=`<div class="sc-pr"><div class="sc-pl">Name</div>
<input class="sc-pi" id="pi-name" value="${comp.name||''}"/></div>`;
  if(def.valOffset!==null) h+=`<div class="sc-pr"><div class="sc-pl">Value</div>
<input class="sc-pi" id="pi-val" value="${comp.value||''}"/></div>`;
  if(['Q_NPN','Q_PNP','M_NMOS','M_PMOS','J_N','J_P','D','X'].includes(comp.type)){
    h+=`<div class="sc-pr"><div class="sc-pl">Model</div>
<input class="sc-pi" id="pi-model" value="${comp.extra?.model||''}"/></div>`;
  }
  h+=`<div class="sc-pr"><div class="sc-pl">Rotation</div>
<div style="color:#aaa;font-size:11px;font-family:monospace">${comp.rot}</div></div>`;
  h+=`<div class="sc-pbs">
<button class="sc-pbtn" id="pi-rot">&#8635; Rotate</button>
<button class="sc-pbtn del" id="pi-del">&#10005; Delete</button></div>`;
  propsBodyEl.innerHTML=h;
  propsBodyEl.querySelector('#pi-name').addEventListener('input',e=>{
    comp.name=e.target.value; render();});
  const vi=propsBodyEl.querySelector('#pi-val');
  if(vi) vi.addEventListener('input',e=>{ comp.value=e.target.value; render();});
  const mi=propsBodyEl.querySelector('#pi-model');
  if(mi) mi.addEventListener('input',e=>{ if(!comp.extra) comp.extra={}; comp.extra.model=e.target.value;});
  propsBodyEl.querySelector('#pi-rot').addEventListener('click',()=>{
    comp.rot=nextRot(comp.rot); render(); showProps(comp);});
  propsBodyEl.querySelector('#pi-del').addEventListener('click',()=>deleteSelected());
}

function deleteSelected() {
  if(!S.sel) return;
  S.comps=S.comps.filter(c=>c.id!==S.sel);
  S.sel=null; showProps(null); render();
}

// ── Netlist generation ────────────────────────────────────────────────────
function generateNetlist() {
  class UF {
    constructor(){this.p=new Map();}
    find(k){if(!this.p.has(k))this.p.set(k,k);let r=k;while(this.p.get(r)!==r)r=this.p.get(r);while(this.p.get(k)!==r){const n=this.p.get(k);this.p.set(k,r);k=n;}return r;}
    union(a,b){this.p.set(this.find(a),this.find(b));}
  }
  const uf=new UF();
  const pts=new Set();
  for(const w of S.wires){pts.add(w.x1+','+w.y1);pts.add(w.x2+','+w.y2);}
  for(const c of S.comps){
    const def=SYMDEFS[c.type];if(!def)continue;
    for(const p of def.pins){const rp=rotPt(p,c.rot);pts.add((c.x+rp[0])+','+(c.y+rp[1]));}
  }
  const ptArr=[...pts].map(k=>k.split(',').map(Number));
  for(const w of S.wires){
    const sp=ptArr.filter(([px,py])=>ptOnSeg(px,py,w.x1,w.y1,w.x2,w.y2));
    sp.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    for(let i=1;i<sp.length;i++) uf.union(sp[i-1][0]+','+sp[i-1][1],sp[i][0]+','+sp[i][1]);
  }
  const gname=new Map();
  for(const c of S.comps){
    const def=SYMDEFS[c.type];if(!def||!def.netName)continue;
    const rp=rotPt(def.pins[0],c.rot);
    const k=(c.x+rp[0])+','+(c.y+rp[1]);
    gname.set(uf.find(k),def.netName);
  }
  let ai=1;
  const netOf=k=>{const g=uf.find(k);if(!gname.has(g))gname.set(g,'N'+String(ai++).padStart(3,'0'));return gname.get(g);};

  const lines=['* Weave schematic editor',''];
  for(const c of S.comps){
    const def=SYMDEFS[c.type];
    if(!def||def.netName) continue;
    if(!c.name) continue;
    const nets=def.pins.map(p=>{const rp=rotPt(p,c.rot);return netOf((c.x+rp[0])+','+(c.y+rp[1]));});
    const name=c.name, val=c.value||'?', pfx=name[0].toUpperCase();
    const model=c.extra?.model||val;
    let line;
    if('RCL'.includes(pfx))        line=`${name} ${nets[0]} ${nets[1]} ${val}`;
    else if(pfx==='D')             line=`${name} ${nets[0]} ${nets[1]} ${model}`;
    else if(pfx==='Q')             line=`${name} ${nets[0]} ${nets[1]} ${nets[2]} ${model}`;
    else if(pfx==='M')             line=`${name} ${nets[0]} ${nets[1]} ${nets[2]} ${nets[3]||nets[2]} ${model}`;
    else if(pfx==='J')             line=`${name} ${nets[0]} ${nets[1]} ${nets[2]} ${model}`;
    else if('VI'.includes(pfx))    line=`${name} ${nets[0]} ${nets[1]} ${val}`;
    else if('EG'.includes(pfx))    line=`${name} ${nets[0]} ${nets[1]} ${nets[2]||'?'} ${nets[3]||'?'} ${val}`;
    else if('FH'.includes(pfx))    line=`${name} ${nets[0]} ${nets[1]} ${c.extra?.csrc||'VSRC'} ${val}`;
    else if(pfx==='B')             line=`${name} ${nets[0]} ${nets[1]} ${val}`;
    else if(pfx==='X')             line=`${name} ${nets.join(' ')} ${model}`;
    else if(pfx==='K')             line=`${name} ${c.extra?.L1||'L1'} ${c.extra?.L2||'L2'} ${val}`;
    else if('SW'.includes(pfx))    line=`${name} ${nets[0]} ${nets[1]} ${model}`;
    else if(pfx==='T')             line=`${name} ${nets[0]} ${nets[1]} ${nets[2]||'?'} ${nets[3]||'?'} ${val}`;
    else                           line=`${name} ${nets.join(' ')} ${val}`;
    lines.push(line);
  }
  lines.push('','.end');
  return lines.join('\n');
}

// ── Events ────────────────────────────────────────────────────────────────
function bindEvents(root) {
  const selBtn=root.querySelector('#sc-btn-sel');
  const wireBtn=root.querySelector('#sc-btn-wire');
  const clearBtn=root.querySelector('#sc-btn-clear');
  const convBtn=root.querySelector('#sc-btn-conv');

  selBtn.addEventListener('click',enterSelect);
  wireBtn.addEventListener('click',enterWire);
  clearBtn.addEventListener('click',()=>{
    if(!confirm('Clear all components and wires?')) return;
    S.comps=[];S.wires=[];S.junctions=[];S.sel=null;S.wireStart=null;
    S.lastNet=''; netlistEl.textContent=''; dlBtn.disabled=true;
    statusEl.textContent=''; showProps(null); render();
  });
  convBtn.addEventListener('click',()=>{
    try{
      S.lastNet=generateNetlist();
      netlistEl.textContent=S.lastNet;
      const n=S.lastNet.split('\n').filter(l=>l.trim()&&!l.startsWith('*')&&l!=='.end').length;
      statusEl.textContent=n+' element(s)'; statusEl.className='ok';
      dlBtn.disabled=false;
    }catch(e){
      statusEl.textContent='Error: '+e.message; statusEl.className='bad';
    }
  });
  dlBtn.addEventListener('click',()=>{
    if(!S.lastNet) return;
    const b=new Blob([S.lastNet],{type:'text/plain'});
    const a=document.createElement('a');
    const d=new Date(),p=n=>String(n).padStart(2,'0');
    a.download='netlist_'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+p(d.getHours())+p(d.getMinutes())+'.net';
    a.href=URL.createObjectURL(b); a.click(); URL.revokeObjectURL(a.href);
  });

  // SVG mouse events
  svgEl.addEventListener('mousemove', e=>{
    const[wx,wy]=evToWorld(e);
    S.mouse.x=wx; S.mouse.y=wy;
    if(_panDrag){
      S.pan.x+=e.clientX-_panDrag.lx; S.pan.y+=e.clientY-_panDrag.ly;
      _panDrag.lx=e.clientX; _panDrag.ly=e.clientY;
      pzEl.setAttribute('transform',`translate(${S.pan.x},${S.pan.y}) scale(${S.zoom})`);
      return;
    }
    if(S.mode==='place') renderGhost();
    if(S.mode==='wire') renderWirePreview(wx,wy);
  });

  svgEl.addEventListener('click', e=>{
    if(e.button!==0||_panDrag) return;
    const[wx,wy]=evToWorld(e);
    if(S.mode==='place') placeComp(wx,wy);
    else if(S.mode==='wire') wireClick(wx,wy);
    else selectAt(e,wx,wy);
  });

  svgEl.addEventListener('contextmenu', e=>{
    e.preventDefault();
    if(S.mode==='place'){ S.placingRot=nextRot(S.placingRot); renderGhost(); }
    else if(S.mode==='wire'&&S.wireStart){ S.wireStart=null; ghostL.innerHTML=''; }
  });

  svgEl.addEventListener('mousedown', e=>{
    if(e.button===1||(e.button===0&&e.altKey)){
      e.preventDefault(); _panDrag={lx:e.clientX,ly:e.clientY};
    }
  });
  window.addEventListener('mouseup', ()=>{ _panDrag=null; });

  svgEl.addEventListener('wheel', e=>{
    e.preventDefault();
    const r=svgEl.getBoundingClientRect();
    const mx=e.clientX-r.left, my=e.clientY-r.top;
    const zOld=S.zoom;
    S.zoom*=e.deltaY<0?1.12:1/1.12;
    S.zoom=Math.max(0.2,Math.min(4,S.zoom));
    // Zoom toward mouse position
    S.pan.x=mx-(mx-S.pan.x)*(S.zoom/zOld);
    S.pan.y=my-(my-S.pan.y)*(S.zoom/zOld);
    pzEl.setAttribute('transform',`translate(${S.pan.x},${S.pan.y}) scale(${S.zoom})`);
  },{passive:false});

  window.addEventListener('keydown', e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    if(e.key==='Escape'){ enterSelect(); }
    else if(e.key==='w'||e.key==='W'){ enterWire(); }
    else if((e.key==='Delete'||e.key==='Backspace')&&S.sel){ deleteSelected(); }
    else if((e.key==='r'||e.key==='R')){
      if(S.mode==='place'){ S.placingRot=nextRot(S.placingRot); renderGhost(); }
      else if(S.sel){
        const c=S.comps.find(c=>c.id===S.sel);
        if(c){ c.rot=nextRot(c.rot); render(); showProps(c); }
      }
    }
  });
}

// ── Place component ───────────────────────────────────────────────────────
function placeComp(x,y) {
  const def=SYMDEFS[S.placing];
  if(!def) return;
  const comp={id:uid(),type:S.placing,name:autoName(S.placing),value:defaultValue(S.placing),x,y,rot:S.placingRot,extra:{}};
  S.comps.push(comp);
  render();
  renderGhost(); // keep ghost active for continued placement
}

// ── Wire click ────────────────────────────────────────────────────────────
function wireClick(wx,wy) {
  if(!S.wireStart){ S.wireStart={x:wx,y:wy}; return; }
  const{x:sx,y:sy}=S.wireStart;
  if(sx===wx&&sy===wy){ S.wireStart=null; ghostL.innerHTML=''; return; }
  // Commit L-bend as 1 or 2 segments
  if(sx===wx||sy===wy){
    if(!(sx===wx&&sy===wy)) S.wires.push({id:uid(),x1:sx,y1:sy,x2:wx,y2:wy});
  } else {
    // horizontal first, then vertical
    S.wires.push({id:uid(),x1:sx,y1:sy,x2:wx,y2:sy});
    S.wires.push({id:uid(),x1:wx,y1:sy,x2:wx,y2:wy});
  }
  S.wireStart={x:wx,y:wy}; // chain: new start = current end
  render();
}

// ── Select at click ───────────────────────────────────────────────────────
function selectAt(e,wx,wy) {
  // Try to find component under click using element id
  let el=e.target;
  let found=null;
  while(el&&el!==svgEl){
    if(el.dataset&&el.dataset.cid){ found=el.dataset.cid; break; }
    el=el.parentElement;
  }
  // Also try wire deletion (right-click on wire) — skip for now
  if(found){
    if(found===S.sel){
      // clicking already-selected component → deselect
      S.sel=null; showProps(null);
    } else {
      S.sel=found;
      const comp=S.comps.find(c=>c.id===found);
      showProps(comp);
    }
  } else {
    S.sel=null;
    showProps(null);
  }
  render();
}

// ── Export init function ──────────────────────────────────────────────────
export function initEditor(root) {
  injectCSS();
  root.innerHTML=buildHTML();
  svgEl=root.querySelector('#sc-canvas');
  pzEl=root.querySelector('#sc-pz');
  compL=root.querySelector('#sc-comps');
  wireL=root.querySelector('#sc-wires');
  juncL=root.querySelector('#sc-juncs');
  ghostL=root.querySelector('#sc-ghost');
  selL=root.querySelector('#sc-sel');
  statusEl=root.querySelector('#sc-status');
  infoEl=root.querySelector('#sc-info');
  netlistEl=root.querySelector('#sc-netlist');
  propsBodyEl=root.querySelector('#sc-props-body');
  dlBtn=root.querySelector('#sc-dl');
  hintEl=root.querySelector('#sc-hint-txt');
  buildPalette(root.querySelector('#sc-palette'));
  bindEvents(root);
  render();
  window._SC = S;
  window._SYMDEFS = SYMDEFS;
  window._render = render;
  window._generateNetlist = generateNetlist;
}
