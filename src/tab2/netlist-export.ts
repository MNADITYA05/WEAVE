/**
 * netlist-export.ts — SPICE netlist generation, LTspice .asc export, ERC
 */
import type { RotCode } from './types.js';
import { SYMDEFS, LOGIC_BEXPR } from './schematic-symbols.js';
import type { SymDef } from './schematic-symbols.js';
import { S } from './state.js';
import { rotPt, getEffectivePins } from './rotation.js';
import { onSeg } from '../shared/geometry.js';
import { UF } from '../shared/union-find.js';

// ─── Netlist generation ───────────────────────────────────────────────────────

export function generateNetlist(): string {
  const uf  = new UF();
  const pts = new Set<string>();
  for (const w of S.wires) { pts.add(w.x1 + ',' + w.y1); pts.add(w.x2 + ',' + w.y2); }
  for (const c of S.comps) {
    const def: SymDef | undefined = SYMDEFS[c.type]; if (!def) continue;
    // Fix 5: use effective pins so X subcircuit nets are correct
    for (const p of getEffectivePins(c)) {
      const rp = rotPt(p, c.rot);
      pts.add((c.x + rp[0]) + ',' + (c.y + rp[1]));
    }
  }
  const ptArr = [...pts].map(k => k.split(',').map(Number) as [number, number]);
  for (const w of S.wires) {
    const sp = ptArr.filter(([px, py]) => onSeg(px, py, w.x1, w.y1, w.x2, w.y2));
    sp.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    for (let i = 1; i < sp.length; i++) {
      uf.union(sp[i - 1]![0] + ',' + sp[i - 1]![1], sp[i]![0] + ',' + sp[i]![1]);
    }
  }
  const gname = new Map<string, string>();
  for (const c of S.comps) {
    const def: SymDef | undefined = SYMDEFS[c.type]; if (!def?.netName) continue;
    const rp = rotPt(def.pins[0]!, c.rot);
    const k = (c.x + rp[0]) + ',' + (c.y + rp[1]);
    gname.set(uf.find(k), def.netName);
  }
  // Net labels: register their position and name in the UF
  for (const lbl of S.labels) {
    const k = lbl.x + ',' + lbl.y;
    if (!pts.has(k)) pts.add(k);
    uf.union(k, k); // ensure it exists in uf
    gname.set(uf.find(k), lbl.name.trim() || ('L' + lbl.id));
  }
  let ai = 1;
  const netOf = (k: string): string => {
    const g = uf.find(k);
    if (!gname.has(g)) gname.set(g, 'N' + String(ai++).padStart(3, '0'));
    return gname.get(g)!;
  };

  const lines = ['* Weave schematic editor', ''];
  const swModelCards: string[] = [];

  for (const c of S.comps) {
    const def: SymDef | undefined = SYMDEFS[c.type];
    if (!def || def.netName) continue;
    if (!c.name) continue;
    // Fix 5: use effective pins for net resolution
    const nets = getEffectivePins(c).map(p => {
      const rp = rotPt(p, c.rot);
      return netOf((c.x + rp[0]) + ',' + (c.y + rp[1]));
    });
    const name = c.name, val = c.value || '?', pfx = name[0]!.toUpperCase();
    const model = c.extra?.model ?? val;
    let line: string;
    if ('RCL'.includes(pfx))       line = `${name} ${nets[0]} ${nets[1]} ${val}`;
    else if (pfx === 'D')          line = `${name} ${nets[0]} ${nets[1]} ${model}`;
    else if (pfx === 'Q')          line = `${name} ${nets[0]} ${nets[1]} ${nets[2]} ${model}`;
    else if (pfx === 'M') {
      const bulk = nets[3] ?? c.extra?.bulk?.trim() ?? nets[2];
      line = `${name} ${nets[0]} ${nets[1]} ${nets[2]} ${bulk} ${model}`;
    }
    else if (pfx === 'J')          line = `${name} ${nets[0]} ${nets[1]} ${nets[2]} ${model}`;
    else if ('VI'.includes(pfx))   line = `${name} ${nets[0]} ${nets[1]} ${val}`;
    else if ('EG'.includes(pfx))   line = `${name} ${nets[0]} ${nets[1]} ${nets[2] ?? '?'} ${nets[3] ?? '?'} ${val}`;
    else if ('FH'.includes(pfx))   line = `${name} ${nets[0]} ${nets[1]} ${c.extra?.csrc ?? 'VSRC_UNDEFINED'} ${val}`;
    else if (pfx === 'B')          line = `${name} ${nets[0]} ${nets[1]} ${val}`;
    else if (pfx === 'X')          line = `${name} ${nets.join(' ')} ${model}`;
    else if (pfx === 'K')          line = `${name} ${c.extra?.L1 ?? 'L?'} ${c.extra?.L2 ?? 'L?'} ${val}`;
    // Fix 6: S/W use named model, emit .model card
    else if (pfx === 'S') {
      const swMod = c.extra?.model?.trim() || (name + 'mod');
      line = `${name} ${nets[0]} ${nets[1]} ${nets[2] ?? '?'} ${nets[3] ?? '?'} ${swMod}`;
      swModelCards.push(`.model ${swMod} SW(Ron=1 Roff=1Meg Vt=0.5 Vh=0)`);
    }
    else if (pfx === 'W') {
      const swMod = c.extra?.model?.trim() || (name + 'mod');
      line = `${name} ${nets[0]} ${nets[1]} ${c.extra?.csrc ?? 'VSRC_UNDEFINED'} ${swMod}`;
      swModelCards.push(`.model ${swMod} SW(Ron=1 Roff=1Meg Vt=0.5 Vh=0)`);
    }
    else if (c.type === 'XFMR') {
      // Transformer: auto-emit two inductors + coupling K line
      const lp = c.extra?.Lp?.trim() || '1m';
      const ls = c.extra?.Ls?.trim() || '1m';
      const kv = c.extra?.k?.trim()  || '0.99';
      lines.push(`L${name}P ${nets[0] ?? '?'} ${nets[1] ?? '?'} ${lp}`);
      lines.push(`L${name}S ${nets[2] ?? '?'} ${nets[3] ?? '?'} ${ls}`);
      line = `K${name} L${name}P L${name}S ${kv}`;
    }
    else if (pfx === 'T')          line = `${name} ${nets[0]} ${nets[1]} ${nets[2] ?? '?'} ${nets[3] ?? '?'} ${val}`;
    else if (pfx === 'U') {
      // Logic gate: emit B-element behavioral source
      const expr = LOGIC_BEXPR[c.type];
      if (expr) { line = expr(nets); }
      else       { line = `* unknown logic gate ${c.type} ${name}`; }
    }
    else                           line = `${name} ${nets.join(' ')} ${val}`;
    lines.push(line);
    // Append SpiceLine params inline (e.g. W=10u L=180n for MOSFET)
    const sl1 = c.extra?.spiceLine?.trim();
    const sl2 = c.extra?.spiceLine2?.trim();
    if (sl1) lines.push(`+ ${sl1}`);
    if (sl2) lines.push(`+ ${sl2}`);
  }

  // Fix 6: emit collected .model cards
  if (swModelCards.length > 0) {
    lines.push('');
    lines.push(...[...new Set(swModelCards)]);
  }
  // Emit SPICE directives (simulation commands, .param, .meas, etc.)
  const dirLines = S.directives
    .map(d => d.text.trim())
    .filter(t => t.length > 0);
  if (dirLines.length > 0) {
    lines.push('');
    lines.push(...dirLines);
  }
  lines.push('', '.end');
  return lines.join('\n');
}

