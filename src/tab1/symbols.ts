/**
 * symbols.ts — Symbol library & resolution
 *
 * SYMBOLS: pin tables verified against evenator/LTSpice-Libraries sym/*.asy
 * Provides: symbol lookup, subckt→symbol resolution, synthetic block emission.
 */

import type { SymbolDef } from '../types.js';

// ─── Mutable symbol-table exports (populated by symbolsReady) ─────────────────

/** Full LTspice symbol table — populated after symbolsReady resolves. */
export let SYMBOLS:    Record<string, SymbolDef & { retired?: boolean }> = {};

/** SVG draw commands per symbol key — primitive shapes, inlined from sym-draw data. */
export let SYM_DRAW: Record<string, {
  draw?: Array<{
    t: 'line' | 'ellipse' | 'rect' | 'arc';
    x1?: number; y1?: number; x2?: number; y2?: number;
    cx?: number; cy?: number; rx?: number; ry?: number;
    x?: number;  y?: number;  w?: number;  h?: number;
    large?: number; sweep?: number;
  }>;
  pins?: Array<{ x: number; y: number }>;
}> = {
  res:     {draw:[{t:'line',x1:16,y1:88,x2:16,y2:96},{t:'line',x1:0,y1:80,x2:16,y2:88},{t:'line',x1:32,y1:64,x2:0,y2:80},{t:'line',x1:0,y1:48,x2:32,y2:64},{t:'line',x1:32,y1:32,x2:0,y2:48},{t:'line',x1:16,y1:16,x2:16,y2:24},{t:'line',x1:16,y1:24,x2:32,y2:32}],pins:[{x:16,y:16},{x:16,y:96}]},
  cap:     {draw:[{t:'line',x1:16,y1:36,x2:16,y2:64},{t:'line',x1:16,y1:28,x2:16,y2:0},{t:'line',x1:0,y1:28,x2:32,y2:28},{t:'line',x1:0,y1:36,x2:32,y2:36}],pins:[{x:16,y:0},{x:16,y:64}]},
  ind:     {draw:[{t:'arc',cx:16,cy:56,rx:16,ry:16,x1:4.686291501015241,y1:44.68629150101524,x2:4.686291501015241,y2:67.31370849898477,large:1,sweep:0},{t:'arc',cx:16,cy:80,rx:16,ry:16,x1:4.686291501015241,y1:68.68629150101523,x2:16,y2:96,large:1,sweep:0},{t:'arc',cx:16,cy:32,rx:16,ry:16,x1:16,y1:16,x2:4.686291501015241,y2:43.31370849898476,large:1,sweep:0}],pins:[{x:16,y:16},{x:16,y:96}]},
  voltage: {draw:[{t:'line',x1:-8,y1:36,x2:8,y2:36},{t:'line',x1:-8,y1:76,x2:8,y2:76},{t:'line',x1:0,y1:28,x2:0,y2:44},{t:'line',x1:0,y1:96,x2:0,y2:88},{t:'line',x1:0,y1:16,x2:0,y2:24},{t:'ellipse',cx:0,cy:56,rx:32,ry:32}],pins:[{x:0,y:16},{x:0,y:96}]},
  current: {draw:[{t:'line',x1:0,y1:56,x2:4,y2:44},{t:'line',x1:0,y1:56,x2:-4,y2:44},{t:'line',x1:-4,y1:44,x2:4,y2:44},{t:'line',x1:0,y1:24,x2:0,y2:44},{t:'line',x1:0,y1:80,x2:0,y2:72},{t:'line',x1:0,y1:0,x2:0,y2:8},{t:'ellipse',cx:0,cy:40,rx:32,ry:32}],pins:[{x:0,y:0},{x:0,y:80}]},
  npn:     {draw:[{t:'line',x1:44,y1:76,x2:36,y2:84},{t:'line',x1:64,y1:96,x2:44,y2:76},{t:'line',x1:64,y1:96,x2:36,y2:84},{t:'line',x1:40,y1:80,x2:16,y2:64},{t:'line',x1:16,y1:80,x2:16,y2:16},{t:'line',x1:16,y1:32,x2:64,y2:0},{t:'line',x1:16,y1:48,x2:0,y2:48}],pins:[{x:64,y:0},{x:0,y:48},{x:64,y:96}]},
  pnp:     {draw:[{t:'line',x1:16,y1:64,x2:44,y2:76},{t:'line',x1:44,y1:76,x2:36,y2:84},{t:'line',x1:16,y1:64,x2:36,y2:84},{t:'line',x1:40,y1:80,x2:64,y2:96},{t:'line',x1:16,y1:80,x2:16,y2:16},{t:'line',x1:16,y1:32,x2:64,y2:0},{t:'line',x1:16,y1:48,x2:0,y2:48}],pins:[{x:64,y:0},{x:0,y:48},{x:64,y:96}]},
  nmos:    {draw:[{t:'line',x1:48,y1:48,x2:48,y2:96},{t:'line',x1:16,y1:80,x2:48,y2:80},{t:'line',x1:40,y1:48,x2:48,y2:48},{t:'line',x1:16,y1:48,x2:40,y2:44},{t:'line',x1:16,y1:48,x2:40,y2:52},{t:'line',x1:40,y1:44,x2:40,y2:52},{t:'line',x1:16,y1:8,x2:16,y2:24},{t:'line',x1:16,y1:40,x2:16,y2:56},{t:'line',x1:16,y1:72,x2:16,y2:88},{t:'line',x1:0,y1:80,x2:8,y2:80},{t:'line',x1:8,y1:16,x2:8,y2:80},{t:'line',x1:48,y1:16,x2:16,y2:16},{t:'line',x1:48,y1:0,x2:48,y2:16}],pins:[{x:48,y:0},{x:0,y:80},{x:48,y:96}]},
  pmos:    {draw:[{t:'line',x1:48,y1:48,x2:48,y2:96},{t:'line',x1:16,y1:80,x2:48,y2:80},{t:'line',x1:16,y1:48,x2:24,y2:48},{t:'line',x1:48,y1:48,x2:24,y2:44},{t:'line',x1:48,y1:48,x2:24,y2:52},{t:'line',x1:24,y1:44,x2:24,y2:52},{t:'line',x1:16,y1:8,x2:16,y2:24},{t:'line',x1:16,y1:40,x2:16,y2:56},{t:'line',x1:16,y1:72,x2:16,y2:88},{t:'line',x1:0,y1:80,x2:8,y2:80},{t:'line',x1:8,y1:16,x2:8,y2:80},{t:'line',x1:48,y1:16,x2:16,y2:16},{t:'line',x1:48,y1:0,x2:48,y2:16}],pins:[{x:48,y:0},{x:0,y:80},{x:48,y:96}]},
  diode:   {draw:[{t:'line',x1:0,y1:44,x2:32,y2:44},{t:'line',x1:0,y1:20,x2:32,y2:20},{t:'line',x1:32,y1:20,x2:16,y2:44},{t:'line',x1:0,y1:20,x2:16,y2:44},{t:'line',x1:16,y1:0,x2:16,y2:20},{t:'line',x1:16,y1:44,x2:16,y2:64}],pins:[{x:16,y:0},{x:16,y:64}]},
  zener:   {draw:[{t:'line',x1:0,y1:44,x2:-4,y2:48},{t:'line',x1:32,y1:44,x2:36,y2:40},{t:'line',x1:0,y1:44,x2:32,y2:44},{t:'line',x1:0,y1:20,x2:32,y2:20},{t:'line',x1:32,y1:20,x2:16,y2:44},{t:'line',x1:0,y1:20,x2:16,y2:44},{t:'line',x1:16,y1:0,x2:16,y2:20},{t:'line',x1:16,y1:44,x2:16,y2:64}],pins:[{x:16,y:0},{x:16,y:64}]},
  led:     {draw:[{t:'line',x1:0,y1:44,x2:32,y2:44},{t:'line',x1:0,y1:20,x2:32,y2:20},{t:'line',x1:32,y1:20,x2:16,y2:44},{t:'line',x1:0,y1:20,x2:16,y2:44},{t:'line',x1:16,y1:0,x2:16,y2:20},{t:'line',x1:16,y1:44,x2:16,y2:64},{t:'line',x1:72,y1:32,x2:68,y2:40},{t:'line',x1:72,y1:32,x2:64,y2:32},{t:'line',x1:72,y1:48,x2:68,y2:56},{t:'line',x1:72,y1:48,x2:64,y2:48},{t:'arc',cx:48,cy:28,rx:8,ry:8,x1:40.844582472,y1:24.422291236,x2:56,y2:28,large:0,sweep:0},{t:'arc',cx:64,cy:28,rx:8,ry:8,x1:71.155417528,y1:31.577708764,x2:56,y2:28,large:0,sweep:0},{t:'arc',cx:48,cy:44,rx:8,ry:8,x1:40.844582472,y1:40.422291236,x2:56,y2:44,large:0,sweep:0},{t:'arc',cx:64,cy:44,rx:8,ry:8,x1:71.155417528,y1:47.577708764,x2:56,y2:44,large:0,sweep:0}],pins:[{x:16,y:0},{x:16,y:64}]},
  opamp:   {draw:[{t:'line',x1:-32,y1:32,x2:32,y2:64},{t:'line',x1:-32,y1:96,x2:32,y2:64},{t:'line',x1:-32,y1:32,x2:-32,y2:96},{t:'line',x1:-28,y1:48,x2:-20,y2:48},{t:'line',x1:-28,y1:80,x2:-20,y2:80},{t:'line',x1:-24,y1:84,x2:-24,y2:76}],pins:[{x:-32,y:48},{x:-32,y:80},{x:32,y:64}]},
  sw:      {draw:[{t:'line',x1:-48,y1:32,x2:-32,y2:32},{t:'line',x1:-32,y1:32,x2:-24,y2:36},{t:'line',x1:-48,y1:80,x2:-32,y2:80},{t:'line',x1:-32,y1:80,x2:-24,y2:76},{t:'line',x1:0,y1:96,x2:0,y2:72},{t:'line',x1:0,y1:16,x2:0,y2:36},{t:'line',x1:0,y1:36,x2:20,y2:60},{t:'line',x1:-48,y1:72,x2:-40,y2:72},{t:'line',x1:-44,y1:76,x2:-44,y2:68},{t:'line',x1:-48,y1:40,x2:-40,y2:40},{t:'ellipse',cx:0,cy:56,rx:32,ry:32},{t:'ellipse',cx:0,cy:72,rx:4,ry:4},{t:'ellipse',cx:20,cy:60,rx:4,ry:4}],pins:[{x:0,y:16},{x:0,y:96},{x:-48,y:80},{x:-48,y:32}]},
};

