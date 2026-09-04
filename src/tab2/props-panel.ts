/**
 * props-panel.ts — Component, wire, label properties panel and delete
 */
import type { Comp, Wire, NetLabel } from './types.js';
import { SYMDEFS } from './schematic-symbols.js';
import type { SymDef } from './schematic-symbols.js';
import { S, markJunctionsDirty } from './state.js';
import { nextRot, toggleMirror } from './rotation.js';
import { pushHistory } from './history.js';
import { render } from './canvas-render.js';

// ─── DOM ref (set by initEditor) ──────────────────────────────────────────────

let propsBodyEl: HTMLElement;
export function setPropsPanelDOM(el: HTMLElement): void { propsBodyEl = el; }

export function showProps(comp: Comp | null): void {
  if (!comp) { propsBodyEl.innerHTML = '<em class="sc-hint">Select a component</em>'; return; }
  const def: SymDef | undefined = SYMDEFS[comp.type];
  let h = `<div class="sc-pr"><div class="sc-pl">Name</div>
<input class="sc-pi" id="pi-name" value="${comp.name ?? ''}"/></div>`;
  if (def?.valOffset !== null && def?.valOffset !== undefined) {
    h += `<div class="sc-pr"><div class="sc-pl">Value</div>
<input class="sc-pi" id="pi-val" value="${comp.value ?? ''}"/></div>`;
  }
  // Model field — includes S and W now (Fix 6)
  if (['Q_NPN', 'Q_PNP', 'M_NMOS', 'M_PMOS', 'J_N', 'J_P', 'D', 'LED', 'ZENER', 'SCHOTTKY', 'OPAMP', 'X', 'S', 'W'].includes(comp.type)) {
    const modelLabel = ['S', 'W'].includes(comp.type) ? 'Switch Model Name' : 'Model';
    h += `<div class="sc-pr"><div class="sc-pl">${modelLabel}</div>
<input class="sc-pi" id="pi-model" value="${comp.extra?.model ?? ''}"/></div>`;
  }
  if (['F', 'H', 'W'].includes(comp.type)) {
    h += `<div class="sc-pr"><div class="sc-pl">Ctrl Source (Vsrc name)</div>
<input class="sc-pi" id="pi-csrc" placeholder="e.g. Vsense" value="${comp.extra?.csrc ?? ''}"/></div>`;
  }
  if (comp.type === 'K') {
    h += `<div class="sc-pr"><div class="sc-pl">Inductor 1 (L1)</div>
<input class="sc-pi" id="pi-l1" placeholder="e.g. L1" value="${comp.extra?.L1 ?? ''}"/></div>`;
    h += `<div class="sc-pr"><div class="sc-pl">Inductor 2 (L2)</div>
<input class="sc-pi" id="pi-l2" placeholder="e.g. L2" value="${comp.extra?.L2 ?? ''}"/></div>`;
  }
  if (comp.type === 'XFMR') {
    h += `<div class="sc-pr"><div class="sc-pl">Primary L (Lp)</div>
<input class="sc-pi" id="pi-lp" placeholder="e.g. 1m" value="${comp.extra?.Lp ?? ''}"/></div>`;
    h += `<div class="sc-pr"><div class="sc-pl">Secondary L (Ls)</div>
<input class="sc-pi" id="pi-ls" placeholder="e.g. 1m" value="${comp.extra?.Ls ?? ''}"/></div>`;
    h += `<div class="sc-pr"><div class="sc-pl">Coupling k</div>
<input class="sc-pi" id="pi-k" placeholder="e.g. 0.99" value="${comp.extra?.k ?? ''}"/></div>`;
  }
  if (['M_NMOS', 'M_PMOS'].includes(comp.type)) {
    h += `<div class="sc-pr"><div class="sc-pl">Bulk Net</div>
<input class="sc-pi" id="pi-bulk" placeholder="tied to source if blank" value="${comp.extra?.bulk ?? ''}"/></div>`;
  }
  // Fix 5: X subcircuit pin count
  if (comp.type === 'X') {
    h += `<div class="sc-pr"><div class="sc-pl">Pin Count (2–16)</div>
<input class="sc-pi" id="pi-pincount" type="number" min="2" max="16" value="${comp.extra?.pinCount ?? '2'}"/></div>`;
  }
  // SpiceLine / SpiceLine2 — shown for all non-power components
  if (def && !def.netName) {
    h += `<div class="sc-pr"><div class="sc-pl">SpiceLine</div>
<input class="sc-pi" id="pi-sl1" placeholder="e.g. W=10u L=180n" value="${comp.extra?.spiceLine ?? ''}"/></div>`;
    h += `<div class="sc-pr"><div class="sc-pl">SpiceLine2</div>
<input class="sc-pi" id="pi-sl2" placeholder="optional 2nd params" value="${comp.extra?.spiceLine2 ?? ''}"/></div>`;
  }
  h += `<div class="sc-pr"><div class="sc-pl">Rotation</div>
<div style="color:#aaa;font-size:11px;font-family:monospace">${comp.rot}</div></div>`;
  h += `<div class="sc-pbs">
<button class="sc-pbtn" id="pi-rot">&#8635; Rotate</button>
<button class="sc-pbtn" id="pi-mir">&#8596; Mirror</button>
<button class="sc-pbtn del" id="pi-del">&#10005; Delete</button></div>`;
  propsBodyEl.innerHTML = h;

  propsBodyEl.querySelector<HTMLInputElement>('#pi-name')!
    .addEventListener('input', e => { comp.name = (e.target as HTMLInputElement).value; render(); });
  const vi = propsBodyEl.querySelector<HTMLInputElement>('#pi-val');
  if (vi) vi.addEventListener('input', e => { comp.value = (e.target as HTMLInputElement).value; render(); });
  const mi = propsBodyEl.querySelector<HTMLInputElement>('#pi-model');
  if (mi) mi.addEventListener('input', e => { comp.extra.model = (e.target as HTMLInputElement).value; });
  const ci = propsBodyEl.querySelector<HTMLInputElement>('#pi-csrc');
  if (ci) ci.addEventListener('input', e => { comp.extra.csrc = (e.target as HTMLInputElement).value; });
  const l1i = propsBodyEl.querySelector<HTMLInputElement>('#pi-l1');
  if (l1i) l1i.addEventListener('input', e => { comp.extra.L1 = (e.target as HTMLInputElement).value; });
  const l2i = propsBodyEl.querySelector<HTMLInputElement>('#pi-l2');
  if (l2i) l2i.addEventListener('input', e => { comp.extra.L2 = (e.target as HTMLInputElement).value; });
  const bi = propsBodyEl.querySelector<HTMLInputElement>('#pi-bulk');
  if (bi) bi.addEventListener('input', e => { comp.extra.bulk = (e.target as HTMLInputElement).value; });
  const lpi = propsBodyEl.querySelector<HTMLInputElement>('#pi-lp');
  if (lpi) lpi.addEventListener('input', e => { comp.extra.Lp = (e.target as HTMLInputElement).value; });
  const lsi = propsBodyEl.querySelector<HTMLInputElement>('#pi-ls');
  if (lsi) lsi.addEventListener('input', e => { comp.extra.Ls = (e.target as HTMLInputElement).value; });
  const ki = propsBodyEl.querySelector<HTMLInputElement>('#pi-k');
  if (ki) ki.addEventListener('input', e => { comp.extra.k = (e.target as HTMLInputElement).value; });
  const sl1i = propsBodyEl.querySelector<HTMLInputElement>('#pi-sl1');
  if (sl1i) sl1i.addEventListener('input', e => { comp.extra.spiceLine = (e.target as HTMLInputElement).value; });
  const sl2i = propsBodyEl.querySelector<HTMLInputElement>('#pi-sl2');
  if (sl2i) sl2i.addEventListener('input', e => { comp.extra.spiceLine2 = (e.target as HTMLInputElement).value; });
  const pci = propsBodyEl.querySelector<HTMLInputElement>('#pi-pincount');
  if (pci) pci.addEventListener('input', e => {
    comp.extra.pinCount = (e.target as HTMLInputElement).value;
    markJunctionsDirty(); render();
  });
  propsBodyEl.querySelector<HTMLButtonElement>('#pi-rot')!
    .addEventListener('click', () => { pushHistory(); comp.rot = nextRot(comp.rot); render(); showProps(comp); });
  propsBodyEl.querySelector<HTMLButtonElement>('#pi-mir')!
    .addEventListener('click', () => { pushHistory(); comp.rot = toggleMirror(comp.rot); render(); showProps(comp); });
  propsBodyEl.querySelector<HTMLButtonElement>('#pi-del')!
    .addEventListener('click', () => deleteSelected());
}