// ─── LTspice .asc export ─────────────────────────────────────────────────────

// Our RotCode → LTspice rotation token
function rotToLtspice(rot: RotCode): string {
  const map: Record<RotCode, string> = {
    R0: 'R0', R90: 'R90', R180: 'R180', R270: 'R270',
    MR0: 'M0', MR90: 'M90', MR180: 'M180', MR270: 'M270',
  };
  return map[rot] ?? 'R0';
}

// Our component type → LTspice built-in symbol name
const LTSPICE_SYM: Partial<Record<string, string | null>> = {
  // Passives
  R: 'res', C: 'cap', L: 'ind',
  // Sources
  V: 'voltage', I: 'current',
  E: 'e', G: 'g', F: 'f', H: 'h', B: 'bv',
  // Semiconductors
  D: 'diode', LED: 'diode', ZENER: 'zener', SCHOTTKY: 'schottky',
  Q_NPN: 'npn', Q_PNP: 'pnp',
  M_NMOS: 'nmos4', M_PMOS: 'pmos4',
  J_N: 'njf', J_P: 'pjf',
  // Switches & transmission line
  S: 'sw', W: 'csw', T: 'tline',
  // Logic gates (no native LTspice sym — emitted as TEXT B-element)
  AND2: null, OR2: null, NAND2: null, NOR2: null,
  XOR2: null, XNOR2: null, NOT: null, BUF: null,
  // Op-amp: subcircuit
  OPAMP: null,
  // Transformer: handled separately (emits L+K TEXT lines)
  XFMR: null,
};

