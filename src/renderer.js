'use strict';
import { GRID, rot, ROT_MAT, _svgMat } from './geometry.js';
import { SYMBOLS } from './symbols.js';
import { NOROT } from './orientation.js';
let _ascViewMode = 'text';
let lastAsc = '';
export function setAscView(mode) {
  _ascViewMode = mode;
  const av = document.getElementById('ascview');
  const sv = document.getElementById('svgview');
  av.style.display = mode === 'text' ? '' : 'none';
  if (mode === 'visual') {
    sv.classList.add('vis-on');
    if (lastAsc) renderSchematic(lastAsc);
  } else {
    sv.classList.remove('vis-on');
  }
  document.getElementById('btn-textv').classList.toggle('active', mode==='text');
  document.getElementById('btn-visv').classList.toggle('active', mode==='visual');
}

// ── Symbol shape library ──────────────────────────────────────────────────
// Shapes in LTspice R0 native coordinates relative to symbol origin.
// Each entry: array of {type:'path'|'circle'|'text', ...}

function pinWorldCoord(cx, cy, rot, px, py) {
  const [a,b,c,d] = ROT_MAT[rot] || ROT_MAT['R0'];
  return { x: cx + a*px + c*py, y: cy + b*px + d*py };
}

// Parse minimal .asc for rendering
function _parseAscR(text) {
  const wires=[], flags=[], syms=[], junctions=[];
  let cur=null;
  for (const ln of text.split(/\r?\n/)) {
    const t = ln.trim().split(/\s+/);
    if (!t[0]) continue;
    if (t[0]==='WIRE')     wires.push(t.slice(1,5).map(Number));
    else if (t[0]==='FLAG')     flags.push({x:+t[1], y:+t[2], name:t[3]||'?'});
    else if (t[0]==='JUNCTION') junctions.push([+t[1],+t[2]]);
    else if (t[0]==='SYMBOL') {
      const symFull = t[1];
      const symKey  = symFull.split('\\').pop().toLowerCase();
      cur = {full:symFull, key:symKey, x:+t[2], y:+t[3], rot:t[4]||'R0', name:null, value:null};
      syms.push(cur);
    } else if (t[0]==='SYMATTR' && cur) {
      if (t[1]==='InstName') cur.name = t.slice(2).join(' ');
      else if (t[1]==='Value') cur.value = t.slice(2).join(' ');
    }
  }
  return {wires, flags, syms, junctions};
}

// Tight bounding box
function _bbox(data) {
  let x0=1e9, y0=1e9, x1=-1e9, y1=-1e9;
  const exp=(x,y)=>{if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;};
  for (const w of data.wires) { exp(w[0],w[1]); exp(w[2],w[3]); }
  for (const f of data.flags)  exp(f.x,f.y);
  for (const s of data.syms)   { exp(s.x-80,s.y-80); exp(s.x+80,s.y+80); }
  for (const j of data.junctions) exp(j[0],j[1]);
  if (!isFinite(x0)) { x0=0; y0=0; x1=400; y1=400; }
  const pad = 48;
  return {x:x0-pad, y:y0-pad, w:(x1-x0)+2*pad, h:(y1-y0)+2*pad};
}

// Subcircuit → shape aliases (opamp-like parts)
const OPAMP_ALIASES = new Set([
  'opamp','op27','op37','op07','opa','lm741','lm324','lm358','lm741',
  'tl071','tl072','tl081','tl082','ua741','ne5534','ad8061','ltc',
  'ad797','opa627','opa2134','ina128','instrumentation'
]);
function _symKey(s) {
  const k = s.key || '';
  // Direct match
  if (SYM_DRAW[k]) return k;
  // Opamp alias: X-prefix subcircuits whose key contains opamp keywords
  for (const a of OPAMP_ALIASES) { if (k.includes(a)) return 'opamp'; }
  return null;  // no match
}

// Draw one symbol's shape primitives into group g
function _drawShapes(key) {
  const sym = SYM_DRAW[key];
  if (!sym || !sym.draw) return null;
  const SK = '#1a3a8a';
  let g = '';
  for (const sh of sym.draw) {
    if (sh.t === 'l') {
      g += `<line x1="${sh.x1}" y1="${sh.y1}" x2="${sh.x2}" y2="${sh.y2}" stroke="${SK}" stroke-width="1.5" stroke-linecap="round"/>`;
    } else if (sh.t === 'e') {
      g += `<ellipse cx="${sh.cx}" cy="${sh.cy}" rx="${sh.rx}" ry="${sh.ry}" stroke="${SK}" fill="none" stroke-width="1.5"/>`;
    } else if (sh.t === 'r') {
      g += `<rect x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" stroke="${SK}" fill="none" stroke-width="1.5"/>`;
    } else if (sh.t === 'a') {
      const d = `M${sh.x1.toFixed(2)},${sh.y1.toFixed(2)} A${sh.rx},${sh.ry} 0 ${sh.large},${sh.sweep} ${sh.x2.toFixed(2)},${sh.y2.toFixed(2)}`;
      g += `<path d="${d}" stroke="${SK}" fill="none" stroke-width="1.5" stroke-linecap="round"/>`;
    }
  }
  return g;
}