export function showWireProps(wire: Wire): void {
  propsBodyEl.innerHTML = `
<div style="color:#aaa;font-size:11px;margin-bottom:8px">Wire &nbsp;<span style="color:#666;font-family:monospace;font-size:10px">(${wire.x1},${wire.y1})→(${wire.x2},${wire.y2})</span></div>
<div class="sc-pbs"><button class="sc-pbtn del" id="pi-del-wire">&#10005; Delete Wire</button></div>`;
  propsBodyEl.querySelector<HTMLButtonElement>('#pi-del-wire')!
    .addEventListener('click', () => deleteSelected());
}

export function showLabelProps(label: NetLabel): void {
  propsBodyEl.innerHTML = `
<div class="sc-pr"><div class="sc-pl">Net Name</div>
<input class="sc-pi" id="pi-lname" value="${label.name}"/></div>
<div class="sc-pbs">
  <button class="sc-pbtn del" id="pi-del-label">&#10005; Delete</button>
</div>`;
  const inp = propsBodyEl.querySelector<HTMLInputElement>('#pi-lname')!;
  inp.addEventListener('input', e => {
    label.name = (e.target as HTMLInputElement).value;
    render();
    pushHistory();
  });
  inp.focus(); inp.select();
  propsBodyEl.querySelector<HTMLButtonElement>('#pi-del-label')!
    .addEventListener('click', () => {
      pushHistory();
      S.labels = S.labels.filter(l => l.id !== label.id);
      S.selLabel = null; showProps(null); render();
    });
}

export function deleteSelected(): void {
  if (S.selMulti.size > 0) {
    pushHistory();
    S.comps = S.comps.filter(c => !S.selMulti.has(c.id));
    S.selMulti = new Set(); S.sel = null; showProps(null); markJunctionsDirty(); render();
  } else if (S.sel) {
    pushHistory();
    S.comps = S.comps.filter(c => c.id !== S.sel);
    S.sel = null; showProps(null); markJunctionsDirty(); render();
  } else if (S.selWire) {
    pushHistory();
    S.wires = S.wires.filter(w => w.id !== S.selWire);
    S.selWire = null; markJunctionsDirty(); render();
  } else if (S.selLabel) {
    pushHistory();
    S.labels = S.labels.filter(l => l.id !== S.selLabel);
    S.selLabel = null; markJunctionsDirty(); render();
  } else if (S.selAnnot) {
    pushHistory();
    S.annots = S.annots.filter(a => a.id !== S.selAnnot);
    S.selAnnot = null; render();
    S.selLabel = null; showProps(null); render();
  } else if (S.selDir) {
    pushHistory();
    S.directives = S.directives.filter(d => d.id !== S.selDir);
    S.selDir = null; showProps(null); render();
  }
}
