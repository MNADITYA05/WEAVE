/**
 * schematic-symbols.ts — public interface definitions + re-exports from symbols/
 *
 * Symbol data is split across src/tab2/symbols/:
 *   passives.ts  sources.ts  semis.ts  switches.ts
 *   logic.ts     opamp.ts    misc.ts   power.ts
 *   index.ts  ← merges all, exports SYMDEFS + PALETTE_GROUPS
 */

export interface SymDef {
  label:     string;
  prefix:    string;
  group:     string;
  pins:      [number, number][];
  pinNames:  string[];
  netName?:  string;
  refOffset: [number, number] | null;
  valOffset: [number, number] | null;
  svg:       string;
}

export interface PaletteGroup {
  name:  string;
  types: string[];
}

export { SYMDEFS, PALETTE_GROUPS, LOGIC_BEXPR } from './symbols/index';

// ─── IC picker (symtable-backed) ─────────────────────────────────────────────

interface SymTableEntry {
  pins:     [number, number][];
  ord:      number[];
  bbox:     [number, number, number, number];
  attrs?:   Record<string, string>;
  retired?: boolean;
}

let _symtable: Record<string, SymTableEntry> = {};
let _loaded = false;

/** Cache of generated SymDefs, keyed by 'IC:<symtable-key>'. */
export const IC_SYMDEFS = new Map<string, SymDef>();

/** Resolves when symtable.json has been fetched (for Tab 2 IC picker). */
export const icPickerReady: Promise<void> = (async (): Promise<void> => {
  try {
    const r = await fetch('data/symtable.json');
    _symtable = await r.json() as Record<string, SymTableEntry>;
    _loaded = true;
  } catch (e) {
    console.warn('ic-picker: could not load symtable.json —', e);
  }
})();

export interface IcMatch {
  key:      string;   // symtable key, e.g. 'OpAmps\\LM741'
  label:    string;   // base name,    e.g. 'LM741'
  npins:    number;
  category: string;   // folder,       e.g. 'OpAmps'
}

/**
 * Returns up to 20 active symtable entries whose base name contains `query`.
 * Returns [] when query.length < 2 or symtable not yet loaded.
 */
export function searchICs(query: string): IcMatch[] {
  if (!_loaded || query.length < 2) return [];
  const q = query.toLowerCase();
  const results: IcMatch[] = [];
  for (const key of Object.keys(_symtable)) {
    const entry = _symtable[key]!;
    if (entry.retired) continue;
    const parts    = key.split('\\');
    const base     = parts.pop()!;
    const category = parts.join('\\') || 'Other';
    if (base.toLowerCase().includes(q)) {
      results.push({ key, label: base, npins: entry.pins.length, category });
      if (results.length >= 20) break;
    }
  }
  return results;
}

/**
 * Returns (or creates and caches) a SymDef for the given symtable key.
 * The type key used in Comp.type is 'IC:<key>'.
 * Returns null when the key is not found in the loaded symtable.
 */
export function makeIcSymDef(key: string): SymDef | null {
  const typeKey = 'IC:' + key;
  const cached  = IC_SYMDEFS.get(typeKey);
  if (cached) return cached;

  const entry = _symtable[key];
  if (!entry) return null;

  const base       = key.split('\\').pop()!;
  const N          = entry.pins.length;
  const leftCount  = Math.ceil(N / 2);
  const rightCount = N - leftCount;
  const ROW_H      = 24;
  const H          = Math.max(64, leftCount * ROW_H);
  const BODY_W     = 80;
  const STUB       = 16;

  const pins:     [number, number][] = [];
  const pinNames: string[]           = [];

  for (let i = 0; i < leftCount; i++) {
    const y = -H / 2 + ROW_H / 2 + i * ROW_H;
    pins.push([-(BODY_W / 2 + STUB), y]);
    pinNames.push(String(i + 1));
  }
  for (let i = 0; i < rightCount; i++) {
    const y = -H / 2 + ROW_H / 2 + i * ROW_H;
    pins.push([BODY_W / 2 + STUB, y]);
    pinNames.push(String(N - i));
  }

  const HW = BODY_W / 2;
  let svg = '';
  svg += `<rect x="${-HW}" y="${-H / 2}" width="${BODY_W}" height="${H}" rx="3" fill="#1e2a3a" stroke="currentColor" stroke-width="1.5"/>`;
  svg += `<text x="0" y="4" text-anchor="middle" font-size="9" font-family="monospace" fill="#88aacc" stroke="none">${base}</text>`;
  for (let i = 0; i < leftCount; i++) {
    const y = -H / 2 + ROW_H / 2 + i * ROW_H;
    svg += `<line x1="${-HW - STUB}" y1="${y}" x2="${-HW}" y2="${y}"/>`;
    svg += `<text x="${-HW + 4}" y="${y + 3}" font-size="7" font-family="monospace" fill="#88aacc" stroke="none">${i + 1}</text>`;
  }
  for (let i = 0; i < rightCount; i++) {
    const y = -H / 2 + ROW_H / 2 + i * ROW_H;
    svg += `<line x1="${HW}" y1="${y}" x2="${HW + STUB}" y2="${y}"/>`;
    svg += `<text x="${HW - 4}" y="${y + 3}" font-size="7" font-family="monospace" fill="#88aacc" stroke="none" text-anchor="end">${N - i}</text>`;
  }

  const symdef: SymDef = {
    label:     base,
    prefix:    'X',
    group:     'ICs',
    pins,
    pinNames,
    refOffset: [HW + STUB + 4, -H / 2 - 4],
    valOffset: [HW + STUB + 4, -H / 2 + 8],
    svg,
  };

  IC_SYMDEFS.set(typeKey, symdef);
  return symdef;
}