// Bounding box of a shape set (for label placement)
function _symBbox(key) {
  const sym = SYM_DRAW[key];
  if (!sym || !sym.draw) return {minX:-24,minY:-32,maxX:24,maxY:32};
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const sh of sym.draw) {
    const pts = sh.t==='l' ? [[sh.x1,sh.y1],[sh.x2,sh.y2]]
              : sh.t==='e' ? [[sh.cx-sh.rx,sh.cy-sh.ry],[sh.cx+sh.rx,sh.cy+sh.ry]]
              : sh.t==='r' ? [[sh.x,sh.y],[sh.x+sh.w,sh.y+sh.h]]
              : sh.t==='a' ? [[sh.cx-sh.rx,sh.cy-sh.ry],[sh.cx+sh.rx,sh.cy+sh.ry]] : [];
    for (const [x,y] of pts) { minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); }
  }
  return {minX,minY,maxX,maxY};
}

// Free-side label placement.
// Returns {lx, ly, anchor} where anchor is SVG text-anchor value.
// Algorithm:
//   1. For each pin in local coords, compute world-space direction from symbol body center.
//   2. Classify each pin as pointing LEFT/RIGHT/UP/DOWN.
//   3. Place label on the FIRST side with no pin, in preference order: RIGHT > LEFT > DOWN > UP.
function _labelPos(s) {
  const key = _symKey(s);
  const sym = key ? SYM_DRAW[key] : null;
  const rot = s.rot || 'R0';
  const [a,b,c,d] = ROT_MAT[rot] || ROT_MAT['R0'];

  if (!sym || !sym.pins || sym.pins.length === 0) {
    return {lx: s.x + 36, ly: s.y, anchor: 'start'};
  }

  // Shape bounding box in local coords → local center
  const bb = _symBbox(key);
  const lcx = (bb.minX + bb.maxX) / 2;
  const lcy = (bb.minY + bb.maxY) / 2;

  // Classify occupied sides
  const R=0, L=1, D=2, U=3;
  const occupied = new Set();
  for (const p of sym.pins) {
    const dx_l = p.x - lcx;
    const dy_l = p.y - lcy;
    // Rotate direction vector the same way as shape coords
    const dx_w = a*dx_l + c*dy_l;
    const dy_w = b*dx_l + d*dy_l;
    if (Math.abs(dx_w) >= Math.abs(dy_w)) {
      occupied.add(dx_w >= 0 ? R : L);
    } else {
      occupied.add(dy_w >= 0 ? D : U);
    }
  }

  // World bounding box: transform all 4 corners of local bbox
  const corners = [[bb.minX,bb.minY],[bb.maxX,bb.minY],[bb.minX,bb.maxY],[bb.maxX,bb.maxY]];
  let wxMin=1e9, wxMax=-1e9, wyMin=1e9, wyMax=-1e9;
  for (const [lx,ly] of corners) {
    const wx = s.x + a*lx + c*ly;
    const wy = s.y + b*lx + d*ly;
    wxMin=Math.min(wxMin,wx); wxMax=Math.max(wxMax,wx);
    wyMin=Math.min(wyMin,wy); wyMax=Math.max(wyMax,wy);
  }
  const wcx = (wxMin+wxMax)/2;
  const wcy = (wyMin+wyMax)/2;
  const PAD = 10;

  // Find first free side in preference order
  for (const side of [R, L, D, U]) {
    if (!occupied.has(side)) {
      if (side === R) return {lx: wxMax+PAD,   ly: wcy+4,        anchor:'start'};
      if (side === L) return {lx: wxMin-PAD,   ly: wcy+4,        anchor:'end'};
      if (side === D) return {lx: wcx,         ly: wyMax+PAD+10, anchor:'middle'};
      if (side === U) return {lx: wcx,         ly: wyMin-PAD,    anchor:'middle'};
    }
  }
  // All sides occupied (3-pin component): place right anyway
  return {lx: wxMax+PAD, ly: wcy+4, anchor:'start'};
}

