/**
 * verifier.ts — Round-trip connectivity verifier
 *
 * parseAsc()         — Extracts wires, flags, and symbol instances from raw ASC text.
 * connectivity()     — Builds a net→pin-set map from an ASC text using union-find.
 * netlistPartition() — Builds a net→pin-set map from a SPICE netlist text.
 * compare()          — Diffs the two maps and returns a list of error strings.
 *
 * All functions are pure text transforms (or pure data transforms): no DOM, no globals.
 */

import type { ParsedComponent, RotCode } from '../types.js';
import { rot, onSeg, ptKey } from '../shared/geometry.js';
import { UF } from '../shared/union-find.js';
import { parseNetlist } from './netlist-parser.js';
import { classifyNets, isFlag, railLabel } from './classifier.js';

// ─── Browser globals (script-tag loaded, not bundled) ────────────────────────
import { SYMBOLS } from './symbols.js';
import { SymbolError } from '../errors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AscWire { x1: number; y1: number; x2: number; y2: number }
interface AscFlag { x: number; y: number; name: string }
interface AscSym  { sym: string; x: number; y: number; rot: string; name?: string; value?: string }
interface ParsedAsc { wires: AscWire[]; flags: AscFlag[]; syms: AscSym[] }

type NetKey = string;   // 'FLAG:0', 'FLAG:VCC', 'G:x,y', 'NET:n'
type PinSig = string;   // 'comp:pinIdx'
type NetMap = Map<NetKey, Set<PinSig>>;

// ─── parseAsc ─────────────────────────────────────────────────────────────────

export function parseAsc(text: string): ParsedAsc {
  const wires: AscWire[] = [];
  const flags: AscFlag[] = [];
  const syms:  AscSym[]  = [];
  let cur: AscSym | null = null;

  for (const ln of text.split(/\r?\n/)) {
    const t = ln.trim().split(/\s+/);
    if (t[0] === 'WIRE') {
      wires.push({ x1: +t[1]!, y1: +t[2]!, x2: +t[3]!, y2: +t[4]! });
    } else if (t[0] === 'FLAG') {
      flags.push({ x: +t[1]!, y: +t[2]!, name: t[3] ?? '' });
    } else if (t[0] === 'SYMBOL') {
      cur = { sym: t[1]!, x: +t[2]!, y: +t[3]!, rot: t[4] ?? 'R0' };
      syms.push(cur);
    } else if (t[0] === 'SYMATTR' && cur) {
      if (t[1] === 'InstName') cur.name  = t.slice(2).join(' ');
      if (t[1] === 'Value')    cur.value = t.slice(2).join(' ');
    }
  }
  return { wires, flags, syms };
}

// ─── connectivity ─────────────────────────────────────────────────────────────

export function connectivity(asc: string): NetMap {
  const { wires, flags, syms } = parseAsc(asc);
  const uf = new UF();
  const pts = new Set<string>();

  interface PinRec { comp: string; idx: number; pt: [number, number]; sym: string; value: string | undefined }
  const pinRecs: PinRec[] = [];

  for (const s of syms) {
    const S = SYMBOLS[s.sym];
    if (!S) throw new SymbolError('unknown symbol in asc: ' + s.sym);
    S.pins.forEach((p, i) => {
      const rp = rot(p, s.rot as RotCode);
      const abs: [number, number] = [s.x + rp[0], s.y + rp[1]];
      pinRecs.push({ comp: s.name ?? s.sym, idx: i, pt: abs, sym: s.sym, value: s.value ?? undefined });
      pts.add(ptKey(abs[0], abs[1]));
    });
  }

  for (const f of flags) pts.add(ptKey(f.x, f.y));
  for (const w of wires) {
    pts.add(ptKey(w.x1, w.y1));
    pts.add(ptKey(w.x2, w.y2));
  }

  for (const w of wires) {
    const on = [...pts]
      .map(k => k.split(',').map(Number) as [number, number])
      .filter(([px, py]) => onSeg(px, py, w.x1, w.y1, w.x2, w.y2));
    on.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 1; i < on.length; i++) {
      uf.union(ptKey(on[i - 1]![0], on[i - 1]![1]), ptKey(on[i]![0], on[i]![1]));
    }
  }

  const groupName = new Map<string, string>();
  for (const f of flags) {
    const g = uf.find(ptKey(f.x, f.y));
    groupName.set(g, f.name === '0' ? '0' : f.name);
  }

  const nets: NetMap = new Map();
  for (const pr of pinRecs) {
    const g  = uf.find(ptKey(pr.pt[0], pr.pt[1]));
    const nk: NetKey = groupName.has(g) ? ('FLAG:' + groupName.get(g)) : ('G:' + g);
    if (!nets.has(nk)) nets.set(nk, new Set());
    nets.get(nk)!.add(`${pr.comp}:${pr.idx}`);
  }
  return nets;
}

