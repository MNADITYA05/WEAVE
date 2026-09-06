/**
 * renderer.ts — ASC text → SVG schematic renderer + emitAsc() pure emitter
 *
 * Pure exports (no DOM):
 *   emitAsc()         — Converts placed components + wires + flags → ASC text
 *   symValueAttrs()   — Slot-aware SYMATTR line generation
 *
 * DOM exports (requires browser):
 *   setAscView()      — Switches between text/visual view modes
 *   renderSchematic() — Renders SVG schematic from ASC text
 */

import { rot, ROT_MAT, _svgMat } from '../shared/geometry.js';
import { NOROT } from './orientation.js';
import { SYMBOLS, SYM_DRAW, SUBCKT2SYM, SYM_PIN_NAMES, prewarmFullSymDraw, getFullSymDrawSync } from './symbols.js';
import type { SvgShape } from './symbols.js';
import type { RotCode } from '../types.js';

// ─── Internal types ───────────────────────────────────────────────────────────

interface RenderSym {
  full: string; key: string;
  x: number; y: number; rot: string;
  name: string | null; value: string | null;
}

interface RenderWire  { 0: number; 1: number; 2: number; 3: number }
interface RenderFlag  { x: number; y: number; name: string }
interface RenderData  {
  wires:     number[][];
  flags:     RenderFlag[];
  syms:      RenderSym[];
  junctions: [number, number][];
}

/** Component as emitted by the layout stage — minimal fields needed for emitAsc */
interface EmitComp {
  sym:    string;
  name:   string;
  value?: string;
  rot:    string;
  origin: [number, number];
  x:      number;
  y:      number;
  rbb:    [number, number, number, number];
  nets:   string[];
}

interface PzState {
  svg: SVGSVGElement;
  vb:  { x: number; y: number; w: number; h: number };
  orig:{ x: number; y: number; w: number; h: number };
  drag:{ cx: number; cy: number; ox: number; oy: number } | null;
}

// ─── Module state (DOM) ───────────────────────────────────────────────────────

let _ascViewMode = 'text';
let _lastAsc     = '';
let _pz: PzState | null = null;

// ─── setAscView ───────────────────────────────────────────────────────────────

export function setAscView(mode: string): void {
  _ascViewMode = mode;
  const av = document.getElementById('ascview') as HTMLElement;
  const sv = document.getElementById('svgview') as HTMLElement;
  av.style.display = mode === 'text' ? '' : 'none';
  if (mode === 'visual') {
    sv.classList.add('vis-on');
    if (_lastAsc) void renderSchematic(_lastAsc);
  } else {
    sv.classList.remove('vis-on');
  }
  (document.getElementById('btn-textv') as HTMLElement).classList.toggle('active', mode === 'text');
  (document.getElementById('btn-visv')  as HTMLElement).classList.toggle('active', mode === 'visual');
}

// ─── Internal rendering helpers ───────────────────────────────────────────────

function _parseAscR(text: string): RenderData {
  const wires: number[][] = [], flags: RenderFlag[] = [];
  const syms: RenderSym[] = [], junctions: [number, number][] = [];
  let cur: RenderSym | null = null;

  for (const ln of text.split(/\r?\n/)) {
    const t = ln.trim().split(/\s+/);
    if (!t[0]) continue;
    if (t[0] === 'WIRE') {
      wires.push(t.slice(1, 5).map(Number));
    } else if (t[0] === 'FLAG') {
      flags.push({ x: +t[1]!, y: +t[2]!, name: t[3] ?? '?' });
    } else if (t[0] === 'JUNCTION') {
      junctions.push([+t[1]!, +t[2]!]);
    } else if (t[0] === 'SYMBOL') {
      const symFull = t[1] ?? '';
      const symKey  = symFull.split('\\').pop()!.toLowerCase();
      cur = { full: symFull, key: symKey, x: +t[2]!, y: +t[3]!, rot: t[4] ?? 'R0', name: null, value: null };
      syms.push(cur);
    } else if (t[0] === 'SYMATTR' && cur) {
      if (t[1] === 'InstName') cur.name  = t.slice(2).join(' ');
      else if (t[1] === 'Value') cur.value = t.slice(2).join(' ');
    }
  }
  return { wires, flags, syms, junctions };
}

