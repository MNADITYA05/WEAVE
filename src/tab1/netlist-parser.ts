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
 *   K                     — mutual inductance (→ directive)
 *   Q                     — BJT (3 or 4-node, polarity inferred from model name)
 *   M                     — MOSFET (3 or 4-node, polarity inferred from model name)
 *   X and unknown prefix  — subcircuit instance
 */

import type { ParsedNetlist, ParsedComponent } from '../types.js';
import { logger } from '../logger.js';
import { SYMBOLS, PREFIX2SYM, resolveSub } from './symbols.js';
import { ParseError, SymbolError } from '../errors.js';

// ─── Polarity inference regexes (BJT / MOSFET) ───────────────────────────────

const PNP  = /pnp|2n3906|2n2907|2n5401|2n4403|bc327|bc32[78]|bc55[678]|bc85[678]|bc860|mmbt390?6|mmbt2907|tip3[02]|tip42|bd13[68]|bd140|s8550|ss8550/i;
const PMOS = /pmos|irf9\d|irf954|si23\d|bss84|ao340[13]|irlml640[12]|fdn34[08]p|ndp6020p|zvp/i;
const NPN  = /npn|2n390[24]|2n222[29]|2n4401|2n5551|2n5089|bc54[789]|bc55[012]|bc337|bc817|bc84[678]|bc85[012]|mmbt390[24]|mmbt2222|tip3[13]|tip4[13]|bd13[579]|s9013|ss9013/i;
const NMOS = /nmos|irf[1-8]\d\d|bs170|2n700[02]|ao340[02]|si230\d|irlml250\d|fqp|zvn|stp/i;

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
 * @throws {Error} When an element type cannot be resolved to a known symbol
 */
export function parseNetlist(text: string): ParsedNetlist {
  const comps: ParsedComponent[] = [];
  const directives: string[] = [];

  // Join SPICE '+' continuation lines
  const joined: string[] = [];
  for (const ln of text.split(/\r?\n/)) {
    if (/^\s*\+/.test(ln) && joined.length > 0) {
      joined[joined.length - 1] += ' ' + ln.replace(/^\s*\+/, ' ');
    } else {
      joined.push(ln);
    }
  }

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
      // Mutual inductance coupling statement — not a placeable component
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
      if (P === 'Q') {
        if      (PNP.test(model)) base = 'pnp';
        else if (NPN.test(model)) base = 'npn';
        else throw new SymbolError(
          `${name}: cannot determine BJT polarity from model name "${model}" ` +
          `— model name must match a known NPN or PNP part`
        );
      } else {
        if      (PMOS.test(model)) base = 'pmos';
        else if (NMOS.test(model)) base = 'nmos';
        else throw new SymbolError(
          `${name}: cannot determine MOSFET polarity from model name "${model}" ` +
          `— model name must match a known NMOS or PMOS part`
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
      const nets = tok.slice(1, se) as string[];

      const sym = resolveSub(sub, nets.length, params);
      if (!sym) {
        throw new SymbolError(
          `${name}: unknown subckt "${sub}" with ${nets.length} pins ` +
          `— add it to symtable or define a .subckt body`
        );
      }
      if (SYMBOLS[sym]!.pins.length !== nets.length) {
        throw new SymbolError(
          `${name}: "${sub}" symbol has ${SYMBOLS[sym]!.pins.length} pins, ` +
          `netlist gives ${nets.length}`
        );
      }
      comps.push({ name, sym, nets, value: sub + (params ? ' ' + params : '') });
    }
  }

  return { comps, directives };
}