/** X subckt name → symbol key (case-insensitive on .asy base name). */
export let SUBCKT2SYM: Record<string, string> = {};

/** symtable-path key (e.g. "misc/ne555") → {pinIndex: pinName} from LTspice .asy */
export let SYM_PIN_NAMES: Record<string, Record<string, string>> = {};

/** SPICE element prefix → default symbol key. */
export const PREFIX2SYM: Record<string, string> = {
  R: 'res', C: 'cap', L: 'ind', V: 'voltage', I: 'current', D: 'diode',
};

// ─── LTspice full-geometry cache (lazy-loaded on first IC render) ─────────────

/** Raw entry shape from sym-draw-full.json */
interface RawSymEntry {
  draw: Array<{
    t: string;
    x1?: number; y1?: number; x2?: number; y2?: number;
    x3?: number; y3?: number; x4?: number; y4?: number;
  }>;
  pins: Array<[number, number]>;
  bbox: [number, number, number, number];
}

/** Renderer-ready shape (same format as SYM_DRAW entries) */
export type SvgShape = {
  t: 'line' | 'ellipse' | 'rect' | 'arc';
  x1?: number; y1?: number; x2?: number; y2?: number;
  cx?: number; cy?: number; rx?: number; ry?: number;
  x?: number;  y?: number;  w?: number;  h?: number;
  large?: number; sweep?: number;
};