function _bbox(data: RenderData): { x: number; y: number; w: number; h: number } {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const exp = (x: number, y: number): void => {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  };
  for (const w of data.wires)   { exp(w[0]!, w[1]!); exp(w[2]!, w[3]!); }
  for (const f of data.flags)   exp(f.x, f.y);
  for (const s of data.syms)    { exp(s.x - 80, s.y - 80); exp(s.x + 80, s.y + 80); }
  for (const j of data.junctions) exp(j[0], j[1]);
  if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 400; y1 = 400; }
  const pad = 48;
  return { x: x0 - pad, y: y0 - pad, w: (x1 - x0) + 2 * pad, h: (y1 - y0) + 2 * pad };
}

const OPAMP_ALIASES = new Set([
  'opamp','op27','op37','op07','opa','lm741','lm324','lm358',
  'tl071','tl072','tl081','tl082','ua741','ne5534','ad8061','ltc',
  'ad797','opa627','opa2134','ina128','instrumentation',
]);

function _symKey(s: RenderSym): string | null {
  const k = s.key;
  if (SYM_DRAW[k]) return k;
  for (const a of OPAMP_ALIASES) { if (k.includes(a)) return 'opamp'; }
  return null;
}

/** Renders a DIP IC block for a symtable-matched component in the visual view.
 *  Pin stub endpoints use the actual symtable pin coordinates so they align
 *  with routed wires (which also use entry.pins via decorateComponents). */
