/**
 * lib-resolver.ts — Stage 0: Standard library resolution for Situation 2 netlists
 *
 * When a netlist references components whose .model or .subckt definitions live
 * in external .lib files (not pasted inline), this module injects synthetic
 * definition lines sourced from stdlib_db.json — LTspice's own standard library,
 * pre-parsed at build time.
 *
 * The enriched text is then passed to parseNetlist() which reads those injected
 * lines exactly like inline declarations (via the pre-pass added in Situation 1).
 *
 * Parts not found in stdlib_db.json are returned in missingLibs[] so the UI can
 * tell the user exactly which .lib files to upload.
 */

import { logger } from '../logger.js';

// ─── DB shape ────────────────────────────────────────────────────────────────

interface StdlibModel {
  type: string;   // "npn" | "pnp" | "nmos" | "pmos" | "d" | "njf" | "pjf" | ...
}

interface StdlibSubckt {
  pins: string[]; // ordered pin names from the .subckt declaration
}

interface StdlibDb {
  models:  Record<string, StdlibModel>;
  subckts: Record<string, StdlibSubckt>;
}

// ─── Singleton loader ─────────────────────────────────────────────────────────

let _db: StdlibDb | null = null;

/**
 * Resolves when stdlib_db.json has been fetched and parsed.
 * Safe to await multiple times — fetch runs only once.
 */
