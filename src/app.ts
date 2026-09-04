/**
 * app.ts — Weave v5.0 bootstrap
 *
 * Wires up the two-tab UI:
 *   Tab 1 — Netlist → Schematic (convert, verify, download)
 *   Tab 2 — Schematic editor (initEditor)
 *
 * All DOM interaction lives here; pipeline modules are pure.
 */

import { convert } from './tab1/convert.js';
import { compare }                   from './tab1/verifier.js';
import { parseNetlist }              from './tab1/netlist-parser.js';
import { setAscView, renderSchematic } from './tab1/renderer.js';
import { mergeWires, detectJunctions,
         _mergeWires, _detectJunctions } from './tab1/wire-merge.js';
import { symbolsReady, SYMBOLS }     from './tab1/symbols.js';

// @ts-ignore — Tab 2 editor not yet migrated
import { initEditor }   from './tab2/schematic-editor.js';
import { initSimulator } from './tab3/simulator.js';
import { logger }                            from './logger.js';
import { ParseError, SymbolError, LayoutError, RoutingError, WeaveError } from './errors.js';

// Browser globals
declare const ELK: new () => unknown;

const APP_VERSION = '5.0';
const SIM_BACKEND: string = (import.meta as Record<string, unknown> & { env: Record<string, string> }).env?.VITE_SIM_BACKEND ?? 'http://localhost:8000';

// ─── Tab switching ────────────────────────────────────────────────────────────

function switchTab(n: number): void {
  (document.getElementById('panel1') as HTMLElement).classList.toggle('active', n === 1);
  (document.getElementById('panel2') as HTMLElement).classList.toggle('active', n === 2);
  (document.getElementById('panel3') as HTMLElement).classList.toggle('active', n === 3);
  (document.getElementById('tab1')   as HTMLElement).classList.toggle('active', n === 1);
  (document.getElementById('tab2')   as HTMLElement).classList.toggle('active', n === 2);
  (document.getElementById('tab3')   as HTMLElement).classList.toggle('active', n === 3);
}

// ─── Console logger ───────────────────────────────────────────────────────────

function clogId(id: string, msg: string, cls?: string): void {
  const c    = document.getElementById(id) as HTMLElement;
  const line = document.createElement('div');
  if (cls) line.className = 'l-' + cls;
  const t = new Date().toTimeString().slice(0, 8);
  line.textContent = '[' + t + '] ' + msg;
  c.appendChild(line);
  c.scrollTop = c.scrollHeight;
}
function clog(msg: string, cls?: string): void { clogId('console',  msg, cls); }

// Route pipeline logger output into the UI console pane
logger.onEmit = (level, msg): void => {
  const cls = level === 'warn' ? 'warn' : level === 'error' ? 'err' : level === 'debug' ? 'dim' : undefined;
  clog(msg, cls);
};

// ─── Examples ────────────────────────────────────────────────────────────────

const EXAMPLES: Record<string, string> = {
  'OP27 inverting amplifier': `* OP27 inverting amplifier, gain -10
V1 vcc 0 15
V2 vee 0 -15
V3 in 0 SINE(0 0.1 1k) AC 1
R1 in inm 10k
R2 inm out 100k
XU1 0 inm vcc vee out OP27
.lib ADI.lib
.tran 5m
.end`,
  '1002A two-opamp instrumentation amp': `* 1002A two-opamp instrumentation amplifier
V1 vcc 0 15
V2 vee 0 -15
V3 vin1 0 SINE(0 10m 1k)
V4 vin2 0 SINE(0 11m 1k)
R1 0 n1 10k
R2 n1 out1 90k
R3 out1 n2 90k
R4 n2 out 10k
XU1 vin1 n1 vcc vee out1 OP27
XU2 vin2 n2 vcc vee out OP27
.lib ADI.lib
.tran 5m
.end`,
  'LT1004-1.2 shunt reference': `* LT1004-1.2 shunt reference demo
XU1 OUT 0 LT1004-1.2
R1 OUT N001 36K
V1 N001 0 PULSE(0 5 100u 10n 10n 500u 1)
.tran 700u
.lib LTC3.lib
.end`,
  'BJT common-emitter amplifier': `* BJT common-emitter amplifier
V1 vcc 0 12
V2 in 0 SINE(0 10m 1k) AC 1
C1 in b 1u
R1 vcc b 47k
R2 b 0 10k
RC vcc c 4.7k
RE e 0 1k
CE e 0 100u
Q1 c b e 2N3904
.tran 5m
.end`,
  'Sallen-Key low-pass': `* Sallen-Key LPF 1kHz Butterworth
V1 vcc 0 15
V2 vee 0 -15
V3 in 0 AC 1
R1 in n1 11.3k
R2 n1 n2 11.3k
C1 n1 out 20n
C2 n2 0 10n
XU1 n2 inm vcc vee out OP27
R3 inm out 1
.lib ADI.lib
.ac dec 100 10 100k
.end`,
};

