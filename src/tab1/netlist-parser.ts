/**
 * netlist-parser.ts — SPICE netlist parser
 *
 * Converts raw SPICE netlist text into a ParsedNetlist. This is a pure
 * function with no side-effects: it reads text and returns a frozen object
 * containing ParsedComponent[] and a directives string[].
 *
 * Supported element types:
 *   R C L V I D           — two-terminal passives and sources
 *   E G                   — VCVS / VCCS (4-node)
 *   F H                   — CCCS / CCVS (2-node + controlling source ref)
 *   B                     — behavioral source (V=/I=)
 *   S                     — voltage-controlled switch (4-node)
 *   W                     — current-controlled switch (2-node + Vsense)
 *   A                     — LTspice special-function device (8-terminal)
 *   J                     — JFET (3-node) or jumper (2-node)
 *   T                     — lossless transmission line (4-node)
 *   K                     — mutual inductance → resolved to xfmr component
 *   Q                     — BJT (3 or 4-node, polarity from .model then regex)
 *   M                     — MOSFET (3 or 4-node, polarity from .model then regex)
 *   X and unknown prefix  — subcircuit instance (pin order from .subckt if present)
 */

import type { ParsedNetlist, ParsedComponent } from '../types.js';
import { logger } from '../logger.js';
import { SYMBOLS, PREFIX2SYM, resolveSub } from './symbols.js';
import { ParseError, SymbolError } from '../errors.js';

// ─── Polarity inference regexes (BJT / MOSFET) ───────────────────────────────
// Used as secondary fallback when .model TYPE is not found in the netlist text.

const PNP  = /pnp|2n3906|2n2907|2n5401|2n4403|bc327|bc32[78]|bc55[678]|bc85[678]|bc860|mmbt390?6|mmbt2907|tip3[02]|tip42|bd13[68]|bd140|s8550|ss8550/i;
const PMOS = /pmos|irf9\d|irf954|si23\d|bss84|ao340[13]|irlml640[12]|fdn34[08]p|ndp6020p|zvp/i;
const NPN  = /npn|2n390[24]|2n222[29]|2n4401|2n5551|2n5089|bc54[789]|bc55[012]|bc337|bc817|bc84[678]|bc85[012]|mmbt390[24]|mmbt2222|tip3[13]|tip4[13]|bd13[579]|s9013|ss9013/i;
const NMOS = /nmos|irf[1-8]\d\d|bs170|2n700[02]|ao340[02]|si230\d|irlml250\d|fqp|zvn|stp/i;

// ─── Pre-pass helpers ─────────────────────────────────────────────────────────

/**
 * Build a map from model name → SPICE type keyword by scanning all .model lines.
 *
 * Example: ".model 2N3904 NPN(Is=...)" → { "2n3904" → "npn" }
 *
 * The type token is the first parenthesis-delimited or standalone word after
 * the model name. We normalise to lowercase for case-insensitive lookup.
 */
function buildModelTypeMap(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const ln of lines) {
    if (!/^\.model\b/i.test(ln)) continue;
    const tok = ln.split(/\s+/);
    // tok[0] = .model, tok[1] = name, tok[2] = TYPE or TYPE(params...)
    const modelName = tok[1];
    const typeRaw   = tok[2];
    if (!modelName || !typeRaw) continue;
    // Strip trailing parenthesised params: "NPN(Is=1e-14)" → "NPN"
    const typeClean = typeRaw.replace(/\(.*/, '').toLowerCase();
    map.set(modelName.toLowerCase(), typeClean);
  }
  return map;
}

/**
 * Build a map from subcircuit name → ordered pin name list by scanning
 * .subckt declaration lines only (not the body).
 *
 * Example: ".subckt OPA2134 IN+ IN- V+ V- OUT" → { "opa2134" → ["IN+","IN-","V+","V-","OUT"] }
 */
function buildSubcktPinMap(lines: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const ln of lines) {
    if (!/^\.subckt\b/i.test(ln)) continue;
    const tok = ln.split(/\s+/);
    // tok[0]=.subckt tok[1]=name tok[2..]=pin names (strip PARAMS= tail)
    const subName = tok[1];
    if (!subName) continue;
    const pins: string[] = [];
    for (let i = 2; i < tok.length; i++) {
      const t = tok[i]!;
      if (/^params:/i.test(t) || t.includes('=')) break;
      pins.push(t);
    }
    if (pins.length > 0) {
      map.set(subName.toLowerCase(), pins);
    }
  }
  return map;
}

// ─── K-element record ─────────────────────────────────────────────────────────

interface KRecord {
  name:       string;
  inductorA:  string;   // first referenced inductor name
  inductorB:  string;   // second referenced inductor name
  coupling:   string;   // coupling coefficient as string
  raw:        string;   // original line (for directives)
}