export const stdlibReady: Promise<void> = (async (): Promise<void> => {
  try {
    const r = await fetch('data/stdlib_db.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _db = await r.json() as StdlibDb;
    logger.debug(
      `lib-resolver: stdlib loaded — ${Object.keys(_db.models).length} models, ` +
      `${Object.keys(_db.subckts).length} subckts`
    );
  } catch (e) {
    logger.warn(`lib-resolver: could not load stdlib_db.json — Situation 2 resolution disabled (${e})`);
    _db = { models: {}, subckts: {} };
  }
})();

// ─── Result type ──────────────────────────────────────────────────────────────

export interface ResolveResult {
  /** Enriched netlist text with injected .model / .subckt lines */
  text:        string;
  /** Part names that were referenced but not found in stdlib_db.json */
  missingLibs: string[];
}

// ─── resolveStdlib ────────────────────────────────────────────────────────────

/**
 * Enrich a SPICE netlist by injecting .model and .subckt lines for any
 * standard LTspice parts whose definitions are missing from the inline text.
 *
 * Must be called after stdlibReady has resolved.
 *
 * @param text - Raw netlist text (may contain .lib references)
 * @returns Enriched text + list of still-unresolved part names
 */
export function resolveStdlib(text: string): ResolveResult {
  if (!_db) {
    // stdlibReady not yet resolved — return text unchanged
    logger.warn('lib-resolver: resolveStdlib called before stdlibReady — skipping');
    return { text, missingLibs: [] };
  }

  // ── Join continuation lines ──────────────────────────────────────────────
  const joined: string[] = [];
  for (const ln of text.split(/\r?\n/)) {
    if (/^\s*\+/.test(ln) && joined.length > 0) {
      joined[joined.length - 1] += ' ' + ln.replace(/^\s*\+/, ' ');
    } else {
      joined.push(ln);
    }
  }

  // ── Collect what is already declared inline ──────────────────────────────
  const inlineModels  = new Set<string>();
  const inlineSubckts = new Set<string>();

  for (const ln of joined) {
    const s = ln.trim();
    if (/^\.model\s+(\S+)/i.test(s)) {
      const m = s.match(/^\.model\s+(\S+)/i);
      if (m) inlineModels.add(m[1]!.toLowerCase());
    }
    if (/^\.subckt\s+(\S+)/i.test(s)) {
      const m = s.match(/^\.subckt\s+(\S+)/i);
      if (m) inlineSubckts.add(m[1]!.toLowerCase());
    }
  }

  // ── Collect all model/subckt names referenced by element lines ───────────
  // We need: model name in Q/M lines, subckt name in X lines.
  const neededModels  = new Set<string>();
  const neededSubckts = new Set<string>();

  let insub = 0;
  for (let i = 1; i < joined.length; i++) {  // skip title line
    const ln = joined[i]!.trim();
    if (!ln || ln.startsWith('*') || ln.startsWith(';')) continue;

    if (/^\.subckt\b/i.test(ln)) { insub++; continue; }
    if (/^\.ends\b/i.test(ln))   { insub = Math.max(0, insub - 1); continue; }
    if (ln.startsWith('.')) continue;
    if (insub > 0) continue;

    const tok = ln.split(/\s+/);
    const name = tok[0];
    if (!name) continue;
    const P = name[0]!.toUpperCase();

    if (P === 'Q' || P === 'M') {
      // Model name is last token (strip PARAM= tail)
      let te = tok.length - 1;
      while (te > 1 && tok[te]!.includes('=')) te--;
      const model = tok[te]!.toLowerCase();
      if (!inlineModels.has(model)) neededModels.add(model);

    } else if (P === 'X' || !'RCLVIDEGFBSWATJKQM'.includes(P)) {
      // Subcircuit: name is last non-PARAM= token
      let se = tok.length - 1;
      while (se > 1 && tok[se]!.includes('=')) se--;
      const sub = tok[se]!.toLowerCase();
      if (!inlineSubckts.has(sub)) neededSubckts.add(sub);
    }
  }

  // ── Resolve against stdlib_db ────────────────────────────────────────────
  const injectedLines: string[] = [];
  const missingLibs:   string[] = [];

  for (const model of neededModels) {
    const entry = _db.models[model];
    if (entry) {
      // Inject a minimal .model line — just enough for the parser's pre-pass
      injectedLines.push(`.model ${model} ${entry.type}`);
      logger.debug(`lib-resolver: injected .model ${model} ${entry.type}`);
    } else {
      missingLibs.push(model);
      logger.debug(`lib-resolver: missing model "${model}"`);
    }
  }

  for (const sub of neededSubckts) {
    const entry = _db.subckts[sub];
    if (entry) {
      // Inject a .subckt declaration line with pin names
      injectedLines.push(`.subckt ${sub} ${entry.pins.join(' ')}`);
      injectedLines.push(`.ends ${sub}`);
      logger.debug(`lib-resolver: injected .subckt ${sub} [${entry.pins.join(', ')}]`);
    } else {
      missingLibs.push(sub);
      logger.debug(`lib-resolver: missing subckt "${sub}"`);
    }
  }

  // ── Inject lines just before .end / end of text ──────────────────────────
  // Insert after the last non-.end directive so SPICE order is preserved.
  if (injectedLines.length === 0) {
    return { text, missingLibs };
  }

  const endIdx = joined.findIndex(ln => /^\.end\b/i.test(ln.trim()));
  const insertAt = endIdx >= 0 ? endIdx : joined.length;

  const result = [
    ...joined.slice(0, insertAt),
    '* --- stdlib injected by lib-resolver ---',
    ...injectedLines,
    ...joined.slice(insertAt),
  ].join('\n');

  logger.debug(
    `lib-resolver: injected ${injectedLines.length} lines, ` +
    `${missingLibs.length} still missing`
  );

  return { text: result, missingLibs };
}

/**
 * Parse user-supplied .lib file text and inject its definitions into a netlist.
 *
 * Used by the "upload missing .lib files" flow: the user uploads the .lib file,
 * we extract its .model and .subckt lines and prepend them to the netlist text
 * so parseNetlist() sees them as inline declarations.
 *
 * @param netlistText - The original netlist text
 * @param libTexts    - Contents of one or more uploaded .lib files
 * @returns Enriched netlist text with uploaded lib definitions injected
 */
export function injectUserLibs(netlistText: string, libTexts: string[]): string {
  const extracted: string[] = [];

  for (const lib of libTexts) {
    // Join continuation lines
    const lines: string[] = [];
    for (const ln of lib.split(/\r?\n/)) {
      if (/^\s*\+/.test(ln) && lines.length > 0) {
        lines[lines.length - 1] += ' ' + ln.replace(/^\s*\+/, ' ');
      } else {
        lines.push(ln);
      }
    }

    let insub = 0;
    for (const ln of lines) {
      const s = ln.trim();
      if (!s || s.startsWith('*') || s.startsWith(';')) continue;
      if (/^\.subckt\b/i.test(s)) { insub++; extracted.push(s); continue; }
      if (/^\.ends\b/i.test(s))   { insub = Math.max(0, insub - 1); extracted.push(s); continue; }
      if (insub > 0) { extracted.push(s); continue; }
      if (/^\.model\b/i.test(s))  { extracted.push(s); continue; }
    }
  }

  if (extracted.length === 0) return netlistText;

  const joined = netlistText.split(/\r?\n/);
  const endIdx = joined.findIndex(ln => /^\.end\b/i.test(ln.trim()));
  const insertAt = endIdx >= 0 ? endIdx : joined.length;

  return [
    ...joined.slice(0, insertAt),
    '* --- user-supplied lib injected by lib-resolver ---',
    ...extracted,
    ...joined.slice(insertAt),
  ].join('\n');
}