function _renderIcBlock(s: RenderSym): string {
  const symKey   = SUBCKT2SYM[s.key];
  const entry    = symKey ? SYMBOLS[symKey] : null;
  const base     = s.key.split('\\').pop()!;
  const SK       = '#1a3a8a';
  const m        = _svgMat(s.rot as RotCode);
  // sym-pin-names key: 'Misc\\NE555' → 'misc/ne555'
  const fdKey    = symKey ? symKey.replace(/\\/g, '/').toLowerCase() : null;
  const pinNames = fdKey ? (SYM_PIN_NAMES[fdKey] ?? null) : null;

  if (entry && entry.pins.length > 0) {
    // ── Use actual symtable pin positions (same coords the router uses) ──────
    const pins = entry.pins as [number, number][];
    const xs   = pins.map(p => p[0]);
    const ys   = pins.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const midX = (minX + maxX) / 2;

    // Body rect sits between the two pin columns, padded inward
    const BODY_INSET = 8;
    const leftPinX  = Math.max(...xs.filter(x => x <= midX));
    const rightPinX = Math.min(...xs.filter(x => x >  midX));
    const bodyL = leftPinX  + BODY_INSET;
    const bodyR = rightPinX - BODY_INSET;
    const bodyT = minY - BODY_INSET;
    const bodyB = maxY + BODY_INSET;
    const bodyCX = (bodyL + bodyR) / 2;
    const bodyCY = (bodyT + bodyB) / 2;

    // ── Try real LTspice geometry from sym-draw-full (pre-warmed cache) ──────
    const fullShapes: SvgShape[] | null = fdKey ? getFullSymDrawSync(fdKey) : null;

    let g = `<g transform="translate(${s.x},${s.y}) ${m}">`;

    if (fullShapes && fullShapes.length > 0) {
      // Render real LTspice symbol geometry
      for (const sh of fullShapes) {
        if (sh.t === 'line') {
          g += `<line x1="${sh.x1}" y1="${sh.y1}" x2="${sh.x2}" y2="${sh.y2}" stroke="${SK}" stroke-width="1.5" stroke-linecap="round"/>`;
        } else if (sh.t === 'ellipse') {
          g += `<ellipse cx="${sh.cx}" cy="${sh.cy}" rx="${sh.rx}" ry="${sh.ry}" stroke="${SK}" fill="none" stroke-width="1.5"/>`;
        } else if (sh.t === 'rect') {
          g += `<rect x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" stroke="${SK}" fill="#e8eef8" stroke-width="1.5"/>`;
        } else if (sh.t === 'arc') {
          const d = `M${sh.x1!.toFixed(2)},${sh.y1!.toFixed(2)} A${sh.rx},${sh.ry} 0 ${sh.large},${sh.sweep} ${sh.x2!.toFixed(2)},${sh.y2!.toFixed(2)}`;
          g += `<path d="${d}" stroke="${SK}" fill="none" stroke-width="1.5" stroke-linecap="round"/>`;
        }
      }
    } else {
      // Fallback: plain rectangle body with label
      g += `<rect x="${bodyL}" y="${bodyT}" width="${bodyR - bodyL}" height="${bodyB - bodyT}" rx="3" stroke="${SK}" fill="#e8eef8" stroke-width="1.5"/>`;
      g += `<text x="${bodyCX}" y="${bodyCY + 3}" text-anchor="middle" font-size="8" font-family="ui-monospace,monospace" fill="${SK}">${_esc(base.toUpperCase())}</text>`;
    }

    // Pin stubs: line from actual pin coord to body edge
    // Label with real pin name (from LTspice .asy) if available, else pin number
    pins.forEach((p, i) => {
      const [px, py] = p;
      const isLeft   = px <= midX;
      const edgeX    = isLeft ? bodyL : bodyR;
      const label    = pinNames?.[String(i)] ?? String((entry.ord && entry.ord[i] != null) ? entry.ord[i] : i + 1);
      g += `<line x1="${px}" y1="${py}" x2="${edgeX}" y2="${py}" stroke="${SK}" stroke-width="1.2"/>`;
      const tx = isLeft ? edgeX + 3 : edgeX - 3;
      const anchor = isLeft ? 'start' : 'end';
      g += `<text x="${tx}" y="${py + 3}" font-size="6" font-family="ui-monospace,monospace" fill="${SK}" text-anchor="${anchor}">${_esc(label)}</text>`;
    });

    g += '</g>';

    // Ref / value labels outside the block (upper-right of body)
    const lx = s.x + rightPinX + 6;
    const ly = s.y + bodyT;
    if (s.name)  g += `<text x="${lx}" y="${ly}" font-size="10" font-family="ui-monospace,monospace" font-weight="600" fill="#122060">${_esc(s.name)}</text>`;
    if (s.value) g += `<text x="${lx}" y="${ly + 13}" font-size="9" font-family="ui-monospace,monospace" fill="#3a5a80">${_esc(s.value)}</text>`;
    return g;
  }

  // ── Fallback: generic DIP layout (no symtable entry) ─────────────────────
  const N          = 8;
  const leftCount  = Math.ceil(N / 2);
  const rightCount = N - leftCount;
  const ROW_H      = 20;
  const H          = Math.max(48, leftCount * ROW_H);
  const BODY_W     = 64;
  const STUB       = 16;
  const HW         = BODY_W / 2;

  let g = `<g transform="translate(${s.x},${s.y}) ${m}">`;
  g += `<rect x="${-HW}" y="${-H / 2}" width="${BODY_W}" height="${H}" rx="3" stroke="${SK}" fill="#e8eef8" stroke-width="1.5"/>`;
  g += `<text x="0" y="4" text-anchor="middle" font-size="8" font-family="ui-monospace,monospace" fill="${SK}">${_esc(base.toUpperCase())}</text>`;
  for (let i = 0; i < leftCount; i++) {
    const y = -H / 2 + ROW_H / 2 + i * ROW_H;
    g += `<line x1="${-HW - STUB}" y1="${y}" x2="${-HW}" y2="${y}" stroke="${SK}" stroke-width="1.2"/>`;
    g += `<text x="${-HW + 3}" y="${y + 3}" font-size="6" font-family="ui-monospace,monospace" fill="${SK}">${i + 1}</text>`;
  }
  for (let i = 0; i < rightCount; i++) {
    const y = -H / 2 + ROW_H / 2 + i * ROW_H;
    g += `<line x1="${HW}" y1="${y}" x2="${HW + STUB}" y2="${y}" stroke="${SK}" stroke-width="1.2"/>`;
    g += `<text x="${HW - 3}" y="${y + 3}" font-size="6" font-family="ui-monospace,monospace" fill="${SK}" text-anchor="end">${N - i}</text>`;
  }
  g += '</g>';
  const lx = s.x + HW + STUB + 4;
  const ly = s.y - H / 2 - 4;
  if (s.name)  g += `<text x="${lx}" y="${ly}" font-size="10" font-family="ui-monospace,monospace" font-weight="600" fill="#122060">${_esc(s.name)}</text>`;
  if (s.value) g += `<text x="${lx}" y="${ly + 13}" font-size="9" font-family="ui-monospace,monospace" fill="#3a5a80">${_esc(s.value)}</text>`;
  return g;
}