/**
 * Convert one LTspice raw primitive to a renderer-ready SvgShape.
 * Returns null for unknown types.
 */
export function ltspicePrimToSvg(p: RawSymEntry['draw'][number]): SvgShape | null {
  switch (p.t) {
    case 'line':
      return { t: 'line', x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 };

    case 'rect': {
      const x = Math.min(p.x1!, p.x2!);
      const y = Math.min(p.y1!, p.y2!);
      return { t: 'rect', x, y, w: Math.abs(p.x2! - p.x1!), h: Math.abs(p.y2! - p.y1!) };
    }

    case 'circle': {
      const cx = (p.x1! + p.x2!) / 2;
      const cy = (p.y1! + p.y2!) / 2;
      return { t: 'ellipse', cx, cy, rx: Math.abs(p.x2! - p.x1!) / 2, ry: Math.abs(p.y2! - p.y1!) / 2 };
    }

    case 'arc': {
      // LTspice arc: bounding box (x1,y1)-(x2,y2), start point (x3,y3), end point (x4,y4)
      const cx = (p.x1! + p.x2!) / 2;
      const cy = (p.y1! + p.y2!) / 2;
      const rx = Math.abs(p.x2! - p.x1!) / 2;
      const ry = Math.abs(p.y2! - p.y1!) / 2;
      if (rx === 0 || ry === 0) return null;

      // Start and end angles (LTspice draws counter-clockwise)
      const startAngle = Math.atan2(-(p.y3! - cy) / ry, (p.x3! - cx) / rx);
      const endAngle   = Math.atan2(-(p.y4! - cy) / ry, (p.x4! - cx) / rx);

      // SVG arc endpoint parameterisation
      const svgX1 = cx + rx * Math.cos(startAngle);
      const svgY1 = cy - ry * Math.sin(startAngle);
      const svgX2 = cx + rx * Math.cos(endAngle);
      const svgY2 = cy - ry * Math.sin(endAngle);

      // Angular span going counter-clockwise from start to end
      let span = startAngle - endAngle;
      if (span < 0) span += 2 * Math.PI;

      // SVG sweep=0 means counter-clockwise; large=1 when span > 180°
      const large = span > Math.PI ? 1 : 0;
      const sweep = 0; // LTspice arcs are always counter-clockwise

      return { t: 'arc', cx, cy, rx, ry, x1: svgX1, y1: svgY1, x2: svgX2, y2: svgY2, large, sweep };
    }

    default:
      return null;
  }
}