export function generateAsc(): string {
  const out: string[] = ['Version 4', 'SHEET 1 4000 4000'];

  // ── Wires ──
  for (const w of S.wires) {
    out.push(`WIRE ${w.x1} ${w.y1} ${w.x2} ${w.y2}`);
  }

  // ── Power/net-name symbols → FLAG ──
  for (const c of S.comps) {
    const def: SymDef | undefined = SYMDEFS[c.type];
    if (!def?.netName) continue;
    const pin = def.pins[0];
    if (!pin) continue;
    const [rpx, rpy] = rotPt(pin, c.rot);
    const fx = c.x + rpx, fy = c.y + rpy;
    out.push(`FLAG ${fx} ${fy} ${def.netName}`);
    if (def.netName !== '0') {
      // IOPIN marks it as a named power rail rather than a floating node
      out.push(`IOPIN ${fx} ${fy} BiDir`);
    }
  }

  // ── Net labels → FLAG ──
  for (const lbl of S.labels) {
    out.push(`FLAG ${lbl.x} ${lbl.y} ${lbl.name}`);
  }

  // ── Components → SYMBOL blocks ──
  for (const c of S.comps) {
    const def: SymDef | undefined = SYMDEFS[c.type];
    if (!def || def.netName) continue;
    if (!c.name) continue;

    const pfx = c.name[0]?.toUpperCase() ?? '';

    // K (mutual inductance) has no LTspice symbol — emit as SPICE directive text
    if (pfx === 'K') {
      const txt = `!K ${c.extra?.L1 ?? 'L?'} ${c.extra?.L2 ?? 'L?'} ${c.value}`;
      out.push(`TEXT ${c.x} ${c.y} Left 2 ${txt}`);
      continue;
    }

    // Transformer — emit L + K TEXT lines, no SYMBOL block
    if (c.type === 'XFMR') {
      const lp = c.extra?.Lp?.trim() || '1m';
      const ls = c.extra?.Ls?.trim() || '1m';
      const kv = c.extra?.k?.trim()  || '0.99';
      out.push(`TEXT ${c.x} ${c.y - 32} Left 2 !L${c.name}P ${SYMDEFS.XFMR ? '' : ''}${c.name}_p1 ${c.name}_p2 ${lp}`);
      out.push(`TEXT ${c.x} ${c.y - 20} Left 2 !L${c.name}S ${c.name}_s1 ${c.name}_s2 ${ls}`);
      out.push(`TEXT ${c.x} ${c.y - 8}  Left 2 !K${c.name} L${c.name}P L${c.name}S ${kv}`);
      continue;
    }

    // Logic gate — no native LTspice symbol; emit B-element as SPICE directive
    if (LOGIC_BEXPR[c.type]) {
      const netmap = getEffectivePins(c).map(p => {
        const rp = rotPt(p, c.rot);
        return (c.x + rp[0]) + ',' + (c.y + rp[1]);
      });
      out.push(`TEXT ${c.x} ${c.y} Left 2 !; logic ${c.type} ${c.name} (see netlist)`);
      continue;
    }

    // OPAMP — subcircuit using model name as value
    // X (subcircuit) — symbol name is the subcircuit type (value field)
    const symName = c.type === 'OPAMP'
      ? (c.extra?.model?.trim() || c.value || 'opamp')
      : pfx === 'X'
        ? (c.value || 'unknown')
        : (LTSPICE_SYM[c.type] as string | undefined ?? c.type.toLowerCase());

    const rot = rotToLtspice(c.rot);
    out.push(`SYMBOL ${symName} ${c.x} ${c.y} ${rot}`);
    out.push(`SYMATTR InstName ${c.name}`);

    // Value / model per element class
    if (['Q_NPN', 'Q_PNP', 'M_NMOS', 'M_PMOS', 'J_N', 'J_P', 'D', 'LED', 'ZENER', 'SCHOTTKY', 'OPAMP'].includes(c.type)) {
      // Model-referenced: LTspice Value = model name
      out.push(`SYMATTR Value ${c.extra?.model?.trim() || c.value}`);
    } else if (pfx === 'S' || pfx === 'W') {
      const swMod = c.extra?.model?.trim() || (c.name + 'mod');
      out.push(`SYMATTR Value ${swMod}`);
    } else if (pfx === 'X') {
      // subcircuit: value already used as symName; set SpiceLine for pin order if needed
      out.push(`SYMATTR Value ${c.value}`);
    } else {
      out.push(`SYMATTR Value ${c.value}`);
    }

    // Extra attrs
    if (pfx === 'F' || pfx === 'H' || pfx === 'W') {
      const csrc = c.extra?.csrc?.trim();
      if (csrc) out.push(`SYMATTR Value2 ${csrc}`);
    }
    if (['M_NMOS', 'M_PMOS'].includes(c.type) && c.extra?.bulk?.trim()) {
      out.push(`SYMATTR Value2 ${c.extra.bulk}`);
    }
    // SpiceLine / SpiceLine2 — extra SPICE params (W=10u L=180n, Rser=10m, etc.)
    const asc_sl1 = c.extra?.spiceLine?.trim();
    const asc_sl2 = c.extra?.spiceLine2?.trim();
    if (asc_sl1) out.push(`SYMATTR SpiceLine ${asc_sl1}`);
    if (asc_sl2) out.push(`SYMATTR SpiceLine2 ${asc_sl2}`);
  }

  // ── Directives → TEXT ──
  for (const d of S.directives) {
    const dlines = d.text.trim().split('\n');
    let dy = 0;
    for (const dl of dlines) {
      const t = dl.trim();
      if (!t) continue;
      // LTspice SPICE directive prefix: '!' for directives, ';' for comments
      const content = t.startsWith('!') ? t : ('!' + t);
      out.push(`TEXT ${d.x} ${d.y + dy} Left 2 ${content}`);
      dy += 16;
    }
  }

  return out.join('\n');
}