// ─── netlistPartition ─────────────────────────────────────────────────────────

export function netlistPartition(text: string): NetMap {
  const { comps } = parseNetlist(text);
  const cls = classifyNets(comps as readonly ParsedComponent[]);
  const nets: NetMap = new Map();

  for (const c of comps) {
    c.nets.forEach((n, i) => {
      const t = cls.get(n);
      const nk: NetKey = t === 'gnd'  ? 'FLAG:0'
                       : t === 'rail' ? 'FLAG:' + railLabel(n, comps as readonly ParsedComponent[])
                       : 'NET:' + n;
      if (!nets.has(nk)) nets.set(nk, new Set());
      nets.get(nk)!.add(`${c.name}:${i}`);
    });
  }
  return nets;
}

// ─── compare ──────────────────────────────────────────────────────────────────

export function compare(nlText: string, ascText: string): string[] {
  const A = netlistPartition(nlText);
  const B = connectivity(ascText);

  const sig = (s: Set<PinSig>): string => [...s].sort().join('|');
  const errs: string[] = [];

  const mapB = new Map([...B.values()].map(v => [sig(v), v]));

  for (const [nk, pins] of A) {
    if (pins.size < 1) continue;
    if (!mapB.get(sig(pins))) {
      errs.push('missing net ' + nk + ' [' + [...pins].join(' ') + ']');
      continue;
    }
    if (nk.startsWith('FLAG:')) {
      const found = [...B.entries()].find(([, v]) => sig(v) === sig(pins));
      if (found && found[0] !== nk) errs.push('flag name mismatch ' + nk + ' vs ' + found[0]);
    }
  }

  const mapA = new Map([...A.values()].map(v => [sig(v), v]));
  for (const [nk, pins] of B) {
    if (!mapA.get(sig(pins))) errs.push('extra net in asc ' + nk + ' [' + [...pins].join(' ') + ']');
  }

  // Pin-wire proximity check
  const { wires: ascWires, flags: ascFlags, syms: ascSyms } = parseAsc(ascText);
  const pinPts = new Set<string>();
  for (const w of ascWires) { pinPts.add(ptKey(w.x1, w.y1)); pinPts.add(ptKey(w.x2, w.y2)); }
  for (const f of ascFlags) pinPts.add(ptKey(f.x, f.y));

  for (const s of ascSyms) {
    const S = SYMBOLS[s.sym];
    if (!S) continue;
    S.pins.forEach((p, i) => {
      const rp = rot(p, s.rot as RotCode);
      const ax = s.x + rp[0], ay = s.y + rp[1];
      if (pinPts.has(ptKey(ax, ay))) return;
      if (ascWires.some(w => onSeg(ax, ay, w.x1, w.y1, w.x2, w.y2))) return;
      errs.push(`pin not reached by wire: ${s.name ?? s.sym}[${i}] at ${ax},${ay}`);
    });
  }

  return errs;
}