/**
 * Cache of converted sym-draw-full entries, keyed by fd_key (e.g. "misc/ne555").
 * Populated lazily on first request via getFullSymDraw().
 */
let _symDrawFullRaw: Record<string, RawSymEntry> | null = null;
let _symDrawFullConverted: Record<string, SvgShape[]> = {};

/**
 * Fetch sym-draw-full.json on first call (cached thereafter).
 * Returns converter-ready shapes for the given fd_key, or null if not found.
 */
export async function getFullSymDraw(fdKey: string): Promise<SvgShape[] | null> {
  if (!_symDrawFullRaw) {
    try {
      _symDrawFullRaw = await fetch('data/sym-draw-full.json').then(r => r.json()) as Record<string, RawSymEntry>;
    } catch {
      _symDrawFullRaw = {};
    }
  }
  if (_symDrawFullConverted[fdKey] !== undefined) return _symDrawFullConverted[fdKey] ?? null;
  const entry = _symDrawFullRaw[fdKey];
  if (!entry?.draw) { _symDrawFullConverted[fdKey] = []; return null; }
  const shapes = entry.draw.map(ltspicePrimToSvg).filter((s): s is SvgShape => s !== null);
  _symDrawFullConverted[fdKey] = shapes;
  return shapes.length ? shapes : null;
}

/**
 * Pre-warm the sym-draw-full cache for a set of fd_keys.
 * Call this before rendering to ensure getFullSymDrawSync works synchronously.
 */
export async function prewarmFullSymDraw(fdKeys: string[]): Promise<void> {
  await Promise.all(fdKeys.map(k => getFullSymDraw(k)));
}

