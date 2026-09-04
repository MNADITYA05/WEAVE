/**
 * asc2net.ts — Reverse converter: LTspice .asc → SPICE netlist
 *
 * Depends on: SYMBOLS (symbols.ts), rot() (geometry.ts)
 */

import { rot, onSeg, ptKey } from './shared/geometry.js';
import { UF } from './shared/union-find.js';
import { SYMBOLS } from './tab1/symbols.js';
import type { RotCode, Point } from './types.js';
import { logger } from './logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type Wire4 = [number, number, number, number];

interface AscFlag2  { x: number; y: number; name: string }
interface AscSym2   {
  sym: string; x: number; y: number; rot: string;
  name: string | null; value: string | null; value2: string | null;
  spiceModel: string | null; spiceOrder: string | null;
}
interface PinCoord  { sym: AscSym2; pinIdx: number; pt: Point }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findSymDef(symName: string) {
  if (SYMBOLS[symName]) return SYMBOLS[symName];
  const lower = symName.toLowerCase();
  for (const k of Object.keys(SYMBOLS)) {
    const parts = k.split('\\');
    if (parts[parts.length - 1]!.toLowerCase() === lower) return SYMBOLS[k];
  }
  return null;
}

// ─── Net name builder ─────────────────────────────────────────────────────────

function buildNetNames(
  wires: Wire4[],
  flags: AscFlag2[],
  pinPoints: Point[],
): { netOf: (pt: Point) => string } {
  const uf  = new UF();
  const pts = new Set<string>();
  for (const pp of pinPoints) pts.add(ptKey(pp[0], pp[1]));
  for (const f of flags) pts.add(ptKey(f.x, f.y));
  for (const w of wires) { pts.add(ptKey(w[0], w[1])); pts.add(ptKey(w[2], w[3])); }
  for (const w of wires) {
    const on = [...pts].map(k => k.split(',').map(Number) as Point)
                       .filter(p => onSeg(p[0], p[1], w[0], w[1], w[2], w[3]));
    on.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 1; i < on.length; i++) uf.union(ptKey(on[i - 1]![0], on[i - 1]![1]), ptKey(on[i]![0], on[i]![1]));
  }
  const groupName = new Map<string, string>();
  for (const f of flags) {
    const g = uf.find(ptKey(f.x, f.y));
    groupName.set(g, f.name === '0' ? '0' : f.name);
  }
  let autoIdx = 1;
  const netOf = (pt: Point): string => {
    const g = uf.find(ptKey(pt[0], pt[1]));
    if (!groupName.has(g)) groupName.set(g, 'N' + String(autoIdx++).padStart(3, '0'));
    return groupName.get(g)!;
  };
  return { netOf };
}

// ─── Pin reordering ───────────────────────────────────────────────────────────

function reorderNets(
  rawNets: string[],
  symDef: { ord?: number[] } | null | undefined,
  symAttrSpiceOrder: string | null,
): string[] {
  let order: number[] | null = symDef?.ord ?? null;
  if (symAttrSpiceOrder) {
    const parsed = symAttrSpiceOrder.trim().split(/\s+/).map(Number);
    if (parsed.some(isNaN)) {
      logger.warn(`asc2net: SpiceOrder "${symAttrSpiceOrder}" contains non-numeric tokens — ignoring`);
    } else {
      order = parsed;
    }
  }
  if (!order) return rawNets;
  const result = new Array<string>(rawNets.length);
  for (let i = 0; i < order.length && i < rawNets.length; i++) {
    const spicePos = order[i]! - 1;
    if (spicePos >= 0 && spicePos < rawNets.length) result[spicePos] = rawNets[i]!;
  }
  // Bug fix: unmapped slots get the raw net at that index rather than silently
  // connecting to ground ('0'), which would produce an incorrect netlist.
  for (let i = 0; i < result.length; i++) {
    if (result[i] === undefined) {
      logger.warn(`asc2net: pin slot ${i} unmapped by SpiceOrder — using raw net "${rawNets[i]}"`);
      result[i] = rawNets[i] ?? '?';
    }
  }
  return result;
}

// ─── SPICE line emitter ───────────────────────────────────────────────────────