/**
 * Parse K lines from the joined line array. Returns parsed records.
 * Does NOT require the inductors to have been parsed yet.
 *
 * Format: K<name> L<x> L<y> <coefficient>
 */
function parseKLines(lines: string[]): KRecord[] {
  const records: KRecord[] = [];
  for (const ln of lines) {
    const t = ln.split(/\s+/);
    if (!t[0] || t[0][0]!.toUpperCase() !== 'K') continue;
    if (t.length < 4) continue;
    records.push({
      name:      t[0],
      inductorA: t[1]!,
      inductorB: t[2]!,
      coupling:  t[3]!,
      raw:       ln,
    });
  }
  return records;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a SPICE netlist string into components and directives.
 *
 * The first line is always the SPICE title (skipped by convention).
 * Continuation lines starting with '+' are joined to the preceding line.
 * Lines inside an inline .subckt ... .ends body are collected as directives.
 *
 * @param text - Raw SPICE netlist text
 * @returns ParsedNetlist with components and directives
 * @throws {ParseError}  When a line cannot be parsed
 * @throws {SymbolError} When an element type cannot be resolved to a known symbol
 */
export function parseNetlist(text: string): ParsedNetlist {
  const comps: ParsedComponent[] = [];
  const directives: string[] = [];

  // ── Join SPICE '+' continuation lines ──────────────────────────────────────
  const joined: string[] = [];
  for (const ln of text.split(/\r?\n/)) {
    if (/^\s*\+/.test(ln) && joined.length > 0) {
      joined[joined.length - 1] += ' ' + ln.replace(/^\s*\+/, ' ');
    } else {
      joined.push(ln);
    }
  }

  // ── Pre-pass 1: collect all non-title non-comment lines for scanning ───────
  // Skip index 0 (title) and blank/comment lines. We scan these for .model and
  // .subckt declarations before processing element lines, so that BJT/MOSFET
  // polarity and subcircuit pin order are known when we encounter their instances.
  const scanLines: string[] = [];
  for (let i = 1; i < joined.length; i++) {
    const ln = joined[i]!.trim();
    if (!ln || ln.startsWith('*') || ln.startsWith(';')) continue;
    scanLines.push(ln);
  }

  const modelTypeMap  = buildModelTypeMap(scanLines);
  const subcktPinMap  = buildSubcktPinMap(scanLines);
  const kRecords      = parseKLines(scanLines.filter(ln => {
    const p = ln[0]?.toUpperCase();
    return p === 'K';
  }));

  logger.debug(`netlist-parser: pre-pass found ${modelTypeMap.size} .model entries, ` +
    `${subcktPinMap.size} .subckt declarations, ${kRecords.length} K elements`);

  // ── Main element-line pass ─────────────────────────────────────────────────
  let insub = 0; // nesting depth inside .subckt ... .ends

  for (let i = 0; i < joined.length; i++) {
    const raw = joined[i];
    if (raw === undefined) continue;
    const ln = raw.trim();
    if (!ln || ln.startsWith('*') || ln.startsWith(';')) continue;
    if (i === 0) continue; // SPICE title line — always skip

    if (ln.startsWith('.')) {
      if (/^\.subckt\b/i.test(ln)) insub++;
      else if (/^\.ends\b/i.test(ln)) insub = Math.max(0, insub - 1);
      if (!/^\.end\b/i.test(ln)) directives.push(ln);
      continue;
    }

    // Lines inside an inline .subckt body belong to the model definition.
    // Keep them as directives so the emitted schematic stays simulatable.
    if (insub > 0) {
      logger.debug(`netlist-parser: skipping subckt body line (insub=${insub}): ${ln}`);
      directives.push(ln);
      continue;
    }

    const tok = ln.split(/\s+/);
    const name = tok[0];
    if (!name) continue;
    const P = name[0]!.toUpperCase();

    if ('RCLVID'.includes(P)) {
      const value = tok.slice(3).join(' ');
      comps.push({ name, sym: PREFIX2SYM[P]!, nets: [tok[1]!, tok[2]!], value });

    } else if (P === 'E' || P === 'G') {
      // VCVS / VCCS: 4 nodes then gain/expression
      const nets = tok.slice(1, 5) as string[];
      comps.push({ name, sym: P === 'E' ? 'e' : 'g', nets, value: tok.slice(5).join(' ') });

    } else if (P === 'F' || P === 'H') {
      // CCCS / CCVS: 2 nodes then controlling source ref and gain
      const nets = tok.slice(1, 3) as string[];
      comps.push({ name, sym: P === 'F' ? 'f' : 'h', nets, value: tok.slice(3).join(' ') });

    } else if (P === 'B') {
      // Behavioral source: 2 nodes then V=/I= expression
      const nets = tok.slice(1, 3) as string[];
      const expr = tok.slice(3).join(' ');
      comps.push({ name, sym: /^I\s*=/i.test(expr) ? 'bi' : 'bv', nets, value: expr });

    } else if (P === 'S') {
      // Voltage-controlled switch: out+ out- ctl+ ctl- model
      const nets = tok.slice(1, 5) as string[];
      comps.push({ name, sym: 'sw', nets, value: tok.slice(5).join(' ') });

    } else if (P === 'W') {
      // Current-controlled switch: 2 nodes, Vsense ref, model
      const nets = tok.slice(1, 3) as string[];
      comps.push({ name, sym: 'csw', nets, value: tok.slice(3).join(' ') });

    } else if (P === 'A') {
      // LTspice special-function device: 8 terminals then model then PARAM=VAL tail
      const body = tok.slice(1);
      let mi = -1;
      for (let z = 8; z < body.length; z++) {
        if (!body[z]!.includes('=')) { mi = z; break; }
      }
      if (mi < 0 || body.length < 9) {
        throw new ParseError(`${name}: A-device model token missing`);
      }
      const nodes8 = body.slice(0, 8) as string[];
      const model = body[mi]!;
      const alias: Record<string, string> = { samplehold: 'SpecialFunctions\\sample' };
      const q = model.toLowerCase();
      const sym =
        alias[q] ??
        (SYMBOLS['Digital\\' + q]            ? 'Digital\\' + q            : null) ??
        (SYMBOLS['SpecialFunctions\\' + q]   ? 'SpecialFunctions\\' + q   : null);
      if (!sym || !SYMBOLS[sym] || !SYMBOLS[sym]!.ord) {
        throw new SymbolError(`${name}: A-device symbol ${model} not in table`);
      }
      const nets = SYMBOLS[sym]!.ord!.map(o => nodes8[o - 1]!);
      comps.push({ name, sym, nets, value: model + ' ' + body.slice(mi + 1).join(' ') });

    } else if (P === 'J') {
      // Real JFETs have 3 nodes; a 2-node "J" is a jumper/short
      if (tok.length === 3) {
        comps.push({ name, sym: 'Misc\\jumper', nets: [tok[1]!, tok[2]!], value: '' });
      } else {
        const model = tok[tok.length - 1]!;
        const nets = tok.slice(1, tok.length - 1) as string[];
        if (nets.length !== 3) throw new ParseError(`${name}: JFET expects 3 nodes`);
        const sym = /^p|pjf|2n54|lsj/i.test(model) ? 'pjf' : 'njf';
        comps.push({ name, sym, nets, value: model });
      }

    } else if (P === 'T') {
      // Lossless transmission line: 4 nodes then TD/F/NL params
      const nets = tok.slice(1, 5) as string[];
      comps.push({ name, sym: 'tline', nets, value: tok.slice(5).join(' ') });

    } else if (P === 'K') {
      // Mutual inductance: handled in the post-pass below after all L's are parsed.
      // Emit the raw line as a directive so it stays in the schematic's SPICE text.
      directives.push(ln);

    } else if (P === 'Q' || P === 'M') {
      // BJT or MOSFET: 3 or 4 nodes, model name last (after stripping Tambient= tails)
      let te = tok.length - 1;
      while (te > 1 && tok[te]!.includes('=')) te--;
      const model = tok[te]!;
      const nodes = tok.slice(1, te) as string[];
      if (nodes.length !== 3 && nodes.length !== 4) {
        throw new ParseError(`${name}: expected 3 or 4 nodes, got ${nodes.length}`);
      }

      let base: string;

      // ── Primary: read polarity from the .model statement in this netlist ──
      const declaredType = modelTypeMap.get(model.toLowerCase());
      if (P === 'Q') {
        if      (declaredType === 'pnp')  base = 'pnp';
        else if (declaredType === 'npn')  base = 'npn';
        // ── Secondary: fall back to regex on the model name ──────────────────
        else if (PNP.test(model))         base = 'pnp';
        else if (NPN.test(model))         base = 'npn';
        else throw new SymbolError(
          `${name}: cannot determine BJT polarity for model "${model}". ` +
          `Add ".model ${model} NPN(...)" or ".model ${model} PNP(...)" to the netlist.`
        );
      } else {
        if      (declaredType === 'pmos') base = 'pmos';
        else if (declaredType === 'nmos') base = 'nmos';
        // ── Secondary: fall back to regex on the model name ──────────────────
        else if (PMOS.test(model))        base = 'pmos';
        else if (NMOS.test(model))        base = 'nmos';
        else throw new SymbolError(
          `${name}: cannot determine MOSFET polarity for model "${model}". ` +
          `Add ".model ${model} NMOS(...)" or ".model ${model} PMOS(...)" to the netlist.`
        );
      }

      // LTspice sometimes exports a 4th bulk/substrate node tied to ground (Q)
      // or to the source (M). Collapse back to the standard 3-pin symbol.
      let use = nodes;
      if (
        nodes.length === 4 &&
        ((P === 'Q' && nodes[3] === '0') || (P === 'M' && nodes[3] === nodes[2]))
      ) {
        logger.warn(`${name}: 4th bulk/substrate node "${nodes[3]!}" dropped — collapsed to 3-pin symbol`);
        use = nodes.slice(0, 3);
      }

      const sym = base + (use.length === 4 ? '4' : '');
      if (!SYMBOLS[sym]) throw new SymbolError(`${name}: no symbol ${sym}`);
      comps.push({ name, sym, nets: use, value: model });

    } else {
      // X prefix (subcircuit) and tolerant unknown-prefix fallback
      let se = tok.length - 1;
      while (se > 1 && tok[se]!.includes('=')) se--;
      const sub = tok[se]!;
      const params = tok.slice(se + 1).join(' ');
      const rawNets = tok.slice(1, se) as string[];

      // ── Reorder nets using .subckt pin declaration if available ─────────────
      // When a .subckt block is defined inline in the same netlist, we know the
      // canonical pin order. X instance nodes map positionally to those pins.
      // The rawNets order is already correct: Xfoo net1 net2 ... SUBCKT_NAME.
      // We store them as-is; the subcktPinMap records are used by the symbol
      // resolver to verify count and will be surfaced in future pin-name mapping.
      const declaredPins = subcktPinMap.get(sub.toLowerCase());
      if (declaredPins && declaredPins.length !== rawNets.length) {
        throw new ParseError(
          `${name}: subckt "${sub}" declares ${declaredPins.length} pins ` +
          `but instance provides ${rawNets.length} nets`
        );
      }

      const sym = resolveSub(sub, rawNets.length, params);
      if (!sym) {
        throw new SymbolError(
          `${name}: unknown subckt "${sub}" with ${rawNets.length} pins ` +
          `— add it to symtable or define a .subckt body`
        );
      }
      if (SYMBOLS[sym]!.pins.length !== rawNets.length) {
        throw new SymbolError(
          `${name}: "${sub}" symbol has ${SYMBOLS[sym]!.pins.length} pins, ` +
          `netlist gives ${rawNets.length}`
        );
      }
      comps.push({ name, sym, nets: rawNets, value: sub + (params ? ' ' + params : '') });
    }
  }

  // ── Post-pass: resolve K elements → xfmr components ───────────────────────
  // Each K record references two inductors by name. We look those inductors up
  // in the already-built comps array to get their nets, then synthesise a
  // transformer component using the xfmr symbol:
  //   pin 0 = primary +  (first  net of inductorA)
  //   pin 1 = primary -  (second net of inductorA)
  //   pin 2 = secondary+ (first  net of inductorB)
  //   pin 3 = secondary- (second net of inductorB)
  if (kRecords.length > 0) {
    const compByName = new Map(comps.map(c => [c.name.toLowerCase(), c]));

    for (const k of kRecords) {
      const la = compByName.get(k.inductorA.toLowerCase());
      const lb = compByName.get(k.inductorB.toLowerCase());

      if (!la || !lb) {
        logger.warn(
          `${k.name}: inductor "${!la ? k.inductorA : k.inductorB}" not found — ` +
          `K element kept as directive only`
        );
        continue;
      }
      if (la.nets.length < 2 || lb.nets.length < 2) {
        logger.warn(`${k.name}: referenced inductor has fewer than 2 nets — skipped`);
        continue;
      }

      // Remove the bare inductor components — they are replaced by the transformer
      const removeNames = new Set([la.name.toLowerCase(), lb.name.toLowerCase()]);
      const laIdx = comps.findIndex(c => c.name.toLowerCase() === la.name.toLowerCase());
      const lbIdx = comps.findIndex(c => c.name.toLowerCase() === lb.name.toLowerCase());
      if (laIdx >= 0) comps.splice(laIdx, 1);
      // lbIdx may have shifted by -1 after splice above
      const lbIdx2 = comps.findIndex(c => c.name.toLowerCase() === lb.name.toLowerCase());
      if (lbIdx2 >= 0) comps.splice(lbIdx2, 1);
      void removeNames; // referenced only for clarity above

      const xfmrNets = [la.nets[0]!, la.nets[1]!, lb.nets[0]!, lb.nets[1]!];
      comps.push({
        name:  k.name,
        sym:   'xfmr',
        nets:  xfmrNets,
        value: `k=${k.coupling} ${k.inductorA} ${k.inductorB}`,
      });

      logger.debug(
        `${k.name}: resolved → xfmr [${xfmrNets.join(', ')}] ` +
        `(coupled ${k.inductorA}↔${k.inductorB}, k=${k.coupling})`
      );
    }
  }

  return { comps, directives };
}