// Render one symbol using .asy-parsed draw commands
function _renderSym(s) {
  const resolvedKey = _symKey(s);
  const m = _svgMat(s.rot);
  let g = `<g transform="translate(${s.x},${s.y}) ${m}">`;
  const SK = '#1a3a8a';

  const shapes = resolvedKey ? _drawShapes(resolvedKey) : null;
  if (shapes !== null) {
    g += shapes;
  } else {
    // Unknown: labeled box
    g += `<rect x="-24" y="-32" width="48" height="64" rx="4" stroke="${SK}" fill="#e8eef8" stroke-width="1.5"/>`;
    g += `<text x="0" y="4" text-anchor="middle" font-size="9" font-family="ui-monospace,monospace" fill="${SK}">${_esc(s.key)}</text>`;
  }
  g += '</g>';

  // Free-side label placement: put label on the side of the symbol body with no outgoing pins.
  const {lx, ly, anchor} = _labelPos(s);
  const isSrc = resolvedKey==='voltage'||resolvedKey==='current';
  if (s.name)  g += `<text x="${lx}" y="${ly}"    text-anchor="${anchor}" font-size="10" font-family="ui-monospace,monospace" font-weight="600" fill="#122060">${_esc(s.name)}</text>`;
  if (s.value && !isSrc) g += `<text x="${lx}" y="${ly+14}" text-anchor="${anchor}" font-size="9"  font-family="ui-monospace,monospace" fill="#3a5a80">${_esc(s.value)}</text>`;
  if (s.value && isSrc)  g += `<text x="${lx}" y="${ly+14}" text-anchor="${anchor}" font-size="8"  font-family="ui-monospace,monospace" fill="#3a5a80" opacity="0.7">${_esc(s.value.split('(')[0])}</text>`;
  return g;
}

