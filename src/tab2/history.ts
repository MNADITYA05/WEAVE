/**
 * history.ts — Undo/redo stack, persistence helpers
 */
import type { Snapshot, Comp, Wire, NetLabel, Directive, TextAnnot, TitleBlock } from './types.js';
import { S, _hist, _histIdx, setHistIdx, _nid, setNid, markJunctionsDirty } from './state.js';

// ─── Forward-ref callbacks (set by initEditor after DOM is ready) ─────────────

let _render: () => void = () => {};
let _showProps: (c: null) => void = () => {};
export function setHistoryCallbacks(render: () => void, showProps: (c: null) => void): void {
  _render = render; _showProps = showProps;
}

// ─── DOM refs (set by initEditor after DOM is ready) ─────────────────────────

export let undoBtn: HTMLButtonElement;
export let redoBtn: HTMLButtonElement;
export function setHistoryDOMRefs(u: HTMLButtonElement, r: HTMLButtonElement): void {
  undoBtn = u; redoBtn = r;
}

// ─── Snapshot helpers ─────────────────────────────────────────────────────────

export function cloneSnap(): Snapshot {
  return {
    comps:      S.comps.map(c => ({ ...c, extra: { ...c.extra } })),
    wires:      S.wires.map(w => ({ ...w })),
    labels:     S.labels.map(l => ({ ...l })),
    directives: S.directives.map(d => ({ ...d })),
    annots:     S.annots.map(a => ({ ...a })),
  };
}

export function pushHistory(): void {
  _hist.splice(_histIdx + 1);
  _hist.push(cloneSnap());
  if (_hist.length > 51) _hist.shift();
  setHistIdx(_hist.length - 1);
  updateUndoRedoBtns();
  saveToStorage();
}

export function restoreSnap(s: Snapshot): void {
  S.comps      = s.comps.map(c => ({ ...c, extra: { ...c.extra } }));
  S.wires      = s.wires.map(w => ({ ...w }));
  S.labels     = (s.labels ?? []).map(l => ({ ...l }));
  S.directives = (s.directives ?? []).map(d => ({ ...d }));
  S.annots     = (s.annots     ?? []).map(a => ({ ...a }));
  S.sel = null; S.selWire = null; S.selLabel = null; S.selDir = null; S.selAnnot = null; S.selMulti = new Set(); S.selWireMulti = new Set();
  markJunctionsDirty();
  _showProps(null);
  _render();
  updateUndoRedoBtns();
}

export function undo(): void {
  if (_histIdx <= 0) return;
  setHistIdx(_histIdx - 1);
  restoreSnap(_hist[_histIdx]!);
}

export function redo(): void {
  if (_histIdx >= _hist.length - 1) return;
  setHistIdx(_histIdx + 1);
  restoreSnap(_hist[_histIdx]!);
}

export function updateUndoRedoBtns(): void {
  if (undoBtn) undoBtn.disabled = _histIdx <= 0;
  if (redoBtn) redoBtn.disabled = _histIdx >= _hist.length - 1;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export function saveToStorage(): void {
  try {
    localStorage.setItem('weave-sc-v1', JSON.stringify({ comps: S.comps, wires: S.wires, labels: S.labels, directives: S.directives, annots: S.annots, titleBlock: S.titleBlock, nid: _nid }));
  } catch { /* quota exceeded or private mode — silently ignore */ }
}

export function loadFromStorage(): boolean {
  try {
    const raw = localStorage.getItem('weave-sc-v1');
    if (!raw) return false;
    const data = JSON.parse(raw) as { comps?: Comp[]; wires?: Wire[]; labels?: NetLabel[]; directives?: Directive[]; annots?: TextAnnot[]; titleBlock?: TitleBlock; nid?: number };
    S.comps      = data.comps      ?? [];
    S.wires      = data.wires      ?? [];
    S.labels     = data.labels     ?? [];
    S.annots     = data.annots     ?? [];
    S.directives = data.directives ?? [];
    if (data.titleBlock) S.titleBlock = data.titleBlock;
    setNid(data.nid ?? 1);
    return true;
  } catch { return false; }
}