/**
 * Synchronous cache read — only valid after getFullSymDraw / prewarmFullSymDraw
 * has been awaited for this fdKey. Returns null if not cached.
 */
export function getFullSymDrawSync(fdKey: string): SvgShape[] | null {
  const shapes = _symDrawFullConverted[fdKey];
  return shapes && shapes.length ? shapes : null;
}

// ─── Async loader ─────────────────────────────────────────────────────────────

/**
 * Resolves when both symtable.json and sym-draw.json have been fetched and
 * all symbol exports are populated. Await this before calling any conversion.
 */
let NAME2SYM:  Record<string, string> | null = null;
let MODEL2SYM: Record<string, string> | null = null;
let CARD2SYM:  Record<string, string> | null = null;

export const symbolsReady: Promise<void> = (async (): Promise<void> => {
  const [symtable, pinNames] = await Promise.all([
    fetch('data/symtable.json').then(r => r.json() as Promise<Record<string, SymbolDef & { retired?: boolean }>>),
    fetch('data/sym-pin-names.json').then(r => r.json() as Promise<Record<string, Record<string, string>>>).catch(() => ({})),
  ]);
  SYMBOLS = symtable;
  SYM_PIN_NAMES = pinNames;
  // SYM_DRAW is already populated with inlined primitive draw data above.
  for (const k of Object.keys(SYMBOLS)) {
    const base = k.split('\\').pop();
    if (base) SUBCKT2SYM[base.toLowerCase()] = k;
  }
  // Reset lazy resolve maps so they are rebuilt from the fresh SYMBOLS table.
  NAME2SYM = null; MODEL2SYM = null; CARD2SYM = null;
})();

// ─── Synthetic rectangular block ──────────────────────────────────────────────

/**
 * Returns the symbol key for a synthetic rectangular block with `npins` pins,
 * creating the entry in SYMBOLS if it does not already exist.
 */
export function genericBlock(npins: number): string {
  const key = '__block' + npins;
  if (SYMBOLS[key]) return key;
  const perSide = Math.ceil(npins / 2);
  const H = Math.max(96, perSide * 48);
  const pins: [number, number][] = [];
  const ord: number[] = [];
  for (let i = 0; i < npins; i++) {
    const left = i < perSide;
    const idx  = left ? i : i - perSide;
    const cnt  = left ? perSide : npins - perSide;
    const y    = Math.round((H * (idx + 0.5) / cnt) / 16) * 16;
    pins.push([left ? -64 : 64, y]);
    ord.push(i + 1);
  }
  SYMBOLS[key] = {
    pins,
    ord,
    bbox: [-64, 0, 64, Math.round(H / 16) * 16],
    synthetic: true,
  };
  return key;
}

/**
 * Generates the .asy text for a synthetic block so the generated .asc can be
 * opened in LTspice without any library edits.
 */
export function blockAsySource(npins: number): string {
  const perSide = Math.ceil(npins / 2);
  const H  = Math.max(96, perSide * 48);
  const Hs = Math.round(H / 16) * 16;
  const L: string[] = [
    'Version 4', 'SymbolType CELL',
    `RECTANGLE Normal -64 0 64 ${Hs}`,
    'WINDOW 0 0 -8 Bottom 2',
    `WINDOW 3 0 ${Hs + 8} Top 2`,
    'SYMATTR Prefix X',
  ];
  for (let i = 0; i < npins; i++) {
    const left = i < perSide;
    const idx  = left ? i : i - perSide;
    const cnt  = left ? perSide : npins - perSide;
    const y    = Math.round((H * (idx + 0.5) / cnt) / 16) * 16;
    L.push(`PIN ${left ? -64 : 64} ${y} ${left ? 'LEFT' : 'RIGHT'} 8`);
    L.push(`PINATTR PinName P${i + 1}`);
    L.push(`PINATTR SpiceOrder ${i + 1}`);
  }
  return L.join('\n') + '\n';
}

/**
 * Scans an emitted .asc for synthetic blocks and returns `{ filename: asySource }`
 * for every distinct `__blockN` used — write these next to the .asc file.
 */