function _drawShapes(key: string): string {
  const sym = SYM_DRAW[key];
  if (!sym?.draw) return '';
  const SK = '#1a3a8a';
  let g = '';
  for (const sh of sym.draw) {
    if (sh.t === 'line') {
      g += `<line x1="${sh.x1}" y1="${sh.y1}" x2="${sh.x2}" y2="${sh.y2}" stroke="${SK}" stroke-width="1.5" stroke-linecap="round"/>`;
    } else if (sh.t === 'ellipse') {
      g += `<ellipse cx="${sh.cx}" cy="${sh.cy}" rx="${sh.rx}" ry="${sh.ry}" stroke="${SK}" fill="none" stroke-width="1.5"/>`;
    } else if (sh.t === 'rect') {
      g += `<rect x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" stroke="${SK}" fill="none" stroke-width="1.5"/>`;
    } else if (sh.t === 'arc') {
      const d = `M${sh.x1!.toFixed(2)},${sh.y1!.toFixed(2)} A${sh.rx},${sh.ry} 0 ${sh.large},${sh.sweep} ${sh.x2!.toFixed(2)},${sh.y2!.toFixed(2)}`;
      g += `<path d="${d}" stroke="${SK}" fill="none" stroke-width="1.5" stroke-linecap="round"/>`;
    }
  }
  return g;
}

