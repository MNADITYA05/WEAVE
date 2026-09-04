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

/** SVG draw commands per symbol key — populated after symbolsReady resolves. */
export let SYM_DRAW:   Record<string, {
  draw?: Array<{
    t: 'l' | 'e' | 'r' | 'a';
    x1?: number; y1?: number; x2?: number; y2?: number;
    cx?: number; cy?: number; rx?: number; ry?: number;
    x?: number;  y?: number;  w?: number;  h?: number;
    large?: number; sweep?: number;
  }>;
  pins?: Array<{ x: number; y: number }>;
}> = {};

/** X subckt name → symbol key (case-insensitive on .asy base name). */
export let SUBCKT2SYM: Record<string, string> = {};

/** SPICE element prefix → default symbol key. */
export const PREFIX2SYM: Record<string, string> = {
  R: 'res', C: 'cap', L: 'ind', V: 'voltage', I: 'current', D: 'diode',
};

// ─── Async loader ─────────────────────────────────────────────────────────────

/**
 * Resolves when both symtable.json and sym-draw.json have been fetched and
 * all symbol exports are populated. Await this before calling any conversion.
 */
let NAME2SYM:  Record<string, string> | null = null;
let MODEL2SYM: Record<string, string> | null = null;
let CARD2SYM:  Record<string, string> | null = null;

export const symbolsReady: Promise<void> = (async (): Promise<void> => {
  const [symtable, symDraw] = await Promise.all([
    fetch('data/symtable.json').then(r => r.json() as Promise<Record<string, SymbolDef & { retired?: boolean }>>),
    fetch('data/sym-draw.json').then(r => r.json() as Promise<typeof SYM_DRAW>),
  ]);
  SYMBOLS  = symtable;
  SYM_DRAW = symDraw;
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