export function blockAsyFiles(asc: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ln of asc.split(/\r?\n/)) {
    const m = ln.trim().match(/^SYMBOL\s+(__block(\d+))\s/);
    if (m && m[1] && m[2] && !out[m[1] + '.asy']) {
      out[m[1] + '.asy'] = blockAsySource(+m[2]);
    }
  }
  return out;
}

// ─── Symbol resolution ────────────────────────────────────────────────────────



/** Builds the three resolution maps lazily (called once on first resolveSub). */
export function buildResolveMaps(): void {
  NAME2SYM = {}; MODEL2SYM = {}; CARD2SYM = {};
  for (const key of Object.keys(SYMBOLS)) {
    const e    = SYMBOLS[key]!;
    const base = key.split('\\').pop()!.toLowerCase();
    const pref = (a: string | undefined, b: string): boolean =>
      a === undefined || (!!(SYMBOLS[a]!.retired) && !(SYMBOLS[b]!.retired));
    if (pref(NAME2SYM[base], key)) NAME2SYM[base] = key;
    const at = e.attrs ?? {};
    if (at['SpiceModel'] && !/\.sub$/i.test(at['SpiceModel'])) {
      const m = at['SpiceModel'].toLowerCase();
      if (pref(MODEL2SYM[m], key)) MODEL2SYM[m] = key;
    }
    {
      const isSubFile = at['SpiceModel'] && /\.sub$/i.test(at['SpiceModel']);
      const parts = isSubFile
        ? [at['Value2'], at['SpiceLine'], at['SpiceLine2']]
        : [at['SpiceModel'], at['Value'], at['Value2'], at['SpiceLine'], at['SpiceLine2']];
      const card = parts.filter(Boolean).join(' ').trim().replace(/\s+/g, ' ').toLowerCase();
      if (card && pref(CARD2SYM[card], key)) CARD2SYM[card] = key;
    }
  }
}

/**
 * Resolves a SPICE subcircuit name to a symbol key, or returns null if unknown.
 * Falls back to a synthetic genericBlock when the name is recognisable but the
 * pin count differs.
 */
export function resolveSub(sub: string, npins: number, tail?: string): string | null {
  const q  = sub.toLowerCase();
  const ok = (k: string | undefined): string | null =>
    k !== undefined && SYMBOLS[k] !== undefined && SYMBOLS[k]!.pins.length === npins ? k : null;

  if (!NAME2SYM) buildResolveMaps();

  if (tail !== undefined) {
    const card = (sub + (tail ? ' ' + tail : '')).trim().replace(/\s+/g, ' ').toLowerCase();
    const kc = ok(CARD2SYM![card]); if (kc) return kc;
  }

  let k: string | null;
  k = ok(SUBCKT2SYM[q]);      if (k) return k;
  k = ok(MODEL2SYM![q]);      if (k) return k;
  k = ok(NAME2SYM![q]);       if (k) return k;

  if (q.includes('/')) {
    k = ok(SUBCKT2SYM[q.split('/')[0]!]); if (k) return k;
  }
  const m1 = q.match(/^([a-z]+\d+[a-z]?(?:-[\d.]+)?)/);
  if (m1) { k = ok(SUBCKT2SYM[m1[1]!]); if (k) return k; }

  for (const b of Object.keys(SUBCKT2SYM)) {
    if (b.length >= 5 && q.startsWith(b)) { k = ok(SUBCKT2SYM[b]); if (k) return k; }
  }
  for (const suf of ['a', 'b', 'c', 'd', '-1', '-2', '-3', '-5']) {
    k = ok(SUBCKT2SYM[q + suf]); if (k) return k;
  }

  const m2 = q.match(/^([a-z]+\d+[a-z]?(?:-[\d.]+)?)/);
  let known: string | undefined =
    SUBCKT2SYM[q] ?? (m2 ? SUBCKT2SYM[m2[1]!] : undefined);
  if (!known) {
    for (const suf of ['a', 'b', 'c', 'd']) {
      if (SUBCKT2SYM[q + suf]) { known = SUBCKT2SYM[q + suf]; break; }
    }
  }
  if (known) return genericBlock(npins);
  return null;
}