// ─── Tab 1 state ──────────────────────────────────────────────────────────────

let lastAsc = '';


async function validate(): Promise<void> {
  const src = (document.getElementById('nl') as HTMLTextAreaElement).value.trim();
  if (!src) { clog('Validate: netlist is empty', 'warn'); return; }
  clog('Validating netlist…', 'dim');
  try {
    const resp = await fetch(SIM_BACKEND + '/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ netlist: src, sim_type: 'tran', params: {} }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json() as { ok: boolean; errors: string[] };
    if (data.ok) {
      clog('✓ Validation passed — no errors', 'ok');
    } else {
      clog('✗ Validation failed: ' + data.errors.length + ' issue(s)', 'err');
      data.errors.forEach(e => clog('  ' + e, 'err'));
    }
  } catch (e) {
    clog('Validate error: ' + (e instanceof Error ? e.message : String(e)), 'err');
  }
}

async function run(): Promise<void> {
  const src    = (document.getElementById('nl')     as HTMLTextAreaElement).value.trim();
  const status = document.getElementById('status')  as HTMLElement;
  const info   = document.getElementById('info')    as HTMLElement;
  if (!src) return;
  try {
    lastAsc = await convert(src);
    const errs  = compare(src, lastAsc);
    const nSym  = (lastAsc.match(/^SYMBOL /gm)  ?? []).length;
    const nWire = (lastAsc.match(/^WIRE /gm)    ?? []).length;
    info.textContent = `${nSym} symbols, ${nWire} wires`;
    lastAsc = mergeWires(lastAsc);
    lastAsc = detectJunctions(lastAsc);
    (document.getElementById('ascview') as HTMLElement).textContent = lastAsc;
    renderSchematic(lastAsc);
    if (errs.length) {
      status.textContent = `partial: ${errs.length} net(s) need manual fixup`;
      status.className   = 'warn';
      clog(`converted with ${errs.length} unmatched net(s)`, 'warn');
      errs.slice(0, 8).forEach(e => clog('  ' + e, 'dim'));
      if (errs.length > 8) clog(`  ...and ${errs.length - 8} more`, 'dim');
    } else {
      status.textContent = 'round-trip verified: MATCH';
      status.className   = 'ok';
      clog(`MATCH — ${nSym} symbols, ${nWire} wires, connectivity verified`, 'ok');
    }
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    let prefix = 'error';
    if (e instanceof ParseError)        { prefix = 'parse error'; }
    else if (e instanceof SymbolError)  { prefix = 'symbol error'; }
    else if (e instanceof LayoutError)  { prefix = 'layout error'; }
    else if (e instanceof RoutingError) { prefix = 'routing error'; }
    else if (!(e instanceof WeaveError)) {
      logger.debug(e instanceof Error && e.stack ? e.stack : String(e));
    }
    status.textContent = prefix + ': ' + msg;
    status.className   = 'bad';
    info.textContent   = '';
    lastAsc = '';
    (document.getElementById('ascview') as HTMLElement).textContent = '';
    clog(prefix + ': ' + msg, 'err');
  }
  (document.getElementById('dl') as HTMLButtonElement).disabled = !lastAsc;
}

function download(): void {
  if (!lastAsc) return;
  const d = new Date();
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes());
  const blob = new Blob([lastAsc.replace(/\n/g, '\r\n')], { type: 'application/octet-stream' });
  const a    = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'schematic_' + stamp + '.asc';
  a.click();
  URL.revokeObjectURL(a.href);

  // Also download any companion .asy block files
  if (typeof (window as Window & typeof globalThis & { blockAsyFiles?: (asc: string) => Record<string, string> }).blockAsyFiles === 'function') {
    const win = window as Window & typeof globalThis & { blockAsyFiles: (asc: string) => Record<string, string> };
    const asys = win.blockAsyFiles(lastAsc);
    for (const [fn, body] of Object.entries(asys)) {
      const bb = new Blob([body.replace(/\n/g, '\r\n')], { type: 'application/octet-stream' });
      const aa = document.createElement('a');
      aa.href = URL.createObjectURL(bb); aa.download = fn; aa.click();
      URL.revokeObjectURL(aa.href);
    }
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

// Expose legacy globals expected by inline HTML onclick handlers and verifier.js
(window as Window & typeof globalThis & Record<string, unknown>).switchTab         = switchTab;
(window as Window & typeof globalThis & Record<string, unknown>).convert           = convert;
(window as Window & typeof globalThis & Record<string, unknown>).compare           = compare;
(window as Window & typeof globalThis & Record<string, unknown>)._mergeWires       = _mergeWires;
(window as Window & typeof globalThis & Record<string, unknown>)._detectJunctions  = _detectJunctions;
(window as Window & typeof globalThis & Record<string, unknown>).parseNetlist      = parseNetlist;
(window as Window & typeof globalThis & Record<string, unknown>).setAscView        = setAscView;

window.addEventListener('DOMContentLoaded', () => {
  initEditor(document.getElementById('sc-root')!);
  initSimulator(document.getElementById('sc3-root')!);
  (document.getElementById('ver') as HTMLElement).textContent = 'v' + APP_VERSION;

  // Show loading state until symbol table is ready
  const nsymEl  = document.getElementById('nsym') as HTMLElement;
  const goBtn   = document.getElementById('go')   as HTMLButtonElement;
  const dlBtn   = document.getElementById('dl')   as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLElement;
  nsymEl.textContent = 'Loading symbols…';
  goBtn.disabled = true;

  // Populate example selector (can happen before symbols load)
  const sel = document.getElementById('ex') as HTMLSelectElement;
  const optNew = document.createElement('option');
  optNew.textContent = 'New (clear)';
  sel.appendChild(optNew);
  for (const k of Object.keys(EXAMPLES)) {
    const o = document.createElement('option');
    o.textContent = k;
    sel.appendChild(o);
  }

  sel.onchange = () => {
    if (sel.value === 'New (clear)') {
      lastAsc = '';
      (document.getElementById('nl')      as HTMLTextAreaElement).value = '';
      (document.getElementById('ascview') as HTMLElement).textContent  = '';
      (document.getElementById('info')    as HTMLElement).textContent  = '';
      dlBtn.disabled = true;
      statusEl.textContent = ''; statusEl.className = '';
      return;
    }
    (document.getElementById('nl') as HTMLTextAreaElement).value = EXAMPLES[sel.value] ?? '';
    void run();
  };

  // Gate all symbol-dependent startup on the async loader
  void symbolsReady.then(() => {
    nsymEl.textContent = Object.keys(SYMBOLS).length + ' symbols loaded';
    goBtn.disabled = false;
    sel.value = 'OP27 inverting amplifier';
    (document.getElementById('nl') as HTMLTextAreaElement).value = EXAMPLES['OP27 inverting amplifier'] ?? '';
    void run();
  }).catch((err: unknown) => {
    nsymEl.textContent = 'Symbol load failed';
    statusEl.textContent = String(err);
    statusEl.className = 'err';
  });

  goBtn.onclick = () => void run();
  (document.getElementById('validate') as HTMLButtonElement).onclick = () => void validate();
  dlBtn.onclick = download;

  let t1: ReturnType<typeof setTimeout>;
  (document.getElementById('nl') as HTMLTextAreaElement).addEventListener('input', () => {
    clearTimeout(t1);
    t1 = setTimeout(() => void run(), 500);
  });

  // Draggable gutters — Tab 1
  (function () {
    const g = document.getElementById('vgut')!;
    const L = document.getElementById('leftpane')!;
    const R = document.getElementById('rightpane')!;
    const row = document.getElementById('toprow')!;
    let drag = false;
    g.addEventListener('mousedown', e => { drag = true; e.preventDefault(); document.body.style.userSelect = 'none'; });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const r = row.getBoundingClientRect();
      let f = (e.clientX - r.left) / r.width;
      f = Math.max(0.15, Math.min(0.85, f));
      L.style.flex = '0 0 ' + (f * 100) + '%';
      R.style.flex = '1 1 auto';
    });
    window.addEventListener('mouseup', () => { drag = false; document.body.style.userSelect = ''; });
  })();

  (function () {
    const g  = document.getElementById('hgut')!;
    const C  = document.getElementById('console')!;
    const ws = document.getElementById('workspace')!;
    let drag = false;
    g.addEventListener('mousedown', e => { drag = true; e.preventDefault(); document.body.style.userSelect = 'none'; });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const r = ws.getBoundingClientRect();
      let h = r.bottom - e.clientY;
      h = Math.max(24, Math.min(r.height - 120, h));
      C.style.height = h + 'px';
    });
    window.addEventListener('mouseup', () => { drag = false; document.body.style.userSelect = ''; });
  })();

  clog('weave ready — ' + Object.keys(SYMBOLS).length + ' symbols loaded', 'dim');

  // Pre-warm ELK Web Worker so first Convert is fast
  // Pre-warm ELK Web Worker so first Convert is fast.
  // The singleton lives in convert.ts; we trigger the first layout call
  // by letting the DOMContentLoaded run() do it lazily on first use.
});