// ─── ERC ─────────────────────────────────────────────────────────────────────

interface ERCIssue { severity: 'error' | 'warn'; msg: string; }

export function runERC(): void {
  const issues: ERCIssue[] = [];

  // Build UF for net connectivity (same logic as generateNetlist)
  const uf2 = new UF();
  const pts2 = new Set<string>();
  for (const w of S.wires) { pts2.add(w.x1+','+w.y1); pts2.add(w.x2+','+w.y2); }
  for (const c of S.comps) {
    const def: SymDef | undefined = SYMDEFS[c.type]; if (!def) continue;
    for (const p of getEffectivePins(c)) {
      const rp = rotPt(p, c.rot);
      pts2.add((c.x+rp[0])+','+(c.y+rp[1]));
    }
  }
  const ptArr2 = [...pts2].map(k => k.split(',').map(Number) as [number,number]);
  for (const w of S.wires) {
    const sp = ptArr2.filter(([px,py]) => onSeg(px,py,w.x1,w.y1,w.x2,w.y2));
    sp.sort((a,b) => a[0]!-b[0]! || a[1]!-b[1]!);
    for (let i=1;i<sp.length;i++) uf2.union(sp[i-1]![0]+','+sp[i-1]![1], sp[i]![0]+','+sp[i]![1]);
  }
  for (const lbl of S.labels) {
    const k = lbl.x+','+lbl.y;
    uf2.union(k,k);
  }

  // Named nets (power symbols + labels)
  const gname2 = new Map<string,string>();
  for (const c of S.comps) {
    const def: SymDef|undefined = SYMDEFS[c.type]; if (!def?.netName) continue;
    const rp = rotPt(def.pins[0]!, c.rot);
    const k = (c.x+rp[0])+','+(c.y+rp[1]);
    gname2.set(uf2.find(k), def.netName);
  }
  for (const lbl of S.labels) {
    const k = lbl.x+','+lbl.y;
    gname2.set(uf2.find(k), lbl.name.trim() || ('L'+lbl.id));
  }

  // 1. No ground node
  const hasGnd = [...gname2.values()].some(v => v === '0');
  if (!hasGnd) issues.push({ severity:'error', msg:'No ground (GND/net 0) in schematic. SPICE requires a node 0 reference.' });

  // 2. Duplicate ref designators
  const seen = new Map<string,number>();
  for (const c of S.comps) {
    const def: SymDef|undefined = SYMDEFS[c.type]; if (def?.netName) continue; // power symbols skip
    const nm = (c.name ?? '').trim();
    if (!nm) continue;
    seen.set(nm, (seen.get(nm) ?? 0) + 1);
  }
  for (const [nm, cnt] of seen) {
    if (cnt > 1) issues.push({ severity:'error', msg:`Duplicate reference designator "${nm}" used ${cnt} times.` });
  }

  // 3. Missing ref designator
  for (const c of S.comps) {
    const def: SymDef|undefined = SYMDEFS[c.type]; if (def?.netName) continue;
    const nm = (c.name ?? '').trim();
    if (!nm) issues.push({ severity:'warn', msg:`Component of type ${c.type} at (${c.x},${c.y}) has no reference designator.` });
  }

  // 4. Unconnected pins (pin world pos not in any wire endpoint set)
  const wireEndPts = new Set<string>();
  for (const w of S.wires) {
    wireEndPts.add(w.x1+','+w.y1);
    wireEndPts.add(w.x2+','+w.y2);
  }
  // Also label positions count as connections
  for (const lbl of S.labels) wireEndPts.add(lbl.x+','+lbl.y);

  for (const c of S.comps) {
    const def: SymDef|undefined = SYMDEFS[c.type]; if (!def) continue;
    const pins = getEffectivePins(c);
    for (let pi=0; pi<pins.length; pi++) {
      const rp = rotPt(pins[pi]!, c.rot);
      const k = (c.x+rp[0])+','+(c.y+rp[1]);
      if (!wireEndPts.has(k) && !pts2.has(k)) continue; // not in wire net at all
      // pin must be in pts2 (covered by wire or label)
      if (!pts2.has(k)) {
        const pinLabel = def.pinNames?.[pi] ?? String(pi+1);
        const nm = (c.name ?? c.type);
        issues.push({ severity:'warn', msg:`Pin ${pinLabel} of ${nm} appears unconnected.` });
      }
    }
  }

  // 5. Floating single-node nets (connected to only 1 pin)
  const netPinCount = new Map<string,number>();
  for (const c of S.comps) {
    const def: SymDef|undefined = SYMDEFS[c.type]; if (!def) continue;
    for (const p of getEffectivePins(c)) {
      const rp = rotPt(p, c.rot);
      const k = (c.x+rp[0])+','+(c.y+rp[1]);
      const root2 = uf2.find(k);
      netPinCount.set(root2, (netPinCount.get(root2) ?? 0) + 1);
    }
  }
  // Labels and wire-only nodes count too
  for (const lbl of S.labels) {
    const k = lbl.x+','+lbl.y;
    const root2 = uf2.find(k);
    netPinCount.set(root2, (netPinCount.get(root2) ?? 0) + 1);
  }
  for (const [root2, cnt] of netPinCount) {
    if (cnt === 1) {
      const nm = gname2.get(root2) ?? root2;
      issues.push({ severity:'warn', msg:`Net "${nm}" connects to only 1 pin (floating/dangling wire or unconnected pin).` });
    }
  }

  // Show results
  showERCResults(issues);
}