function _symBbox(key: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const sym = SYM_DRAW[key];
  if (!sym?.draw) return { minX: -24, minY: -32, maxX: 24, maxY: 32 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sh of sym.draw) {
    const pts: [number, number][] =
      sh.t === 'line' ? [[sh.x1!, sh.y1!], [sh.x2!, sh.y2!]]
    : sh.t === 'ellipse' ? [[sh.cx! - sh.rx!, sh.cy! - sh.ry!], [sh.cx! + sh.rx!, sh.cy! + sh.ry!]]
    : sh.t === 'rect' ? [[sh.x!, sh.y!], [sh.x! + sh.w!, sh.y! + sh.h!]]
    : sh.t === 'arc' ? [[sh.cx! - sh.rx!, sh.cy! - sh.ry!], [sh.cx! + sh.rx!, sh.cy! + sh.ry!]]
    : [];
    for (const [x, y] of pts) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function _labelPos(s: RenderSym): { lx: number; ly: number; anchor: string } {
  const key = _symKey(s);
  const sym  = key ? SYM_DRAW[key] : null;
  const r    = s.rot as RotCode;
  const mat  = ROT_MAT[r] ?? ROT_MAT['R0']!;
  const [a, b, c, d] = mat;

  if (!sym?.pins?.length) return { lx: s.x + 36, ly: s.y, anchor: 'start' };

  const bb   = _symBbox(key!);
  const lcx  = (bb.minX + bb.maxX) / 2;
  const lcy  = (bb.minY + bb.maxY) / 2;

  const R = 0, L = 1, D = 2, U = 3;
  const occupied = new Set<number>();
  for (const p of sym.pins) {
    const dxL = p.x - lcx, dyL = p.y - lcy;
    const dxW = a! * dxL + c! * dyL;
    const dyW = b! * dxL + d! * dyL;
    if (Math.abs(dxW) >= Math.abs(dyW)) occupied.add(dxW >= 0 ? R : L);
    else                                occupied.add(dyW >= 0 ? D : U);
  }

  const corners: [number, number][] = [
    [bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.minX, bb.maxY], [bb.maxX, bb.maxY],
  ];
  let wxMin = 1e9, wxMax = -1e9, wyMin = 1e9, wyMax = -1e9;
  for (const [lx, ly] of corners) {
    const wx = s.x + a! * lx + c! * ly;
    const wy = s.y + b! * lx + d! * ly;
    wxMin = Math.min(wxMin, wx); wxMax = Math.max(wxMax, wx);
    wyMin = Math.min(wyMin, wy); wyMax = Math.max(wyMax, wy);
  }
  const wcx = (wxMin + wxMax) / 2, wcy = (wyMin + wyMax) / 2;
  const PAD = 10;

  for (const side of [R, L, D, U]) {
    if (!occupied.has(side)) {
      if (side === R) return { lx: wxMax + PAD, ly: wcy + 4,        anchor: 'start' };
      if (side === L) return { lx: wxMin - PAD, ly: wcy + 4,        anchor: 'end'   };
      if (side === D) return { lx: wcx,         ly: wyMax + PAD + 10, anchor: 'middle' };
      if (side === U) return { lx: wcx,         ly: wyMin - PAD,    anchor: 'middle' };
    }
  }
  return { lx: wxMax + PAD, ly: wcy + 4, anchor: 'start' };
}

function _esc(t: unknown): string {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _renderSym(s: RenderSym): string {
  const resolvedKey = _symKey(s);

  // X-prefix subcircuits that are NOT opamp aliases → DIP IC block
  // Opamp-aliased subcircuits (LM741, OP27, etc.) keep the triangle render below.
  if (resolvedKey !== 'opamp') {
    const isSubckt = !!(s.name && s.name.startsWith('X'));
    if (isSubckt) {
      const _sk = SUBCKT2SYM[s.key]; const isKnownIc = !!(_sk && SYMBOLS[_sk]);
      const isGeneric = s.key.startsWith('__block');
      if (isKnownIc || isGeneric) return _renderIcBlock(s);
    }
  }

  // IC block: unknown/unresolved non-opamp component
  if (!resolvedKey) {
    const _sk = SUBCKT2SYM[s.key]; const isKnownIc = !!(_sk && SYMBOLS[_sk]);
    const isGeneric = s.key.startsWith('__block');
    if (isKnownIc || isGeneric) return _renderIcBlock(s);
  }

  const m  = _svgMat(s.rot as RotCode);
  const SK = '#1a3a8a';
  let g = `<g transform="translate(${s.x},${s.y}) ${m}">`;

  if (resolvedKey) {
    g += _drawShapes(resolvedKey);
  } else {
    g += `<rect x="-24" y="-32" width="48" height="64" rx="4" stroke="${SK}" fill="#e8eef8" stroke-width="1.5"/>`;
    g += `<text x="0" y="4" text-anchor="middle" font-size="9" font-family="ui-monospace,monospace" fill="${SK}">${_esc(s.key)}</text>`;
  }
  g += '</g>';

  const { lx, ly, anchor } = _labelPos(s);
  const isSrc = resolvedKey === 'voltage' || resolvedKey === 'current';
  if (s.name)
    g += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-size="10" font-family="ui-monospace,monospace" font-weight="600" fill="#122060">${_esc(s.name)}</text>`;
  if (s.value && !isSrc)
    g += `<text x="${lx}" y="${ly + 14}" text-anchor="${anchor}" font-size="9" font-family="ui-monospace,monospace" fill="#3a5a80">${_esc(s.value)}</text>`;
  if (s.value && isSrc)
    g += `<text x="${lx}" y="${ly + 14}" text-anchor="${anchor}" font-size="8" font-family="ui-monospace,monospace" fill="#3a5a80" opacity="0.7">${_esc(s.value.split('(')[0])}</text>`;
  return g;
}

// ─── renderSchematic ──────────────────────────────────────────────────────────

export async function renderSchematic(ascText: string): Promise<void> {
  if (ascText) _lastAsc = ascText;
  if (_ascViewMode !== 'visual') return;
  const svg = document.getElementById('schsvg') as SVGSVGElement | null;
  if (!svg || !ascText) return;

  const data = _parseAscR(ascText);

  // Pre-warm sym-draw-full cache for all IC symbols in this schematic
  const icFdKeys = data.syms
    .map(s => {
      const symKey = SUBCKT2SYM[s.key];
      return symKey ? symKey.replace(/\\/g, '/').toLowerCase() : null;
    })
    .filter((k): k is string => k !== null);
  if (icFdKeys.length > 0) await prewarmFullSymDraw([...new Set(icFdKeys)]);
  const bb   = _bbox(data);
  svg.setAttribute('viewBox', `${bb.x} ${bb.y} ${bb.w} ${bb.h}`);

  let html = `<defs>
    <pattern id="g16" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
      <path d="M16,0 L0,0 0,16" fill="none" stroke="#e4e4dc" stroke-width="0.4"/>
    </pattern>
    <marker id="none" markerWidth="0" markerHeight="0"/>
  </defs>`;
  html += `<rect x="${bb.x}" y="${bb.y}" width="${bb.w}" height="${bb.h}" fill="url(#g16)"/>`;

  for (const w of data.wires)
    html += `<line x1="${w[0]}" y1="${w[1]}" x2="${w[2]}" y2="${w[3]}" stroke="#1a3a8a" stroke-width="1.5" stroke-linecap="round"/>`;
  for (const j of data.junctions)
    html += `<circle cx="${j[0]}" cy="${j[1]}" r="4.5" fill="#1a3a8a"/>`;
  for (const s of data.syms) html += _renderSym(s);

  const GND_NAMES = new Set(['0','gnd','agnd','dgnd','pgnd']);
  const VCC_NAMES = new Set(['vcc','vdd','v+','vp','vpos','pwr','vcc!','vdd!']);
  const VEE_NAMES = new Set(['vee','vss','v-','vm','vneg','vee!','vss!']);

  for (const f of data.flags) {
    const fn = (f.name ?? '').toLowerCase().replace(/[\s!]/g, '');
    if (GND_NAMES.has(fn) || fn === '0') {
      html += `<g transform="translate(${f.x},${f.y})">
        <line x1="0" y1="0" x2="0" y2="10" stroke="#1a3a8a" stroke-width="1.5"/>
        <line x1="-14" y1="10" x2="14" y2="10" stroke="#1a3a8a" stroke-width="1.5"/>
        <line x1="-9"  y1="17" x2="9"  y2="17" stroke="#1a3a8a" stroke-width="1.5"/>
        <line x1="-4"  y1="24" x2="4"  y2="24" stroke="#1a3a8a" stroke-width="1.5"/>
      </g>`;
    } else if (VCC_NAMES.has(fn)) {
      html += `<g transform="translate(${f.x},${f.y})">
        <line x1="0" y1="0" x2="0" y2="-14" stroke="#1a3a8a" stroke-width="1.5"/>
        <polygon points="0,-28 -10,-14 10,-14" fill="#1a3a8a"/>
        <text x="13" y="-16" font-size="9" font-family="ui-monospace,monospace" fill="#1a3a8a" font-weight="600">${_esc(f.name)}</text>
      </g>`;
    } else if (VEE_NAMES.has(fn)) {
      html += `<g transform="translate(${f.x},${f.y})">
        <line x1="0" y1="0" x2="0" y2="14" stroke="#1a3a8a" stroke-width="1.5"/>
        <polygon points="0,28 -10,14 10,14" fill="#1a3a8a"/>
        <text x="13" y="28" font-size="9" font-family="ui-monospace,monospace" fill="#1a3a8a" font-weight="600">${_esc(f.name)}</text>
      </g>`;
    } else {
      html += `<circle cx="${f.x}" cy="${f.y}" r="2.5" fill="#1a3a8a"/>`;
      html += `<text x="${f.x + 6}" y="${f.y + 4}" font-size="10" font-family="ui-monospace,monospace" fill="#1a3a8a" font-weight="500">${_esc(f.name)}</text>`;
    }
  }

  svg.innerHTML = html;

  _pz = { svg, vb: { ...bb }, orig: { ...bb }, drag: null };
  svg.onwheel      = _pzWheel;
  svg.onmousedown  = _pzDown;
  svg.onmousemove  = _pzMove;
  svg.onmouseup    = _pzUp;
  svg.onmouseleave = _pzUp;
  svg.ondblclick   = _pzReset;
}

function _pzWheel(e: WheelEvent): void {
  e.preventDefault();
  if (!_pz) return;
  const { svg, vb } = _pz;
  const r  = svg.getBoundingClientRect();
  const cx = vb.x + ((e.clientX - r.left) / r.width)  * vb.w;
  const cy = vb.y + ((e.clientY - r.top)  / r.height) * vb.h;
  const f  = e.deltaY < 0 ? 0.82 : 1 / 0.82;
  vb.w *= f; vb.h *= f;
  vb.x = cx - ((e.clientX - r.left) / r.width)  * vb.w;
  vb.y = cy - ((e.clientY - r.top)  / r.height) * vb.h;
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
}

function _pzDown(e: MouseEvent): void {
  if (!_pz) return;
  _pz.drag = { cx: e.clientX, cy: e.clientY, ox: _pz.vb.x, oy: _pz.vb.y };
  _pz.svg.style.cursor = 'grabbing';
}

function _pzMove(e: MouseEvent): void {
  if (!_pz?.drag) return;
  const { svg, vb, drag } = _pz;
  const r = svg.getBoundingClientRect();
  vb.x = drag.ox - (e.clientX - drag.cx) * (vb.w / r.width);
  vb.y = drag.oy - (e.clientY - drag.cy) * (vb.h / r.height);
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
}

function _pzUp(): void   { if (_pz) { _pz.drag = null; _pz.svg.style.cursor = 'grab'; } }
function _pzReset(): void {
  if (!_pz) return;
  const { svg, orig } = _pz;
  _pz.vb = { ...orig };
  svg.setAttribute('viewBox', `${orig.x} ${orig.y} ${orig.w} ${orig.h}`);
}

// ─── symValueAttrs (pure) ─────────────────────────────────────────────────────

type AttrMap = Record<string, string | undefined>;

export function symValueAttrs(at: AttrMap | undefined | null, name: string, value: string | undefined): string[] {
  const out: string[] = [];
  if (!value) return out;
  const isX = /^X/i.test(name) && at?.['Prefix'] === 'X';
  if (isX) {
    const sp   = value.indexOf(' ');
    const sub  = sp < 0 ? value : value.slice(0, sp);
    const tail = sp < 0 ? '' : value.slice(sp + 1).trim();
    const norm = (s: string | undefined): string => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    const fileLayout = !!(at?.['SpiceModel'] && /\.(sub|lib)$/i.test(at['SpiceModel']!));
    const flatParts = fileLayout
      ? [at?.['Value2'], at?.['SpiceLine'], at?.['SpiceLine2']]
      : [at?.['SpiceModel'], at?.['Value'], at?.['Value2'], at?.['SpiceLine'], at?.['SpiceLine2']];
    const flat = flatParts.filter(Boolean).join(' ');

    if (norm(flat) === norm(value)) {
      // symbol defaults ARE the card — nothing to emit
    } else if (fileLayout) {
      const card = (sub + (tail ? ' ' + tail : '')).trim();
      if (norm(at?.['Value2']) !== norm(card)) out.push(`SYMATTR Value2 ${card}`);
    } else if (at?.['SpiceModel']) {
      if (norm(at['SpiceModel']) !== norm(sub)) out.push(`SYMATTR SpiceModel ${sub}`);
      if (tail) {
        for (const slot of ['Value', 'Value2', 'SpiceLine', 'SpiceLine2']) {
          if (at[slot] !== undefined && norm(at[slot]) !== norm(tail)) out.push(`SYMATTR ${slot} ${tail}`);
        }
        if (at['Value'] === undefined && at['Value2'] === undefined &&
            at['SpiceLine'] === undefined && at['SpiceLine2'] === undefined)
          out.push(`SYMATTR Value ${tail}`);
      }
    } else {
      if (norm(at?.['Value']) !== norm(sub)) out.push(`SYMATTR Value ${sub}`);
      if (tail) {
        for (const slot of ['Value2', 'SpiceLine', 'SpiceLine2']) {
          if (at?.[slot] !== undefined && norm(at[slot]) !== norm(tail)) out.push(`SYMATTR ${slot} ${tail}`);
        }
        if (at?.['Value2'] === undefined && at?.['SpiceLine'] === undefined && at?.['SpiceLine2'] === undefined)
          out.push(`SYMATTR Value2 ${tail}`);
      }
    }
  } else {
    const m = value.match(/^(.*?)(\s+AC\s+.*)?$/i)!;
    out.push(`SYMATTR Value ${m[1]!}`);
    if (m[2]) out.push(`SYMATTR Value2 ${m[2]!.trim()}`);
  }
  return out;
}

// ─── emitAsc (pure) ───────────────────────────────────────────────────────────

export function emitAsc(
  comps:      readonly EmitComp[],
  wires:      readonly [number, number, number, number][],
  flags:      readonly [number, number, string][],
  directives: readonly string[],
): string {
  const L: string[] = ['Version 4', 'SHEET 1 1200 800'];

  for (const w of wires) {
    if (w[0] !== w[2] || w[1] !== w[3]) L.push(`WIRE ${w[0]} ${w[1]} ${w[2]} ${w[3]}`);
  }
  for (const f of flags) L.push(`FLAG ${f[0]} ${f[1]} ${f[2]}`);

  for (const c of comps) {
    L.push(`SYMBOL ${c.sym} ${c.origin[0]} ${c.origin[1]} ${c.rot}`);
    if (c.nets.length === 2 && c.rot !== 'R0' && !NOROT) {
      const sym = SYMBOLS[c.sym];
      if (sym) {
        const b  = sym.bbox;
        const my = Math.round((b[1] + b[3]) / 2 / 8) * 8;
        const w_  = sym.windows ?? {};
        const d0 = w_['0']  ?? [36, 40, 'Left'] as [number, number, string];
        const d3 = w_['3']  ?? [36, 76, 'Left'] as [number, number, string];

        if (c.rot === 'R90' || c.rot === 'R270') {
          const vlen = Math.min((c.value ?? '').length, 24) * 16;
          const below = rot(c.rot === 'R90' ? [b[2], my] : [b[0], my], c.rot);
          const bax = c.origin[0] + below[0], bay = c.origin[1] + below[1];
          const box = [bax - vlen / 2, bay, bax + vlen / 2, bay + 28];
          const hit = wires.some(w2 => {
            const x1 = Math.min(w2[0], w2[2]), x2 = Math.max(w2[0], w2[2]);
            const y1 = Math.min(w2[1], w2[3]), y2 = Math.max(w2[1], w2[3]);
            return !(x2 < box[0]! || x1 > box[2]! || y2 < box[1]! || y1 > box[3]!);
          });
          if (c.rot === 'R90') {
            L.push(`WINDOW 0 ${b[0]} ${my} VBottom 2`);
            L.push(hit ? `WINDOW 3 ${b[0] - 32} ${my} VBottom 2` : `WINDOW 3 ${b[2]} ${my} VTop 2`);
          } else {
            L.push(`WINDOW 0 ${b[2]} ${my} VTop 2`);
            L.push(hit ? `WINDOW 3 ${b[2] + 32} ${my} VTop 2` : `WINDOW 3 ${b[0]} ${my} VBottom 2`);
          }
        } else if (c.rot === 'R180') {
          L.push(`WINDOW 0 ${d3[0]} ${d3[1]} Left 2`);
          L.push(`WINDOW 3 ${d0[0]} ${d0[1]} Left 2`);
        }
      }
    }
    L.push(`SYMATTR InstName ${c.name}`);
    const symAttrs = (SYMBOLS[c.sym] ?? {}).attrs;
    for (const a of symValueAttrs(symAttrs ?? null, c.name, c.value)) L.push(a);
  }

  let ty = Math.max(0, ...comps.map(c => c.y + (c.rbb[3] - c.rbb[1]))) + 64;
  for (const d of directives) { L.push(`TEXT 0 ${ty} Left 2 !${d}`); ty += 32; }
  return L.join('\n') + '\n';
}
