'use strict';
// ── Symbol library & resolution ───────────────────────────────────────────
// SYMBOLS: pin tables verified against evenator/LTSpice-Libraries sym/*.asy
// Provides: symbol lookup, subckt→symbol resolution, synthetic block emission.

/* global SYMTABLE */

// Pin tables verified against evenator/LTSpice-Libraries sym/*.asy (fetched 2026-07-02)
// entries: pins (SpiceOrder-sorted LTspice offsets), grid-rounded bbox, body geometry
export const SYMBOLS = SYMTABLE;

// X subckt name -> symbol key (case-insensitive on the .asy base name)
export const SUBCKT2SYM = {};
for (const k of Object.keys(SYMBOLS)) SUBCKT2SYM[k.split('\\').pop().toLowerCase()] = k;

export const PREFIX2SYM = { R:'res', C:'cap', L:'ind', V:'voltage', I:'current', D:'diode' };

// ── Synthetic rectangular block ───────────────────────────────────────────
// For a known part whose .asy pin count differs from the netlist call.
// Pins split down the two vertical sides by SpiceOrder; connectivity exact.
export function genericBlock(npins){
  const key='__block'+npins;
  if (SYMBOLS[key]) return key;
  const perSide=Math.ceil(npins/2);
  const H=Math.max(96, perSide*48);
  const pins=[], ord=[];
  for (let i=0;i<npins;i++){
    const left=i<perSide;
    const idx=left?i:(i-perSide);
    const cnt=left?perSide:(npins-perSide);
    const y=Math.round((H*(idx+0.5)/cnt)/16)*16;
    pins.push([left?-64:64, y]); ord.push(i+1);
  }
  SYMBOLS[key]={pins, ord, bbox:[-64,0,64,Math.round(H/16)*16], synthetic:true};
  return key;
}

// Companion .asy source for a synthetic block so the generated .asc opens in
// LTspice with no library edits: written next to the .asc, resolved from the
// schematic's own directory. Pin coords reproduce genericBlock() exactly.
export function blockAsySource(npins){
  const perSide=Math.ceil(npins/2);
  const H=Math.max(96, perSide*48);
  const Hs=Math.round(H/16)*16;
  const L=['Version 4','SymbolType CELL',
    `RECTANGLE Normal -64 0 64 ${Hs}`,
    'WINDOW 0 0 -8 Bottom 2',
    `WINDOW 3 0 ${Hs+8} Top 2`,
    'SYMATTR Prefix X'];
  for (let i=0;i<npins;i++){
    const left=i<perSide;
    const idx=left?i:(i-perSide);
    const cnt=left?perSide:(npins-perSide);
    const y=Math.round((H*(idx+0.5)/cnt)/16)*16;
    L.push(`PIN ${left?-64:64} ${y} ${left?'LEFT':'RIGHT'} 8`);
    L.push(`PINATTR PinName P${i+1}`);
    L.push(`PINATTR SpiceOrder ${i+1}`);
  }
  return L.join('\n')+'\n';
}

// Scan an emitted .asc for synthetic blocks; return {filename: asySource}
// for every distinct __blockN used — write these next to the .asc file.
export function blockAsyFiles(asc){
  const out={};
  for (const ln of asc.split(/\r?\n/)){
    const m = ln.trim().match(/^SYMBOL\s+(__block(\d+))\s/);
    if (m && !out[m[1]+'.asy']) out[m[1]+'.asy'] = blockAsySource(+m[2]);
  }
  return out;
}

// ── Symbol resolution ─────────────────────────────────────────────────────
let NAME2SYM = null, MODEL2SYM = null, CARD2SYM = null;

export function buildResolveMaps(){
  NAME2SYM = {}; MODEL2SYM = {}; CARD2SYM = {};
  for (const key of Object.keys(SYMBOLS)){
    const e = SYMBOLS[key];
    const base = key.split('\\').pop().toLowerCase();
    const pref = (a,b)=> (a===undefined) || (SYMBOLS[a].retired && !SYMBOLS[b].retired);
    if (pref(NAME2SYM[base], key)) NAME2SYM[base] = key;
    const at = e.attrs || {};
    if (at.SpiceModel && !/\.sub$/i.test(at.SpiceModel)){
      const m = at.SpiceModel.toLowerCase();
      if (pref(MODEL2SYM[m], key)) MODEL2SYM[m] = key;
    }
    {
      const parts = at.SpiceModel && /\.sub$/i.test(at.SpiceModel)
        ? [at.Value2, at.SpiceLine, at.SpiceLine2]
        : [at.SpiceModel, at.Value, at.Value2, at.SpiceLine, at.SpiceLine2];
      const card = parts.filter(Boolean).join(' ').trim().replace(/\s+/g,' ').toLowerCase();
      if (card && pref(CARD2SYM[card], key)) CARD2SYM[card] = key;
    }
  }
}

export function resolveSub(sub, npins, tail){
  const q = sub.toLowerCase();
  const ok = k => k && SYMBOLS[k].pins.length===npins ? k : null;
  if (!NAME2SYM) buildResolveMaps();
  if (tail !== undefined){
    const card = (sub + (tail ? ' ' + tail : '')).trim().replace(/\s+/g,' ').toLowerCase();
    const kc = ok(CARD2SYM[card]); if (kc) return kc;
  }
  let k = ok(SUBCKT2SYM[q]); if (k) return k;
  const km = ok(MODEL2SYM[q]); if (km) return km;
  k = ok(NAME2SYM[q]); if (k) return k;
  if (q.includes('/')) { k = ok(SUBCKT2SYM[q.split('/')[0]]); if (k) return k; }
  const m = q.match(/^([a-z]+\d+[a-z]?(?:-[\d.]+)?)/);
  if (m){ k = ok(SUBCKT2SYM[m[1]]); if (k) return k; }
  for (const b of Object.keys(SUBCKT2SYM)){
    if (b.length>=5 && q.startsWith(b)){ k = ok(SUBCKT2SYM[b]); if (k) return k; }
  }
  for (const suf of ['a','b','c','d','-1','-2','-3','-5']){
    k = ok(SUBCKT2SYM[q+suf]); if (k) return k;
  }
  const base = q.match(/^([a-z]+\d+[a-z]?(?:-[\d.]+)?)/);
  let known = SUBCKT2SYM[q] || (base && SUBCKT2SYM[base[1]]);
  if (!known) for (const suf of ['a','b','c','d']){ if (SUBCKT2SYM[q+suf]){ known=SUBCKT2SYM[q+suf]; break; } }
  if (known) return genericBlock(npins);
  return null;
}