function _esc(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Main render ────────────────────────────────────────────────────────────
let _pz = null;  // pan/zoom state

export function renderSchematic(ascText) {
  if (ascText) lastAsc = ascText;
  if (_ascViewMode !== "visual") return;
  const svg = document.getElementById('schsvg');
  if (!svg || !ascText) return;

  const data = _parseAscR(ascText);
  const bb   = _bbox(data);

  svg.setAttribute('viewBox', `${bb.x} ${bb.y} ${bb.w} ${bb.h}`);

  let html = '';

  // Background grid (16-unit)
  html += `<defs>
    <pattern id="g16" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
      <path d="M16,0 L0,0 0,16" fill="none" stroke="#e4e4dc" stroke-width="0.4"/>
    </pattern>
    <marker id="none" markerWidth="0" markerHeight="0"/>
  </defs>`;
  html += `<rect x="${bb.x}" y="${bb.y}" width="${bb.w}" height="${bb.h}" fill="url(#g16)"/>`;

  // Wires
  for (const w of data.wires) {
    html += `<line x1="${w[0]}" y1="${w[1]}" x2="${w[2]}" y2="${w[3]}" stroke="#1a3a8a" stroke-width="1.5" stroke-linecap="round"/>`;
  }

  // Junctions
  for (const j of data.junctions) {
    html += `<circle cx="${j[0]}" cy="${j[1]}" r="4.5" fill="#1a3a8a"/>`;
  }

  // Symbols
  for (const s of data.syms) {
    html += _renderSym(s);
  }

  // Flags (net labels / ground / power)
  const GND_NAMES  = new Set(['0','gnd','agnd','dgnd','pgnd']);
  const VCC_NAMES  = new Set(['vcc','vdd','v+','vp','vpos','pwr','vcc!','vdd!']);
  const VEE_NAMES  = new Set(['vee','vss','v-','vm','vneg','vee!','vss!']);

  for (const f of data.flags) {
    const fn = (f.name||'').toLowerCase().replace(/[\s!]/g,'');
    if (GND_NAMES.has(fn) || fn === '0') {
      // Ground bars
      html += `<g transform="translate(${f.x},${f.y})">
        <line x1="0" y1="0" x2="0" y2="10" stroke="#1a3a8a" stroke-width="1.5"/>
        <line x1="-14" y1="10" x2="14" y2="10" stroke="#1a3a8a" stroke-width="1.5"/>
        <line x1="-9"  y1="17" x2="9"  y2="17" stroke="#1a3a8a" stroke-width="1.5"/>
        <line x1="-4"  y1="24" x2="4"  y2="24" stroke="#1a3a8a" stroke-width="1.5"/>
      </g>`;
    } else if (VCC_NAMES.has(fn)) {
      // VCC: upward-pointing arrow head (filled triangle) on a stem — unmistakably a power rail
      html += `<g transform="translate(${f.x},${f.y})">
        <line x1="0" y1="0" x2="0" y2="-14" stroke="#1a3a8a" stroke-width="1.5"/>
        <polygon points="0,-28 -10,-14 10,-14" fill="#1a3a8a"/>
        <text x="13" y="-16" font-size="9" font-family="ui-monospace,monospace" fill="#1a3a8a" font-weight="600">${_esc(f.name)}</text>
      </g>`;
    } else if (VEE_NAMES.has(fn)) {
      // VEE/VSS: downward-pointing arrow head — mirror of VCC
      html += `<g transform="translate(${f.x},${f.y})">
        <line x1="0" y1="0" x2="0" y2="14" stroke="#1a3a8a" stroke-width="1.5"/>
        <polygon points="0,28 -10,14 10,14" fill="#1a3a8a"/>
        <text x="13" y="28" font-size="9" font-family="ui-monospace,monospace" fill="#1a3a8a" font-weight="600">${_esc(f.name)}</text>
      </g>`;
    } else {
      // Generic net label with small pin dot
      html += `<circle cx="${f.x}" cy="${f.y}" r="2.5" fill="#1a3a8a"/>`;
      html += `<text x="${f.x+6}" y="${f.y+4}" font-size="10" font-family="ui-monospace,monospace" fill="#1a3a8a" font-weight="500">${_esc(f.name)}</text>`;
    }
  }

  svg.innerHTML = html;

  // Pan/zoom
  _pz = {svg, vb:{x:bb.x, y:bb.y, w:bb.w, h:bb.h}, orig:{x:bb.x, y:bb.y, w:bb.w, h:bb.h}, drag:null};
  svg.onwheel = _pzWheel;
  svg.onmousedown = _pzDown;
  svg.onmousemove = _pzMove;
  svg.onmouseup   = _pzUp;
  svg.onmouseleave= _pzUp;
  svg.ondblclick  = _pzReset;
}

function _pzWheel(e) {
  e.preventDefault();
  if (!_pz) return;
  const {svg,vb} = _pz;
  const r = svg.getBoundingClientRect();
  const cx = vb.x + ((e.clientX-r.left)/r.width)  * vb.w;
  const cy = vb.y + ((e.clientY-r.top) /r.height) * vb.h;
  const f  = e.deltaY < 0 ? 0.82 : 1/0.82;
  vb.w *= f; vb.h *= f;
  vb.x = cx - ((e.clientX-r.left)/r.width)  * vb.w;
  vb.y = cy - ((e.clientY-r.top) /r.height) * vb.h;
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
}
function _pzDown(e) {
  if (!_pz) return;
  _pz.drag = {cx:e.clientX, cy:e.clientY, ox:_pz.vb.x, oy:_pz.vb.y};
  _pz.svg.style.cursor='grabbing';
}
function _pzMove(e) {
  if (!_pz || !_pz.drag) return;
  const {svg,vb,drag} = _pz;
  const r = svg.getBoundingClientRect();
  vb.x = drag.ox - (e.clientX-drag.cx) * (vb.w/r.width);
  vb.y = drag.oy - (e.clientY-drag.cy) * (vb.h/r.height);
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
}
function _pzUp()    { if(_pz){_pz.drag=null; _pz.svg.style.cursor='grab';} }
function _pzReset() {
  if (!_pz) return;
  const {svg, orig} = _pz;
  _pz.vb = {x:orig.x, y:orig.y, w:orig.w, h:orig.h};
  svg.setAttribute('viewBox', `${orig.x} ${orig.y} ${orig.w} ${orig.h}`);
}
// ═══════════════════════════════════════════════════════════════════════════

// >>> symValueAttrs — moved from convert.js
// slot-aware SYMATTR emission for the generated .asc
export function symValueAttrs(at, name, value){
  const out=[];
  if (!value) return out;
  const isX = /^X/i.test(name) && at && at.Prefix === 'X';
  if (isX){
    const sp = value.indexOf(' ');
    const sub = sp<0 ? value : value.slice(0,sp);
    const tail = sp<0 ? '' : value.slice(sp+1).trim();
    const norm = s => String(s||'').trim().replace(/\s+/g,' ').toLowerCase();
    const fileLayout = at.SpiceModel && /\.(sub|lib)$/i.test(at.SpiceModel);
    const flatParts = fileLayout
      ? [at.Value2, at.SpiceLine, at.SpiceLine2]
      : [at.SpiceModel, at.Value, at.Value2, at.SpiceLine, at.SpiceLine2];
    const flat = flatParts.filter(Boolean).join(' ');
    if (norm(flat) === norm(value)){ /* symbol defaults ARE the card */ }
    else
    if (fileLayout){
      const card = (sub + (tail?' '+tail:'')).trim();
      if (norm(at.Value2) !== norm(card)) out.push(`SYMATTR Value2 ${card}`);
    } else if (at.SpiceModel){
      if (norm(at.SpiceModel) !== norm(sub)) out.push(`SYMATTR SpiceModel ${sub}`);
      if (tail){
        for (const slot of ['Value','Value2','SpiceLine','SpiceLine2'])
          if (at[slot] !== undefined && norm(at[slot]) !== norm(tail))
            out.push(`SYMATTR ${slot} ${tail}`);
        if (at.Value === undefined && at.Value2 === undefined &&
            at.SpiceLine === undefined && at.SpiceLine2 === undefined)
          out.push(`SYMATTR Value ${tail}`);
      }
    } else {
      if (norm(at.Value) !== norm(sub)) out.push(`SYMATTR Value ${sub}`);
      if (tail){
        for (const slot of ['Value2','SpiceLine','SpiceLine2'])
          if (at[slot] !== undefined && norm(at[slot]) !== norm(tail))
            out.push(`SYMATTR ${slot} ${tail}`);
        if (at.Value2 === undefined && at.SpiceLine === undefined && at.SpiceLine2 === undefined)
          out.push(`SYMATTR Value2 ${tail}`);
      }
    }
  } else {
    const m = value.match(/^(.*?)(\s+AC\s+.*)?$/i);
    out.push(`SYMATTR Value ${m[1]}`);
    if (m[2]) out.push(`SYMATTR Value2 ${m[2].trim()}`);
  }
  return out;
}
// <<< symValueAttrs

// >>> emitAsc — moved from convert.js
export function emitAsc(comps, wires, flags, directives){
  const L=['Version 4','SHEET 1 1200 800'];
  for (const w of wires) if (w[0]!==w[2]||w[1]!==w[3]) L.push(`WIRE ${w[0]} ${w[1]} ${w[2]} ${w[3]}`);
  for (const f of flags) L.push(`FLAG ${f[0]} ${f[1]} ${f[2]}`);
  for (const c of comps){
    L.push(`SYMBOL ${c.sym} ${c.origin[0]} ${c.origin[1]} ${c.rot}`);
    if (c.nets.length===2 && c.rot!=='R0' && !NOROT){
      const b = SYMBOLS[c.sym].bbox;
      const my = Math.round((b[1]+b[3])/2/8)*8;
      const w = SYMBOLS[c.sym].windows || {};
      const d0 = w['0']||[36,40,'Left'], d3 = w['3']||[36,76,'Left'];
      if (c.rot==='R90' || c.rot==='R270'){
        const vlen = Math.min((''+(c.value||'')).length, 24)*16;
        const below = rot(c.rot==='R90' ? [b[2],my] : [b[0],my], c.rot);
        const bax = c.origin[0]+below[0], bay = c.origin[1]+below[1];
        const box = [bax-vlen/2, bay, bax+vlen/2, bay+28];
        const hit = wires.some(w=>{
          const x1=Math.min(w[0],w[2]), x2=Math.max(w[0],w[2]);
          const y1=Math.min(w[1],w[3]), y2=Math.max(w[1],w[3]);
          return !(x2<box[0]||x1>box[2]||y2<box[1]||y1>box[3]);
        });
        if (c.rot==='R90'){
          L.push(`WINDOW 0 ${b[0]} ${my} VBottom 2`);
          L.push(hit ? `WINDOW 3 ${b[0]-32} ${my} VBottom 2`
                     : `WINDOW 3 ${b[2]} ${my} VTop 2`);
        } else {
          L.push(`WINDOW 0 ${b[2]} ${my} VTop 2`);
          L.push(hit ? `WINDOW 3 ${b[2]+32} ${my} VTop 2`
                     : `WINDOW 3 ${b[0]} ${my} VBottom 2`);
        }
      } else if (c.rot==='R180'){
        L.push(`WINDOW 0 ${d3[0]} ${d3[1]} Left 2`);
        L.push(`WINDOW 3 ${d0[0]} ${d0[1]} Left 2`);
      }
    }
    L.push(`SYMATTR InstName ${c.name}`);
    for (const a of symValueAttrs((SYMBOLS[c.sym]||{}).attrs, c.name, c.value)) L.push(a);
  }
  let ty = Math.max(0,...comps.map(c=>c.y+(c.rbb[3]-c.rbb[1])))+64;
  for (const d of directives){ L.push(`TEXT 0 ${ty} Left 2 !${d}`); ty+=32; }
  return L.join('\n')+'\n';
}
// <<< emitAsc