function primitiveSpice(sym: AscSym2, nets: string[]): string | null {
  const n = sym.name, v = sym.value;
  if (!n) return null;
  const prefix = n[0]!.toUpperCase();
  if (prefix === 'V' || prefix === 'I') return `${n} ${nets[0] ?? '?'} ${nets[1] ?? '?'} ${v ?? '0'}`;
  if (prefix === 'R' || prefix === 'C' || prefix === 'L') return `${n} ${nets[0] ?? '?'} ${nets[1] ?? '?'} ${v ?? '?'}`;
  if (prefix === 'D') return `${n} ${nets[0] ?? '?'} ${nets[1] ?? '?'} ${v ?? 'D'}`;
  if (prefix === 'Q') {
    if (nets.length >= 4) return `${n} ${nets[0]} ${nets[1]} ${nets[2]} ${nets[3]} ${v ?? '?'}`;
    return `${n} ${nets[0] ?? '?'} ${nets[1] ?? '?'} ${nets[2] ?? '?'} ${v ?? '?'}`;
  }
  if (prefix === 'M') {
    if (nets.length >= 4) return `${n} ${nets[0]} ${nets[1]} ${nets[2]} ${nets[3]} ${v ?? '?'}`;
    return `${n} ${nets[0] ?? '?'} ${nets[1] ?? '?'} ${nets[2] ?? '?'} ${v ?? '?'}`;
  }
  if (prefix === 'J') return `${n} ${nets[0] ?? '?'} ${nets[1] ?? '?'} ${nets[2] ?? '?'} ${v ?? '?'}`;
  if (prefix === 'X') {
    const model = sym.spiceModel ?? v ?? sym.sym;
    return `${n} ${nets.join(' ')} ${model}`;
  }
  if ('EGFHB'.includes(prefix)) return `${n} ${nets.join(' ')} ${v ?? '?'}`;
  return `${n} ${nets.join(' ')} ${v ?? '?'}`;
}

// ─── Directive extractor ──────────────────────────────────────────────────────

function extractDirectives(text: string): string[] {
  const directives: string[] = [];
  for (const ln of text.split(/\r?\n/)) {
    const t = ln.trim();
    if (t.startsWith('TEXT')) {
      const m = t.match(/TEXT\s+-?\d+\s+-?\d+\s+\w+\s+\d+\s+(!|\|)\s*(.+)/);
      if (m && m[1] === '!') directives.push(m[2]!.trim());
    }
  }
  return directives;
}

// ─── Full ASC parser ──────────────────────────────────────────────────────────

function parseAscFull(text: string): { wires: Wire4[]; flags: AscFlag2[]; syms: AscSym2[] } {
  const wires: Wire4[]   = [];
  const flags: AscFlag2[] = [];
  const syms:  AscSym2[]  = [];
  let cur: AscSym2 | null = null;
  for (const ln of text.split(/\r?\n/)) {
    const t = ln.trim().split(/\s+/);
    if (!t[0]) continue;
    if (t[0] === 'WIRE') {
      wires.push([+t[1]!, +t[2]!, +t[3]!, +t[4]!]);
    } else if (t[0] === 'FLAG') {
      flags.push({ x: +t[1]!, y: +t[2]!, name: t[3] ?? '' });
    } else if (t[0] === 'SYMBOL') {
      cur = { sym: t[1]!, x: +t[2]!, y: +t[3]!, rot: t[4] ?? 'R0',
              name: null, value: null, value2: null, spiceModel: null, spiceOrder: null };
      syms.push(cur);
    } else if (t[0] === 'SYMATTR' && cur) {
      const attr = t[1], val = t.slice(2).join(' ');
      if      (attr === 'InstName')   cur.name       = val;
      else if (attr === 'Value')      cur.value      = val;
      else if (attr === 'Value2')     cur.value2     = val;
      else if (attr === 'SpiceModel') cur.spiceModel = val;
      else if (attr === 'SpiceOrder') cur.spiceOrder = val;
    }
  }
  return { wires, flags, syms };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Converts an LTspice .asc schematic text to a SPICE netlist string.
 */
export function asc2net(ascText: string): string {
  const { wires, flags, syms } = parseAscFull(ascText);

  const pinCoords: PinCoord[] = [];
  for (const s of syms) {
    if (!s.name) continue;
    const symDef = findSymDef(s.sym);
    if (!symDef) continue;
    symDef.pins.forEach((p, i) => {
      const rp  = rot(p, s.rot as RotCode);
      const abs: Point = [s.x + rp[0], s.y + rp[1]];
      pinCoords.push({ sym: s, pinIdx: i, pt: abs });
    });
  }

  const { netOf } = buildNetNames(wires, flags, pinCoords.map(pc => pc.pt));

  const symPins = new Map<string, Array<{ pinIdx: number; net: string; symDef: ReturnType<typeof findSymDef> }>>();
  for (const pc of pinCoords) {
    const sname = pc.sym.name!;
    if (!symPins.has(sname)) symPins.set(sname, []);
    symPins.get(sname)!.push({ pinIdx: pc.pinIdx, net: netOf(pc.pt), symDef: findSymDef(pc.sym.sym) });
  }

  const lines: string[] = ['* Schematic exported by Weave asc2net', ''];
  for (const s of syms) {
    if (!s.name) continue;
    const pins = symPins.get(s.name);
    if (!pins) continue;
    const sorted  = [...pins].sort((a, b) => a.pinIdx - b.pinIdx);
    const rawNets = sorted.map(p => p.net);
    const symDef  = sorted[0]?.symDef;
    const nets    = reorderNets(rawNets, symDef ?? null, s.spiceOrder);
    const line    = primitiveSpice(s, nets);
    if (line) lines.push(line);
  }

  const directives = extractDirectives(ascText);
  for (const d of directives) lines.push(d);
  lines.push('', '* end');
  return lines.join('\n');
}