export function showERCResults(issues: ERCIssue[]): void {
  const existing = document.getElementById('sc-erc-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'sc-erc-overlay';

  const errors = issues.filter(i => i.severity === 'error').length;
  const warns  = issues.filter(i => i.severity === 'warn').length;

  let bodyHtml = '';
  if (issues.length === 0) {
    bodyHtml = '<div class="sc-erc-ok">&#10003; No ERC violations found.</div>';
  } else {
    bodyHtml = issues.map(i =>
      `<div class="sc-erc-item">
        <span class="sc-erc-badge ${i.severity==='error'?'sc-erc-err':'sc-erc-warn'}">${i.severity==='error'?'ERROR':'WARN'}</span>
        <span class="sc-erc-msg">${i.msg}</span>
      </div>`
    ).join('');
  }

  const summary = issues.length === 0
    ? 'All clear'
    : `${errors} error${errors!==1?'s':''}, ${warns} warning${warns!==1?'s':''}`;

  overlay.innerHTML = `<div id="sc-erc-box">
  <div id="sc-erc-header">
    <h3>&#9889; ERC Results &mdash; ${summary}</h3>
    <button id="sc-erc-close">&#10005;</button>
  </div>
  <div id="sc-erc-body">${bodyHtml}</div>
  <div id="sc-erc-footer"><button id="sc-erc-dismiss">Dismiss</button></div>
</div>`;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector<HTMLButtonElement>('#sc-erc-close')!.addEventListener('click', close);
  overlay.querySelector<HTMLButtonElement>('#sc-erc-dismiss')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}
