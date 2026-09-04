/**
 * schematic-editor.ts — Canvas schematic editor (Tab 2)
 *
 * Depends on: SYMDEFS, PALETTE_GROUPS (schematic-symbols.ts)
 */

import { SYMDEFS, PALETTE_GROUPS, LOGIC_BEXPR } from './schematic-symbols.js';
import type { SymDef } from './schematic-symbols.js';
import { onSeg } from '../shared/geometry.js';
import { UF } from '../shared/union-find.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type RotCode = 'R0' | 'R90' | 'R180' | 'R270' | 'MR0' | 'MR90' | 'MR180' | 'MR270';

interface CompExtra {
  model?:    string;
  csrc?:     string;
  L1?:       string;
  L2?:       string;
  bulk?:     string;
  pinCount?: string;  // X subcircuit only
  Lp?:       string;  // XFMR primary inductance
  Ls?:       string;  // XFMR secondary inductance
  k?:        string;  // XFMR coupling factor
  spiceLine?:  string;  // extra SPICE params (W=10u L=180n, Rser=10m, etc.)
  spiceLine2?: string;  // second extra SPICE params line
}

interface Comp {
  id:    string;
  type:  string;
  name:  string;
  value: string;
  x:     number;
  y:     number;
  rot:   RotCode;
  extra: CompExtra;
}

interface Wire {
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
  bus?: boolean;
}

interface Junction { x: number; y: number }

interface NetLabel { id: string; x: number; y: number; name: string; }

interface Directive { id: string; x: number; y: number; text: string; }

interface TextAnnot { id: string; x: number; y: number; text: string; fontSize: number; }

interface TitleBlock {
  title:  string;
  doc:    string;
  rev:    string;
  author: string;
  date:   string;
  visible: boolean;
}

interface Snapshot { comps: Comp[]; wires: Wire[]; labels: NetLabel[]; directives: Directive[]; annots: TextAnnot[] }

interface EditorState {
  comps:      Comp[];
  wires:      Wire[];
  junctions:  Junction[];
  sel:        string | null;
  selWire:    string | null;
  mode:       'select' | 'place' | 'wire' | 'label' | 'annot' | 'bus';
  placing:    string | null;
  placingRot: RotCode;
  wireStart:  { x: number; y: number } | null;
  mouse:      { x: number; y: number };
  pan:        { x: number; y: number };
  zoom:       number;
  counters:   Record<string, number>;
  lastNet:    string;
  labels:      NetLabel[];
  selLabel:    string | null;
  selMulti:    Set<string>;
  directives:  Directive[];
  selDir:      string | null;
  annots:      TextAnnot[];
  selAnnot:    string | null;
  selWireMulti: Set<string>;
  titleBlock:  TitleBlock;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GRID = 16;
const snap = (v: number): number => Math.round(v / GRID) * GRID;
const STORAGE_KEY = 'weave-sc-v1';
const PIN_SNAP_THRESHOLD = GRID * 1.5; // 24 world-px

// ─── History ──────────────────────────────────────────────────────────────────

const _hist: Snapshot[] = [];
let _histIdx = -1;

function cloneSnap(): Snapshot {
  return {
    comps:      S.comps.map(c => ({ ...c, extra: { ...c.extra } })),
    wires:      S.wires.map(w => ({ ...w })),
    labels:     S.labels.map(l => ({ ...l })),
    directives: S.directives.map(d => ({ ...d })),
    annots:     S.annots.map(a => ({ ...a })),
  };
}

function pushHistory(): void {
  _hist.splice(_histIdx + 1);
  _hist.push(cloneSnap());
  if (_hist.length > 51) _hist.shift();
  _histIdx = _hist.length - 1;
  updateUndoRedoBtns();
  saveToStorage();
}

function restoreSnap(s: Snapshot): void {
  S.comps      = s.comps.map(c => ({ ...c, extra: { ...c.extra } }));
  S.wires      = s.wires.map(w => ({ ...w }));
  S.labels     = (s.labels ?? []).map(l => ({ ...l }));
  S.directives = (s.directives ?? []).map(d => ({ ...d }));
  S.annots     = (s.annots     ?? []).map(a => ({ ...a }));
  S.sel = null; S.selWire = null; S.selLabel = null; S.selDir = null; S.selAnnot = null; S.selMulti = new Set(); S.selWireMulti = new Set();
  markJunctionsDirty();
  showProps(null);
  render();
  updateUndoRedoBtns();
}

function undo(): void {
  if (_histIdx <= 0) return;
  restoreSnap(_hist[--_histIdx]!);
}

function redo(): void {
  if (_histIdx >= _hist.length - 1) return;
  restoreSnap(_hist[++_histIdx]!);
}

function updateUndoRedoBtns(): void {
  if (undoBtn) undoBtn.disabled = _histIdx <= 0;
  if (redoBtn) redoBtn.disabled = _histIdx >= _hist.length - 1;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function saveToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ comps: S.comps, wires: S.wires, labels: S.labels, directives: S.directives, annots: S.annots, titleBlock: S.titleBlock, nid: _nid }));
  } catch { /* quota exceeded or private mode — silently ignore */ }
}

function loadFromStorage(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as { comps?: Comp[]; wires?: Wire[]; labels?: NetLabel[]; directives?: Directive[]; annots?: TextAnnot[]; titleBlock?: TitleBlock; nid?: number };
    S.comps      = data.comps      ?? [];
    S.wires      = data.wires      ?? [];
    S.labels     = data.labels     ?? [];
    S.annots     = data.annots     ?? [];
    S.directives = data.directives ?? [];
    if (data.titleBlock) S.titleBlock = data.titleBlock;
    _nid = data.nid ?? 1;
    return true;
  } catch { return false; }
}

// ─── Rotation helpers ─────────────────────────────────────────────────────────

function rotPt([x, y]: [number, number], code: RotCode): [number, number] {
  let rx = x;
  if (code[0] === 'M') rx = -rx;
  const k = parseInt(code.replace(/^M?R/, ''), 10) || 0;
  if (k === 0)   return [rx, y];
  if (k === 90)  return [-y, rx];
  if (k === 180) return [-rx, -y];
  if (k === 270) return [y, -rx];
  return [rx, y];
}

function nextRot(code: RotCode): RotCode {
  const mirrored = code.startsWith('M');
  const base = mirrored ? code.slice(1) : code;
  const seq = ['R0', 'R90', 'R180', 'R270'];
  const next = seq[(seq.indexOf(base) + 1) % 4]!;
  return (mirrored ? 'M' + next : next) as RotCode;
}

function toggleMirror(code: RotCode): RotCode {
  return (code.startsWith('M') ? code.slice(1) : 'M' + code) as RotCode;
}

// Fixed svgTransform: derive affine matrix from rotPt column vectors
function svgTransform(code: RotCode): string {
  const [ax, ay] = rotPt([1, 0], code);
  const [bx, by] = rotPt([0, 1], code);
  return `matrix(${ax},${ay},${bx},${by},0,0)`;
}

// ─── Effective pins (fix 5: X subcircuit dynamic pin count) ──────────────────

function getEffectivePins(c: Comp): [number, number][] {
  const def: SymDef | undefined = SYMDEFS[c.type];
  if (!def) return [];
  if (c.type !== 'X') return def.pins;
  const n = Math.max(2, Math.min(16, parseInt(c.extra.pinCount ?? '2', 10) || 2));
  const spacing = 32;
  const totalH = (n - 1) * spacing;
  // Pins distributed on left side of the box, vertically centred
  return Array.from({ length: n }, (_, i) =>
    [0, Math.round(-totalH / 2 + i * spacing)] as [number, number]);
}

// ─── State ────────────────────────────────────────────────────────────────────

const S: EditorState = {
  comps: [], wires: [], junctions: [], labels: [], directives: [], annots: [],
  sel: null, selWire: null, selLabel: null, selDir: null, selAnnot: null, selMulti: new Set(), selWireMulti: new Set(),
  titleBlock: { title:'Untitled', doc:'', rev:'A', author:'', date: new Date().toISOString().slice(0,10), visible: false },
  mode: 'select',
  placing: null, placingRot: 'R0',
  wireStart: null,
  mouse: { x: 0, y: 0 },
  pan: { x: 200, y: 200 }, zoom: 1,
  counters: {},
  lastNet: '',
};
let _nid = 1;
const uid = (): string => 'c' + (_nid++);

// ─── Module-level vars ────────────────────────────────────────────────────────

let _suppressNextClick = false;
let _panDrag: { lx: number; ly: number } | null = null;
let _dragComp: { id: string; startX: number; startY: number; origX: number; origY: number } | null = null;
let _dragActive = false;
// Wire endpoints attached to dragged component's pins: offset from comp origin
let _dragWireEnds: Array<{ wireId: string; end: 1 | 2; ox: number; oy: number }> = [];
let _dragMultiOrigComps: Map<string, { x: number; y: number }> = new Map();
let _dragMultiOrigWires: Map<string, { x1: number; y1: number; x2: number; y2: number }> = new Map();
let _junctionsDirty = true;
let _clipboard: Comp[] = [];
let _boxDrag: { sx: number; sy: number; cx: number; cy: number } | null = null;
let _placingDirective = false;

function markJunctionsDirty(): void { _junctionsDirty = true; }

// ─── DOM refs ─────────────────────────────────────────────────────────────────

let svgEl:       SVGSVGElement;
let annotL:      SVGGElement;
let pzEl:        SVGGElement;
let compL:       SVGGElement;
let wireL:       SVGGElement;
let juncL:       SVGGElement;
let ghostL:      SVGGElement;
let selL:        SVGGElement;
let statusEl:    HTMLElement;
let infoEl:      HTMLElement;
let netlistEl:   HTMLElement;
let propsBodyEl: HTMLElement;
let dlBtn:       HTMLButtonElement;
let dlAscBtn:    HTMLButtonElement;
let hintEl:      HTMLElement;
let undoBtn:     HTMLButtonElement;
let redoBtn:     HTMLButtonElement;

// ─── CSS injection ────────────────────────────────────────────────────────────

function injectCSS(): void {
  if (document.getElementById('sc-css')) return;
  const s = document.createElement('style'); s.id = 'sc-css';
  s.textContent = `
#sc-editor{display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:system-ui,sans-serif;background:#1a1a1a}
#sc-toolbar{display:flex;align-items:center;gap:4px;padding:5px 8px;background:#2d2d2d;flex-shrink:0;border-bottom:1px solid #111}
#sc-toolbar button{padding:3px 10px;border:none;border-radius:3px;cursor:pointer;font-size:12px;background:#3a3a3a;color:#ccc}
#sc-toolbar button:hover{background:#4a4a4a}
#sc-toolbar button.sc-active{background:#1a7fd4;color:#fff}
#sc-toolbar button:disabled{opacity:.35;cursor:default}
.sc-sep{width:1px;height:18px;background:#444;margin:0 3px;flex-shrink:0}
#sc-status{font-size:11px;padding:0 4px}
#sc-status.ok{color:#5c5}
#sc-status.bad{color:#f66}
#sc-erc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:9999}
#sc-erc-box{background:#2d2d2d;border:1px solid #555;border-radius:6px;padding:0;max-width:480px;width:90%;color:#ccc;font-size:13px;display:flex;flex-direction:column;max-height:70vh}
#sc-erc-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #444}
#sc-erc-header h3{margin:0;font-size:14px;color:#eee}
#sc-erc-close{background:none;border:none;color:#999;font-size:18px;cursor:pointer;padding:0 4px;line-height:1}
#sc-erc-close:hover{color:#fff}
#sc-erc-body{overflow-y:auto;padding:12px 16px;flex:1}
.sc-erc-ok{color:#5c5;font-size:13px}
.sc-erc-item{display:flex;gap:8px;align-items:flex-start;padding:4px 0;border-bottom:1px solid #3a3a3a}
.sc-erc-item:last-child{border-bottom:none}
.sc-erc-badge{font-size:10px;font-weight:bold;padding:1px 5px;border-radius:3px;white-space:nowrap;margin-top:1px}
.sc-erc-err{background:#8b1a1a;color:#ffaaaa}
.sc-erc-warn{background:#7a5a00;color:#ffd080}
.sc-erc-msg{font-size:12px;color:#ccc;line-height:1.4}
#sc-erc-footer{padding:10px 16px;border-top:1px solid #444;text-align:right}
#sc-erc-footer button{padding:5px 14px;border:none;border-radius:3px;cursor:pointer;font-size:12px;background:#3a3a3a;color:#ccc}
#sc-erc-footer button:hover{background:#4a4a4a}
.sc-annot-text{font-family:monospace;cursor:pointer;user-select:none}
.sc-tb-wire{stroke:#336699;stroke-width:4}
#sc-tb-modal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999}
#sc-tb-box{background:#2d2d2d;border:1px solid #555;border-radius:6px;padding:20px 24px;width:360px;color:#ccc;font-size:13px}
#sc-tb-box h3{margin:0 0 14px;font-size:14px;color:#eee}
.sc-tb-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.sc-tb-lbl{width:64px;font-size:12px;color:#999;flex-shrink:0}
.sc-tb-inp{flex:1;background:#1a1a1a;border:1px solid #444;border-radius:3px;color:#eee;font-size:12px;padding:4px 6px}
.sc-tb-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.sc-tb-btns button{padding:5px 14px;border:none;border-radius:3px;cursor:pointer;font-size:12px}
#sc-tb-ok{background:#1a7fd4;color:#fff}
#sc-tb-cancel{background:#3a3a3a;color:#ccc}
#sc-main{display:flex;flex:1;min-height:0}
#sc-palette{width:152px;min-width:152px;background:#252525;display:flex;flex-direction:column;flex-shrink:0;border-right:1px solid #111}
#sc-pal-search{padding:6px 6px 4px;background:#252525;border-bottom:1px solid #333;flex-shrink:0}
#sc-pal-search input{width:100%;box-sizing:border-box;background:#1a1a1a;border:1px solid #444;border-radius:3px;color:#ccc;font-size:11px;padding:3px 6px;outline:none}
#sc-pal-search input:focus{border-color:#7a8fff}
#sc-pal-list{flex:1;overflow-y:auto}
.sc-pg-title{font-size:9px;color:#666;padding:6px 8px 2px;text-transform:uppercase;letter-spacing:.6px}
.sc-pb{display:flex;align-items:center;gap:5px;width:100%;padding:4px 8px;background:none;border:none;color:#bbb;cursor:pointer;font-size:11px;text-align:left;box-sizing:border-box}
.sc-pb:hover,.sc-pb.sc-active{background:#1a7fd4;color:#fff}
.sc-pb svg{flex-shrink:0}
#sc-cwrap{flex:1;min-width:0;overflow:hidden;position:relative;background:#fff}
#sc-canvas{width:100%;height:100%;display:block;cursor:crosshair}
#sc-panel{width:210px;min-width:210px;background:#1e1e1e;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0;border-left:1px solid #111}
.sc-ps{padding:8px;border-bottom:1px solid #2a2a2a;flex-shrink:0}
.sc-pt{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px}
#sc-netlist-wrap{flex:1;min-height:0;display:flex;flex-direction:column;padding:0}
#sc-netlist{flex:1;min-height:0;margin:0;padding:8px;font-size:10px;line-height:1.6;color:#8c8;background:#111;font-family:monospace;overflow:auto;white-space:pre}
.sc-pr{display:flex;flex-direction:column;gap:2px;margin-bottom:7px}
.sc-pl{font-size:10px;color:#777}
.sc-pi{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:3px;color:#ddd;padding:3px 5px;font-size:12px;font-family:monospace;width:100%;box-sizing:border-box}
.sc-pi:focus{outline:none;border-color:#1a7fd4}
.sc-pbs{display:flex;gap:4px;margin-top:3px}
.sc-pbtn{flex:1;padding:3px 0;background:#2e2e2e;border:none;border-radius:3px;color:#bbb;cursor:pointer;font-size:11px}
.sc-pbtn:hover{background:#3e3e3e}
.sc-pbtn.del{background:#3a1a1a;color:#f88}
.sc-pbtn.del:hover{background:#4a2a2a}
.sc-hint{font-size:11px;color:#666;font-style:italic}
#sc-hintbar{padding:3px 10px;background:#181818;font-size:10px;color:#555;flex-shrink:0;border-top:1px solid #111}
#sc-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999}
#sc-modal-box{background:#2d2d2d;border:1px solid #444;border-radius:6px;padding:20px 24px;max-width:320px;color:#ccc;font-size:13px}
#sc-modal-box p{margin:0 0 16px}
#sc-modal-btns{display:flex;gap:8px;justify-content:flex-end}
#sc-modal-btns button{padding:5px 14px;border:none;border-radius:3px;cursor:pointer;font-size:12px}
#sc-modal-cancel{background:#3a3a3a;color:#ccc}
#sc-modal-ok{background:#c0392b;color:#fff}
.sc-pin-snap{fill:#00e5ff;stroke:none}
.sc-netlabel{font-size:12px;fill:#1a7fd4;font-family:monospace;dominant-baseline:middle;user-select:none;cursor:pointer}
.sc-netlabel-bg{fill:#1e2030;stroke:#1a7fd4;stroke-width:1;rx:2}
.sc-box-sel{fill:rgba(26,127,212,0.08);stroke:#1a7fd4;stroke-width:1;stroke-dasharray:4,2}
.sc-directive{font-size:12px;fill:#4ec9b0;font-family:monospace;dominant-baseline:hanging;user-select:none;cursor:pointer}
#sc-dir-modal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999}
#sc-dir-box{background:#2d2d2d;border:1px solid #444;border-radius:6px;padding:18px 20px;width:340px;color:#ccc;font-size:13px}
#sc-dir-box h3{margin:0 0 12px;font-size:13px;color:#aaa;font-weight:600}
.sc-dir-templates{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.sc-dir-tpl{padding:4px 10px;background:#3a3a3a;border:1px solid #555;border-radius:3px;color:#ccc;cursor:pointer;font-size:11px;font-family:monospace}
.sc-dir-tpl:hover{background:#1a7fd4;border-color:#1a7fd4;color:#fff}
#sc-dir-textarea{width:100%;box-sizing:border-box;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:3px;color:#4ec9b0;font-family:monospace;font-size:12px;padding:6px;min-height:60px;resize:vertical;margin-bottom:10px}
#sc-dir-textarea:focus{outline:none;border-color:#1a7fd4}
.sc-dir-btns{display:flex;gap:8px;justify-content:flex-end}
.sc-dir-btns button{padding:5px 14px;border:none;border-radius:3px;cursor:pointer;font-size:12px}
#sc-dir-cancel{background:#3a3a3a;color:#ccc}
#sc-dir-ok{background:#1a7fd4;color:#fff}
`;
  document.head.appendChild(s);
}

// ─── Confirm modal ────────────────────────────────────────────────────────────

function confirmModal(msg: string, onYes: () => void): void {
  const overlay = document.createElement('div');
  overlay.id = 'sc-modal-overlay';
  overlay.innerHTML = `<div id="sc-modal-box"><p>${msg}</p>
<div id="sc-modal-btns">
  <button id="sc-modal-cancel">Cancel</button>
  <button id="sc-modal-ok">Clear All</button>
</div></div>`;
  document.body.appendChild(overlay);
  const close = (): void => { overlay.remove(); };
  overlay.querySelector<HTMLButtonElement>('#sc-modal-cancel')!.addEventListener('click', close);
  overlay.querySelector<HTMLButtonElement>('#sc-modal-ok')!.addEventListener('click', () => { close(); onYes(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// ─── HTML skeleton ────────────────────────────────────────────────────────────

function buildHTML(): string {
  return `<div id="sc-editor">
<div id="sc-toolbar">
  <button id="sc-btn-sel" class="sc-active" title="Select (Esc)">&#9654; Select</button>
  <button id="sc-btn-wire" title="Wire (W)">&#9135; Wire</button>
  <button id="sc-btn-label" title="Net Label (N)">&#8968; Label</button>
  <button id="sc-btn-dir" title="SPICE Directive (D)">&#46;&#46;&#46; Directive</button>
  <div class="sc-sep"></div>
  <button id="sc-btn-undo" disabled title="Undo (Ctrl+Z)">&#8630; Undo</button>
  <button id="sc-btn-redo" disabled title="Redo (Ctrl+Y)">&#8631; Redo</button>
  <div class="sc-sep"></div>
  <button id="sc-btn-clear">Clear</button>
  <div class="sc-sep"></div>
  <button id="sc-btn-conv">&#9889; Convert</button>
  <button id="sc-dl" disabled>&#8595; .net</button>
  <button id="sc-dl-asc" disabled>&#8595; .asc</button>
  <button id="sc-btn-erc" title="Electrical Rules Check">&#9889; ERC</button>
  <button id="sc-btn-sim" title="Send netlist to Simulator (Tab 3)">&#9654; Simulate</button>
  <div class="sc-sep"></div>
  <button id="sc-btn-annot" title="Text Annotation (A)">&#9000; Text</button>
  <button id="sc-btn-bus" title="Bus Wire (B)">&#9135;&#9135; Bus</button>
  <div class="sc-sep"></div>
  <button id="sc-btn-fit" title="Zoom to Fit (F)">&#9035; Fit</button>
  <button id="sc-btn-titleblock" title="Title Block">&#9633; Title</button>
  <div class="sc-sep"></div>
  <button id="sc-dl-svg">&#8595; SVG</button>
  <button id="sc-dl-png">&#8595; PNG</button>
  <span id="sc-status"></span>
  <span style="flex:1"></span>
  <span id="sc-info" style="font-size:11px;color:#666;margin-right:6px"></span>
</div>
<div id="sc-main">
  <div id="sc-palette">
    <div id="sc-pal-search"><input type="text" id="sc-pal-q" placeholder="&#128269; search symbols..." autocomplete="off"/></div>
    <div id="sc-pal-list"></div>
  </div>
  <div id="sc-cwrap">
    <svg id="sc-canvas" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="sc-gp" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse">
          <circle cx="${GRID / 2}" cy="${GRID / 2}" r="0.7" fill="#ccc" opacity="0.5"/>
        </pattern>
      </defs>
      <g id="sc-pz">
        <rect x="-8000" y="-8000" width="16000" height="16000" fill="url(#sc-gp)"/>
        <g id="sc-wires"></g>
        <g id="sc-comps"></g>
        <g id="sc-juncs"></g>
        <g id="sc-sel"></g>
        <g id="sc-ghost"></g>
        <g id="sc-annots"></g>
        <g id="sc-titleblock"></g>
      </g>
    </svg>
  </div>
  <div id="sc-panel">
    <div class="sc-ps">
      <div class="sc-pt">Properties</div>
      <div id="sc-props-body"><em class="sc-hint">Select a component</em></div>
    </div>
    <div id="sc-netlist-wrap" class="sc-ps" style="flex:1;min-height:0;display:flex;flex-direction:column;padding:0;border-bottom:none">
      <div class="sc-pt" style="padding:8px 8px 0">Netlist Output</div>
      <pre id="sc-netlist"></pre>
    </div>
  </div>
</div>
<div id="sc-hintbar"><span id="sc-hint-txt">Click palette&#8594;place &middot; W=wire &middot; B=bus &middot; N=label &middot; D=directive &middot; A=text &middot; Esc=select &middot; R=rotate &middot; M=mirror &middot; F=fit &middot; Del=delete &middot; Ctrl+C/V=copy/paste &middot; Ctrl+Z/Y=undo/redo</span></div>
</div>`;
}

// ─── Palette ──────────────────────────────────────────────────────────────────

function buildPalette(el: HTMLElement): void {
  const listEl = el.querySelector<HTMLElement>('#sc-pal-list')!;
  const searchEl = el.querySelector<HTMLInputElement>('#sc-pal-q')!;

  function renderPalette(filter: string): void {
    const q = filter.toLowerCase().trim();
    let h = '';
    for (const grp of PALETTE_GROUPS) {
      const matching = grp.types.filter(t => {
        const def = SYMDEFS[t];
        if (!def) return false;
        if (!q) return true;
        return def.label.toLowerCase().includes(q) ||
               t.toLowerCase().includes(q) ||
               def.group.toLowerCase().includes(q) ||
               def.prefix.toLowerCase().includes(q);
      });
      if (matching.length === 0) continue;
      if (!q) h += `<div class="sc-pg-title">${grp.name}</div>`;
      for (const t of matching) {
        const def: SymDef = SYMDEFS[t]!;
        const preview = `<svg width="28" height="28" viewBox="-36 -36 72 72" style="overflow:visible">
<g stroke="#aaa" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${def.svg}</g></svg>`;
        h += `<button class="sc-pb" data-type="${t}" title="${def.label}">${preview}<span>${def.label}</span></button>`;
      }
    }
    if (!h) h = '<div style="color:#666;font-size:11px;padding:8px 6px">No matches</div>';
    listEl.innerHTML = h;
    listEl.querySelectorAll<HTMLButtonElement>('.sc-pb').forEach(btn => {
      btn.addEventListener('click', () => enterPlace(btn.dataset['type']!));
    });
  }

  renderPalette('');
  searchEl.addEventListener('input', () => renderPalette(searchEl.value));
  // Esc in search box → clear and return focus to canvas
  searchEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') { searchEl.value = ''; renderPalette(''); searchEl.blur(); e.stopPropagation(); }
  });
}

// ─── Mode helpers ─────────────────────────────────────────────────────────────

function enterPlace(type: string): void {
  S.mode = 'place'; S.placing = type; S.placingRot = 'R0';
  S.sel = null; S.selWire = null; S.wireStart = null;
  document.getElementById('sc-btn-sel')!.classList.remove('sc-active');
  document.getElementById('sc-btn-wire')!.classList.remove('sc-active');
  document.querySelectorAll<HTMLButtonElement>('.sc-pb').forEach(b =>
    b.classList.toggle('sc-active', b.dataset['type'] === type));
  svgEl.style.cursor = 'crosshair';
  updateHint(`Placing ${SYMDEFS[type]?.label ?? type} — Left-click to place · R=rotate · M=mirror · Right-click=rotate · Esc=cancel`);
  renderGhost();
}


function enterAnnot(): void {
  S.mode = 'annot' as typeof S.mode; S.wireStart = null;
  S.sel = null; S.selWire = null; S.selLabel = null; S.selDir = null; S.selAnnot = null; S.selMulti = new Set(); S.selWireMulti = new Set();
  svgEl.style.cursor = 'text';
  document.getElementById('sc-btn-sel')!.classList.remove('sc-active');
  document.getElementById('sc-btn-annot')!.classList.add('sc-active');
}

function enterSelect(): void {
  S.mode = 'select'; S.placing = null; S.wireStart = null;
  S.sel = null; S.selWire = null; S.selLabel = null; S.selDir = null; S.selMulti = new Set();
  _boxDrag = null; _placingDirective = false;
  document.getElementById('sc-btn-sel')!.classList.add('sc-active');
  document.getElementById('sc-btn-bus')?.classList.remove('sc-active');
  document.getElementById('sc-btn-annot')?.classList.remove('sc-active');
  document.getElementById('sc-btn-wire')!.classList.remove('sc-active');
  document.getElementById('sc-btn-label')!.classList.remove('sc-active');
  document.getElementById('sc-btn-dir')!.classList.remove('sc-active');
  document.querySelectorAll<HTMLButtonElement>('.sc-pb').forEach(b => b.classList.remove('sc-active'));
  svgEl.style.cursor = 'default';
  ghostL.innerHTML = '';
  showProps(null);
  updateHint('Click to select &middot; Drag empty=box-select &middot; W=wire &middot; N=label &middot; R=rotate &middot; M=mirror &middot; Del=delete &middot; Ctrl+C/V=copy/paste');
  render();
}

function enterLabel(): void {
  S.mode = 'label'; S.wireStart = null; S.sel = null; S.selWire = null; S.selLabel = null; S.selDir = null; S.selMulti = new Set();
  document.getElementById('sc-btn-sel')!.classList.remove('sc-active');
  document.getElementById('sc-btn-wire')!.classList.remove('sc-active');
  document.getElementById('sc-btn-label')!.classList.add('sc-active');
  document.getElementById('sc-btn-dir')!.classList.remove('sc-active');
  document.querySelectorAll<HTMLButtonElement>('.sc-pb').forEach(b => b.classList.remove('sc-active'));
  svgEl.style.cursor = 'text';
  ghostL.innerHTML = '';
  showProps(null);
  updateHint('Click on canvas to place net label &middot; Esc=cancel');
}

function enterDirective(): void {
  S.mode = 'select'; // stays in select; click triggers modal then places
  S.wireStart = null; S.sel = null; S.selWire = null; S.selLabel = null; S.selDir = null; S.selMulti = new Set();
  document.getElementById('sc-btn-sel')!.classList.remove('sc-active');
  document.getElementById('sc-btn-wire')!.classList.remove('sc-active');
  document.getElementById('sc-btn-label')!.classList.remove('sc-active');
  document.getElementById('sc-btn-dir')!.classList.add('sc-active');
  document.querySelectorAll<HTMLButtonElement>('.sc-pb').forEach(b => b.classList.remove('sc-active'));
  svgEl.style.cursor = 'crosshair';
  ghostL.innerHTML = '';
  showProps(null);
  updateHint('Click canvas to place SPICE directive &middot; Esc=cancel');
  // Set a one-shot mode flag so next click opens the modal
  _placingDirective = true;
}

function enterWire(): void {
  S.mode = 'wire'; S.wireStart = null; S.sel = null; S.selWire = null;
  document.getElementById('sc-btn-sel')!.classList.remove('sc-active');
  document.getElementById('sc-btn-wire')!.classList.add('sc-active');
  document.querySelectorAll<HTMLButtonElement>('.sc-pb').forEach(b => b.classList.remove('sc-active'));
  svgEl.style.cursor = 'crosshair';
  ghostL.innerHTML = '';
  updateHint('Click start/end points · snaps to pins · Esc=cancel · Right-click=cancel segment');
  render();
}

function updateHint(msg: string): void { if (hintEl) hintEl.innerHTML = msg; }

// ─── Directive modal ──────────────────────────────────────────────────────────

const DIRECTIVE_TEMPLATES: { label: string; text: string }[] = [
  { label: '.op',        text: '.op' },
  { label: '.tran',      text: '.tran 1n 10u' },
  { label: '.ac dec',    text: '.ac dec 100 1 10Meg' },
  { label: '.ac oct',    text: '.ac oct 10 1 100k' },
  { label: '.ac lin',    text: '.ac lin 1000 1 10Meg' },
  { label: '.dc',        text: '.dc V1 0 5 0.1' },
  { label: '.tf',        text: '.tf V(out) Vin' },
  { label: '.ic',        text: '.ic V(node)=0' },
  { label: '.param',     text: '.param R=1k C=1n' },
  { label: '.meas',      text: '.meas tran vmax MAX V(out)' },
  { label: '.step',      text: '.step param R 100 10k 100' },
  { label: '.subckt',    text: '.subckt MyBlock A B\n* body\n.ends MyBlock' },
  { label: 'Custom',     text: '' },
];

function directiveModal(onPlace: (text: string) => void): void {
  const overlay = document.createElement('div');
  overlay.id = 'sc-dir-modal';
  overlay.innerHTML = `<div id="sc-dir-box">
<h3>SPICE Directive</h3>
<div class="sc-dir-templates">${
  DIRECTIVE_TEMPLATES.map(t =>
    `<button class="sc-dir-tpl" data-text="${t.text}">${t.label}</button>`
  ).join('')
}</div>
<textarea id="sc-dir-textarea" spellcheck="false" placeholder=".tran 1n 10u"></textarea>
<div class="sc-dir-btns">
  <button id="sc-dir-cancel">Cancel</button>
  <button id="sc-dir-ok">Place</button>
</div></div>`;
  document.body.appendChild(overlay);

  const ta = overlay.querySelector<HTMLTextAreaElement>('#sc-dir-textarea')!;
  ta.focus();

  overlay.querySelectorAll<HTMLButtonElement>('.sc-dir-tpl').forEach(btn => {
    btn.addEventListener('click', () => {
      ta.value = btn.dataset['text'] ?? '';
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  });

  const close = (): void => { overlay.remove(); };
  overlay.querySelector('#sc-dir-cancel')!.addEventListener('click', close);
  overlay.querySelector('#sc-dir-ok')!.addEventListener('click', () => {
    const text = ta.value.trim();
    close();
    if (text) onPlace(text);
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const text = ta.value.trim();
      close();
      if (text) onPlace(text);
    }
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// ─── World ↔ screen ───────────────────────────────────────────────────────────

function evToWorld(e: MouseEvent): [number, number] {
  const r = svgEl.getBoundingClientRect();
  return [snap((e.clientX - r.left - S.pan.x) / S.zoom),
          snap((e.clientY - r.top  - S.pan.y) / S.zoom)];
}

// ─── Fix 1: Snap-to-pin ───────────────────────────────────────────────────────

function snapToPin(wx: number, wy: number): [number, number] {
  let best: [number, number] | null = null;
  let bestDist = PIN_SNAP_THRESHOLD;
  for (const c of S.comps) {
    for (const p of getEffectivePins(c)) {
      const [rpx, rpy] = rotPt(p, c.rot);
      const pinX = c.x + rpx, pinY = c.y + rpy;
      const d = Math.hypot(wx - pinX, wy - pinY);
      if (d < bestDist) { bestDist = d; best = [pinX, pinY]; }
    }
  }
  return best ?? [wx, wy];
}

// ─── Fix 2: Wire split on component drop ──────────────────────────────────────

function splitWiresAtPins(comp: Comp): void {
  const pins = getEffectivePins(comp);
  if (pins.length === 0) return;
  const toRemove = new Set<string>();
  const toAdd: Wire[] = [];
  for (const p of pins) {
    const [rpx, rpy] = rotPt(p, comp.rot);
    const px = comp.x + rpx, py = comp.y + rpy;
    for (const w of S.wires) {
      if (toRemove.has(w.id)) continue;
      // Point must be strictly inside the segment (not at endpoints)
      if (onSeg(px, py, w.x1, w.y1, w.x2, w.y2) &&
          !(px === w.x1 && py === w.y1) && !(px === w.x2 && py === w.y2)) {
        toRemove.add(w.id);
        toAdd.push({ id: uid(), x1: w.x1, y1: w.y1, x2: px, y2: py });
        toAdd.push({ id: uid(), x1: px, y1: py, x2: w.x2, y2: w.y2 });
      }
    }
  }
  if (toRemove.size > 0) {
    S.wires = S.wires.filter(w => !toRemove.has(w.id)).concat(toAdd);
    markJunctionsDirty();
  }
}

// ─── Auto-name ────────────────────────────────────────────────────────────────

function autoName(type: string): string {
  const def = SYMDEFS[type];
  const pfx = def?.prefix ?? type[0] ?? 'X';
  let max = 0;
  for (const c of S.comps) {
    if (c.name && c.name.toUpperCase().startsWith(pfx)) {
      const n = parseInt(c.name.slice(pfx.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  S.counters[pfx] = max + 1;
  return pfx + S.counters[pfx];
}

function defaultValue(type: string): string {
  const map: Record<string, string> = {
    R:'1k', C:'1n', L:'1u', V:'5', I:'1m', D:'1N4148',
    Q_NPN:'2N3904', Q_PNP:'2N3906', M_NMOS:'NMOS', M_PMOS:'PMOS',
    J_N:'J2N3819', J_P:'J2N3819', B:'V=0', K:'1', T:'Td=1n Z0=50',
    E:'1', G:'1', F:'1', H:'1',
    // Fix 6: S/W use model name as default value, not threshold pair
    S:'SWITMOD', W:'SWITMOD',
    X:'SUBCKT', GND:'0', VDD:'VDD', VCC:'VCC', VSS:'VSS',
  };
  return map[type] ?? '?';
}

// ─── Fix 3: Junction detection — only when dirty ──────────────────────────────

function computeEditorJunctions(): void {
  const cnt = new Map<string, number>();
  const bump = (k: string): void => { cnt.set(k, (cnt.get(k) ?? 0) + 1); };
  for (const w of S.wires) { bump(w.x1 + ',' + w.y1); bump(w.x2 + ',' + w.y2); }
  for (const w of S.wires) {
    for (const w2 of S.wires) {
      if (w === w2) continue;
      for (const [ex, ey] of [[w.x1, w.y1], [w.x2, w.y2]] as [number, number][]) {
        if (onSeg(ex, ey, w2.x1, w2.y1, w2.x2, w2.y2) &&
            !(ex === w2.x1 && ey === w2.y1) && !(ex === w2.x2 && ey === w2.y2)) {
          cnt.set(ex + ',' + ey, 99);
        }
      }
    }
  }
  S.junctions = [];
  for (const [k, n] of cnt) {
    if (n >= 3) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      S.junctions.push({ x, y });
    }
  }
}

// ─── Wire hit detection ───────────────────────────────────────────────────────

function ptToSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(): void {
  pzEl.setAttribute('transform', `translate(${S.pan.x},${S.pan.y}) scale(${S.zoom})`);

  // Fix 3: only recompute junctions when wires changed
  if (_junctionsDirty) {
    computeEditorJunctions();
    _junctionsDirty = false;
  }

  wireL.innerHTML = S.wires.map(w => {
    const isSel  = w.id === S.selWire;
    const isMulti = S.selWireMulti.has(w.id);
    const isBus   = !!w.bus;
    const stroke = isSel ? '#1a7fd4' : isMulti ? '#ff9900' : isBus ? '#336699' : '#1a1a1a';
    const sw = isSel ? 3 : isMulti ? 3 : isBus ? 4 : 2;
    return `<line id="scw-${w.id}" data-wid="${w.id}"
     x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}"
     stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" style="cursor:default"/>`;
  }).join('');

  let csvg = '';
  for (const c of S.comps) {
    const def: SymDef | undefined = SYMDEFS[c.type];
    if (!def) continue;
    const isSel  = c.id === S.sel;
    const stroke = isSel ? '#1a7fd4' : '#1a1a1a';
    const pins   = getEffectivePins(c);  // Fix 5: dynamic pins for X
    csvg += `<g id="scc-${c.id}" data-cid="${c.id}" transform="translate(${c.x},${c.y}) ${svgTransform(c.rot)}" style="cursor:pointer">`;
    if (isSel) csvg += `<rect x="-38" y="-44" width="76" height="88" fill="#1a7fd440" stroke="#1a7fd4" stroke-width="1" rx="3" stroke-dasharray="4,2"/>`;
    csvg += `<g stroke="${stroke}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" color="${stroke}">`;
    csvg += def.svg;
    csvg += '</g>';
    if (def.refOffset && c.name)  csvg += `<text x="${def.refOffset[0]}" y="${def.refOffset[1]}" font-size="11" fill="${stroke}" font-family="monospace" style="user-select:none">${c.name}</text>`;
    if (def.valOffset && c.value) csvg += `<text x="${def.valOffset[0]}" y="${def.valOffset[1]}" font-size="10" fill="#666" font-family="monospace" style="user-select:none">${c.value}</text>`;
    for (const [px, py] of pins) csvg += `<circle cx="${px}" cy="${py}" r="2.5" fill="${isSel ? '#1a7fd4' : '#888'}" stroke="none"/>`;
    csvg += `<rect x="-38" y="-44" width="76" height="88" fill="transparent"/>`;
    csvg += '</g>';
  }
  compL.innerHTML = csvg;

  juncL.innerHTML = S.junctions.map(j => `<circle cx="${j.x}" cy="${j.y}" r="4" fill="#1a1a1a"/>`).join('');

  // Net labels
  const labelSvg = S.labels.map(l => {
    const isSel = l.id === S.selLabel;
    const stroke = isSel ? '#ff9900' : '#1a7fd4';
    const pad = 4;
    const charW = 7.5, h = 16;
    const w = l.name.length * charW + pad * 2;
    return `<g data-lid="${l.id}" style="cursor:pointer">
<rect x="${l.x}" y="${l.y - h / 2}" width="${w}" height="${h}" fill="#1e2030" stroke="${stroke}" stroke-width="1" rx="2"/>
<line x1="${l.x}" y1="${l.y}" x2="${l.x - 8}" y2="${l.y}" stroke="${stroke}" stroke-width="1.5"/>
<text x="${l.x + pad}" y="${l.y}" class="sc-netlabel" fill="${stroke}">${l.name}</text>
</g>`;
  }).join('');
  // Append labels to juncL layer (re-use, labels are drawn after junctions)
  juncL.innerHTML += labelSvg;

  // Multi-select highlight rings
  let multiSelSvg = '';
  for (const id of S.selMulti) {
    const c = S.comps.find(cc => cc.id === id);
    if (c) multiSelSvg += `<rect x="${c.x - 38}" y="${c.y - 44}" width="76" height="88" fill="none" stroke="#ff9900" stroke-width="1.5" stroke-dasharray="4,2" rx="3" transform="${svgTransform(c.rot).replace('matrix', 'translate(' + c.x + ',' + c.y + ') matrix').slice(0, -1)}"/>`;
  }
  selL.innerHTML = multiSelSvg;

  // Directives — rendered in ghostL layer (above junctions, doesn't need its own layer)
  const dirSvg = S.directives.map(d => {
    const isSel = d.id === S.selDir;
    const lines = d.text.split('\n');
    const lineH = 14, pad = 5;
    const maxLen = Math.max(...lines.map(l => l.length));
    const bw = maxLen * 7.3 + pad * 2, bh = lines.length * lineH + pad * 2;
    const stroke = isSel ? '#ff9900' : '#4ec9b0';
    const textLines = lines.map((l, i) =>
      `<tspan x="${d.x + pad}" dy="${i === 0 ? 0 : lineH}">${l.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</tspan>`
    ).join('');
    return `<g data-did="${d.id}" style="cursor:pointer">
<rect x="${d.x}" y="${d.y}" width="${bw}" height="${bh}" fill="#0d1117" stroke="${stroke}" stroke-width="${isSel ? 1.5 : 1}" rx="2" opacity="0.9"/>
<text x="${d.x + pad}" y="${d.y + pad + 11}" class="sc-directive" fill="${stroke}">${textLines}</text>
</g>`;
  }).join('');
  // Append directive SVG to juncL (reuse existing layer — above wires and comps)
  juncL.innerHTML += dirSvg;

  // Text annotations
  annotL.innerHTML = S.annots.map(a => {
    const isSel = a.id === S.selAnnot;
    const lines = a.text.split('\n');
    const lineH = a.fontSize + 4;
    const escText = (t: string) => t.replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const tspans = lines.map((l,i) =>
      `<tspan x="${a.x}" dy="${i===0?0:lineH}">${escText(l)}</tspan>`
    ).join('');
    return `<g data-aid="${a.id}" style="cursor:pointer">
${isSel ? `<rect x="${a.x-2}" y="${a.y - a.fontSize - 2}" width="${Math.max(...lines.map(l=>l.length))*a.fontSize*0.62+4}" height="${lines.length*lineH+4}" fill="none" stroke="#ff9900" stroke-width="1" stroke-dasharray="3,2" rx="2"/>` : ''}
<text x="${a.x}" y="${a.y}" class="sc-annot-text" font-size="${a.fontSize}" fill="${isSel?'#ff9900':'#e0e0e0'}">${tspans}</text>
</g>`;
  }).join('');

  if (S.mode !== 'place' && S.mode !== 'label' && S.mode !== 'annot' && S.mode !== 'bus') ghostL.innerHTML = '';
  renderTitleBlock();
  infoEl.textContent = `${S.comps.filter(c => !SYMDEFS[c.type]?.netName).length} comp · ${S.wires.length} wire · ${S.labels.length} label · ${S.directives.length} dir`;
}

// ─── Ghost (placement preview) ────────────────────────────────────────────────

function renderGhost(): void {
  if (S.mode !== 'place' || !S.placing) { ghostL.innerHTML = ''; return; }
  const def: SymDef | undefined = SYMDEFS[S.placing];
  if (!def) return;
  const { x, y } = S.mouse;
  // Show effective pins for X based on current pinCount in placing context (default 2)
  const previewPins = def.pins;
  ghostL.innerHTML = `<g transform="translate(${x},${y}) ${svgTransform(S.placingRot)}" opacity="0.55">
<g stroke="#1a7fd4" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" color="#1a7fd4">
${def.svg}</g>
${previewPins.map(([px, py]) => `<circle cx="${px}" cy="${py}" r="3" fill="#1a7fd4" stroke="none"/>`).join('')}
</g>`;
}

// ─── Wire preview (with pin snap indicator) ───────────────────────────────────

function renderWirePreview(wx: number, wy: number): void {
  const [sx2, sy2] = snapToPin(wx, wy);
  const snapped = sx2 !== wx || sy2 !== wy;
  let snapDot = '';
  if (snapped) {
    snapDot = `<circle cx="${sx2}" cy="${sy2}" r="5" class="sc-pin-snap"/>`;
  }
  if (!S.wireStart) {
    ghostL.innerHTML = snapDot; return;
  }
  const { x: sx, y: sy } = S.wireStart;
  let segs = '';
  if (sx !== sx2 && sy !== sy2) {
    segs += `<line x1="${sx}" y1="${sy}" x2="${sx2}" y2="${sy}" stroke="#1a7fd4" stroke-width="2" stroke-dasharray="4,3"/>`;
    segs += `<line x1="${sx2}" y1="${sy}" x2="${sx2}" y2="${sy2}" stroke="#1a7fd4" stroke-width="2" stroke-dasharray="4,3"/>`;
  } else {
    segs += `<line x1="${sx}" y1="${sy}" x2="${sx2}" y2="${sy2}" stroke="#1a7fd4" stroke-width="2" stroke-dasharray="4,3"/>`;
  }
  ghostL.innerHTML = segs + `<circle cx="${sx}" cy="${sy}" r="3" fill="#1a7fd4"/>` + snapDot;
}

// ─── Properties panel ─────────────────────────────────────────────────────────

function showProps(comp: Comp | null): void {
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

function showWireProps(wire: Wire): void {
  propsBodyEl.innerHTML = `
<div style="color:#aaa;font-size:11px;margin-bottom:8px">Wire &nbsp;<span style="color:#666;font-family:monospace;font-size:10px">(${wire.x1},${wire.y1})→(${wire.x2},${wire.y2})</span></div>
<div class="sc-pbs"><button class="sc-pbtn del" id="pi-del-wire">&#10005; Delete Wire</button></div>`;
  propsBodyEl.querySelector<HTMLButtonElement>('#pi-del-wire')!
    .addEventListener('click', () => deleteSelected());
}

function showLabelProps(label: NetLabel): void {
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

function deleteSelected(): void {
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

// ─── Netlist generation ───────────────────────────────────────────────────────

function generateNetlist(): string {
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

function generateAsc(): string {
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

function runERC(): void {
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

function showERCResults(issues: ERCIssue[]): void {
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



function renderBusPreview(wx: number, wy: number): void {
  if (!S.wireStart) return;
  const sx = snap(wx), sy = snap(wy);
  ghostL.innerHTML = `<line x1="${S.wireStart.x}" y1="${S.wireStart.y}" x2="${sx}" y2="${sy}" stroke="#336699" stroke-width="4" stroke-linecap="round" opacity="0.7"/>`;
}

// ─── Tier 3: Zoom to Fit ──────────────────────────────────────────────────────

function zoomToFit(): void {
  if (S.comps.length === 0 && S.wires.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of S.comps) {
    minX = Math.min(minX, c.x - 48); minY = Math.min(minY, c.y - 48);
    maxX = Math.max(maxX, c.x + 48); maxY = Math.max(maxY, c.y + 48);
  }
  for (const w of S.wires) {
    minX = Math.min(minX, w.x1, w.x2); minY = Math.min(minY, w.y1, w.y2);
    maxX = Math.max(maxX, w.x1, w.x2); maxY = Math.max(maxY, w.y1, w.y2);
  }
  const pad = 40;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const rect = svgEl.getBoundingClientRect();
  const scaleX = rect.width  / (maxX - minX);
  const scaleY = rect.height / (maxY - minY);
  S.zoom = Math.min(scaleX, scaleY, 4);
  S.pan.x = -minX * S.zoom + (rect.width  - (maxX - minX) * S.zoom) / 2;
  S.pan.y = -minY * S.zoom + (rect.height - (maxY - minY) * S.zoom) / 2;
  pzEl.setAttribute('transform', `translate(${S.pan.x},${S.pan.y}) scale(${S.zoom})`);
}

// ─── Tier 3: Bus wire mode ────────────────────────────────────────────────────

function enterBus(): void {
  S.mode = 'bus' as typeof S.mode; S.wireStart = null;
  S.sel = null; S.selWire = null; S.selLabel = null; S.selDir = null; S.selAnnot = null;
  S.selMulti = new Set(); S.selWireMulti = new Set();
  svgEl.style.cursor = 'crosshair';
  document.getElementById('sc-btn-sel')!.classList.remove('sc-active');
  document.getElementById('sc-btn-bus')!.classList.add('sc-active');
}

function busClick(wx: number, wy: number): void {
  const [sx, sy] = [snap(wx), snap(wy)];
  if (!S.wireStart) { S.wireStart = { x: sx, y: sy }; return; }
  if (sx === S.wireStart.x && sy === S.wireStart.y) { S.wireStart = null; ghostL.innerHTML = ''; return; }
  pushHistory();
  S.wires.push({ id: uid(), x1: S.wireStart.x, y1: S.wireStart.y, x2: sx, y2: sy, bus: true });
  S.wireStart = { x: sx, y: sy };
  markJunctionsDirty(); render();
}

// ─── Tier 3: Title Block ──────────────────────────────────────────────────────

let titleBlockL: SVGGElement;

function renderTitleBlock(): void {
  if (!titleBlockL) return;
  if (!S.titleBlock.visible) { titleBlockL.innerHTML = ''; return; }
  const tb = S.titleBlock;
  const W = 400, H = 100, margin = 20;
  // Position at bottom-right of world coords (always at fixed world position)
  const x0 = 2000 - W - margin, y0 = 1200 - H - margin;
  const col1 = x0 + 80;
  titleBlockL.innerHTML = `
<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="#1a1a1a" stroke="#555" stroke-width="1.5"/>
<line x1="${x0}" y1="${y0+26}" x2="${x0+W}" y2="${y0+26}" stroke="#555" stroke-width="1"/>
<line x1="${x0}" y1="${y0+52}" x2="${x0+W}" y2="${y0+52}" stroke="#555" stroke-width="1"/>
<line x1="${x0}" y1="${y0+76}" x2="${x0+W}" y2="${y0+76}" stroke="#555" stroke-width="1"/>
<line x1="${col1-2}" y1="${y0}" x2="${col1-2}" y2="${y0+H}" stroke="#555" stroke-width="1"/>
<text x="${x0+6}" y="${y0+17}" font-size="9" fill="#888" font-family="monospace">TITLE</text>
<text x="${col1+4}" y="${y0+19}" font-size="13" fill="#eee" font-family="monospace" font-weight="bold">${tb.title.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text>
<text x="${x0+6}" y="${y0+43}" font-size="9" fill="#888" font-family="monospace">DOC</text>
<text x="${col1+4}" y="${y0+45}" font-size="11" fill="#ccc" font-family="monospace">${tb.doc.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text>
<text x="${x0+6}" y="${y0+69}" font-size="9" fill="#888" font-family="monospace">AUTHOR</text>
<text x="${col1+4}" y="${y0+71}" font-size="11" fill="#ccc" font-family="monospace">${tb.author.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text>
<text x="${x0+6}" y="${y0+93}" font-size="9" fill="#888" font-family="monospace">DATE</text>
<text x="${col1+4}" y="${y0+93}" font-size="10" fill="#ccc" font-family="monospace">${tb.date}</text>
<text x="${x0+W-50}" y="${y0+93}" font-size="9" fill="#888" font-family="monospace">REV</text>
<text x="${x0+W-24}" y="${y0+93}" font-size="11" fill="#ccc" font-family="monospace">${tb.rev}</text>
`;
}

function showTitleBlockModal(): void {
  const existing = document.getElementById('sc-tb-modal');
  if (existing) existing.remove();
  const tb = S.titleBlock;
  const overlay = document.createElement('div');
  overlay.id = 'sc-tb-modal';
  overlay.innerHTML = `<div id="sc-tb-box">
  <h3>&#9633; Title Block</h3>
  <div class="sc-tb-row"><span class="sc-tb-lbl">Title</span><input class="sc-tb-inp" id="tb-title" value="${tb.title}"/></div>
  <div class="sc-tb-row"><span class="sc-tb-lbl">Document</span><input class="sc-tb-inp" id="tb-doc" value="${tb.doc}"/></div>
  <div class="sc-tb-row"><span class="sc-tb-lbl">Author</span><input class="sc-tb-inp" id="tb-author" value="${tb.author}"/></div>
  <div class="sc-tb-row"><span class="sc-tb-lbl">Revision</span><input class="sc-tb-inp" id="tb-rev" value="${tb.rev}" style="width:60px;flex:none"/></div>
  <div class="sc-tb-row"><span class="sc-tb-lbl">Date</span><input class="sc-tb-inp" id="tb-date" value="${tb.date}" style="width:110px;flex:none"/></div>
  <div class="sc-tb-row"><label style="gap:6px;display:flex;align-items:center"><input type="checkbox" id="tb-vis" ${tb.visible?'checked':''}/> Show title block</label></div>
  <div class="sc-tb-btns"><button id="sc-tb-cancel">Cancel</button><button id="sc-tb-ok">Apply</button></div>
</div>`;
  document.body.appendChild(overlay);
  const close = (): void => overlay.remove();
  overlay.querySelector<HTMLButtonElement>('#sc-tb-cancel')!.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector<HTMLButtonElement>('#sc-tb-ok')!.addEventListener('click', () => {
    S.titleBlock.title  = (overlay.querySelector<HTMLInputElement>('#tb-title')!).value.trim() || 'Untitled';
    S.titleBlock.doc    = (overlay.querySelector<HTMLInputElement>('#tb-doc')!).value.trim();
    S.titleBlock.author = (overlay.querySelector<HTMLInputElement>('#tb-author')!).value.trim();
    S.titleBlock.rev    = (overlay.querySelector<HTMLInputElement>('#tb-rev')!).value.trim() || 'A';
    S.titleBlock.date   = (overlay.querySelector<HTMLInputElement>('#tb-date')!).value.trim();
    S.titleBlock.visible = (overlay.querySelector<HTMLInputElement>('#tb-vis')!).checked;
    saveToStorage();
    renderTitleBlock();
    close();
  });
}

// ─── Tier 3: Cross-session clipboard ─────────────────────────────────────────

const CLIP_KEY = 'weave-sc-clip-v1';

function clipboardCopy(comps: Comp[]): void {
  _clipboard = comps.map(c => ({ ...c, extra: { ...c.extra } }));
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(_clipboard)); } catch { /* quota */ }
}

function clipboardPaste(): Comp[] {
  if (_clipboard.length > 0) return _clipboard;
  try {
    const raw = localStorage.getItem(CLIP_KEY);
    if (raw) { _clipboard = JSON.parse(raw) as Comp[]; }
  } catch { /* ignore */ }
  return _clipboard;
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportSVG(): void {
  // Clone SVG, embed font/style
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  const rect = svgEl.getBoundingClientRect();
  clone.setAttribute('width', String(rect.width));
  clone.setAttribute('height', String(rect.height));
  // Inline the editor CSS for standalone rendering
  const styleEl = document.getElementById('sc-css');
  if (styleEl) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    s.textContent = styleEl.textContent;
    clone.prepend(s);
  }
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'schematic.svg';
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportPNG(): void {
  const rect = svgEl.getBoundingClientRect();
  const w = Math.round(rect.width), h = Math.round(rect.height);
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const styleEl = document.getElementById('sc-css');
  if (styleEl) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    s.textContent = styleEl.textContent;
    clone.prepend(s);
  }
  const svgStr = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = w * 2; canvas.height = h * 2; // 2x for retina
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'schematic.png';
    a.click();
  };
  img.src = url;
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents(root: HTMLElement): void {
  const selBtn   = root.querySelector<HTMLButtonElement>('#sc-btn-sel')!;
  const wireBtn  = root.querySelector<HTMLButtonElement>('#sc-btn-wire')!;
  const clearBtn = root.querySelector<HTMLButtonElement>('#sc-btn-clear')!;
  const convBtn  = root.querySelector<HTMLButtonElement>('#sc-btn-conv')!;

  selBtn.addEventListener('click', enterSelect);
  wireBtn.addEventListener('click', enterWire);
  root.querySelector<HTMLButtonElement>('#sc-btn-label')!.addEventListener('click', enterLabel);
  root.querySelector<HTMLButtonElement>('#sc-btn-dir')!.addEventListener('click', enterDirective);
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  root.querySelector<HTMLButtonElement>('#sc-btn-erc')!.addEventListener('click', runERC);
  root.querySelector<HTMLButtonElement>('#sc-btn-sim')!.addEventListener('click', () => {
    try { S.lastNet = generateNetlist(); netlistEl.textContent = S.lastNet; dlBtn.disabled = false; dlAscBtn.disabled = false; } catch { /* use existing */ }
    const net = S.lastNet.trim();
    if (!net) { statusEl.textContent = 'No netlist — click Convert first'; statusEl.className = 'bad'; return; }
    try { localStorage.setItem('weave-sim-netlist-v1', net); } catch { /* ignore */ }
    const sw = (window as Window & typeof globalThis & Record<string, unknown>).switchTab as ((n: number) => void) | undefined;
    if (sw) sw(3);
  });
  root.querySelector<HTMLButtonElement>('#sc-btn-annot')!.addEventListener('click', enterAnnot);
  root.querySelector<HTMLButtonElement>('#sc-btn-bus')!.addEventListener('click', enterBus);
  root.querySelector<HTMLButtonElement>('#sc-btn-fit')!.addEventListener('click', zoomToFit);
  root.querySelector<HTMLButtonElement>('#sc-btn-titleblock')!.addEventListener('click', showTitleBlockModal);

  // SVG export
  root.querySelector<HTMLButtonElement>('#sc-dl-svg')!.addEventListener('click', exportSVG);
  // PNG export
  root.querySelector<HTMLButtonElement>('#sc-dl-png')!.addEventListener('click', exportPNG);

  clearBtn.addEventListener('click', () => {
    confirmModal('Clear all components and wires?', () => {
      pushHistory();
      S.comps = []; S.wires = []; S.junctions = []; S.sel = null; S.selWire = null; S.wireStart = null;
      S.lastNet = ''; netlistEl.textContent = ''; dlBtn.disabled = true; dlAscBtn.disabled = true;
      statusEl.textContent = ''; showProps(null); markJunctionsDirty(); render();
    });
  });

  convBtn.addEventListener('click', () => {
    try {
      S.lastNet = generateNetlist();
      netlistEl.textContent = S.lastNet;
      const n = S.lastNet.split('\n').filter(l => l.trim() && !l.startsWith('*') && !l.startsWith('.') && l.trim()).length;
      statusEl.textContent = n + ' element(s)'; statusEl.className = 'ok';
      dlBtn.disabled = false;
      dlAscBtn.disabled = false;
    } catch (e) {
      statusEl.textContent = 'Error: ' + (e instanceof Error ? e.message : String(e));
      statusEl.className = 'bad';
    }
  });

  dlBtn.addEventListener('click', () => {
    if (!S.lastNet) return;
    const b = new Blob([S.lastNet], { type: 'text/plain' });
    const a = document.createElement('a');
    const d = new Date(), p = (n: number): string => String(n).padStart(2, '0');
    const ts = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes());
    a.download = 'netlist_' + ts + '.net';
    a.href = URL.createObjectURL(b); a.click(); URL.revokeObjectURL(a.href);
  });

  dlAscBtn.addEventListener('click', () => {
    try {
      const asc = generateAsc();
      const b = new Blob([asc], { type: 'text/plain' });
      const a = document.createElement('a');
      const d = new Date(), p = (n: number): string => String(n).padStart(2, '0');
      const ts = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes());
      a.download = 'schematic_' + ts + '.asc';
      a.href = URL.createObjectURL(b); a.click(); URL.revokeObjectURL(a.href);
    } catch (e) {
      statusEl.textContent = 'ASC error: ' + (e instanceof Error ? e.message : String(e));
      statusEl.className = 'bad';
    }
  });

  // ── Mouse move ──
  svgEl.addEventListener('mousemove', e => {
    const [wx, wy] = evToWorld(e);
    S.mouse.x = wx; S.mouse.y = wy;

    if (_panDrag) {
      S.pan.x += e.clientX - _panDrag.lx; S.pan.y += e.clientY - _panDrag.ly;
      _panDrag.lx = e.clientX; _panDrag.ly = e.clientY;
      pzEl.setAttribute('transform', `translate(${S.pan.x},${S.pan.y}) scale(${S.zoom})`);
      return;
    }

    if (_dragComp && S.mode === 'select') {
      const dx = wx - _dragComp.startX;
      const dy = wy - _dragComp.startY;
      if (!_dragActive && (Math.abs(dx) >= GRID || Math.abs(dy) >= GRID)) {
        _dragActive = true;
      }
      if (_dragActive) {
        const comp = S.comps.find(c => c.id === _dragComp!.id);
        if (comp) {
          const snapDx = snap(_dragComp.origX + dx) - _dragComp.origX;
          const snapDy = snap(_dragComp.origY + dy) - _dragComp.origY;
          comp.x = _dragComp.origX + snapDx;
          comp.y = _dragComp.origY + snapDy;
          // Move all other selected comps by same delta
          if (S.selMulti.has(comp.id)) {
            for (const [id2, orig] of _dragMultiOrigComps) {
              if (id2 === comp.id) continue;
              const c2 = S.comps.find(c => c.id === id2);
              if (c2) { c2.x = orig.x + snapDx; c2.y = orig.y + snapDy; }
            }
            for (const [wid, orig] of _dragMultiOrigWires) {
              const w2 = S.wires.find(w => w.id === wid);
              if (w2) { w2.x1 = orig.x1 + snapDx; w2.y1 = orig.y1 + snapDy; w2.x2 = orig.x2 + snapDx; w2.y2 = orig.y2 + snapDy; }
            }
          }
          // Rubber-band attached wire endpoints (single-comp mode)
          for (const we of _dragWireEnds) {
            const w = S.wires.find(w => w.id === we.wireId);
            if (!w) continue;
            if (we.end === 1) { w.x1 = comp.x + we.ox; w.y1 = comp.y + we.oy; }
            else              { w.x2 = comp.x + we.ox; w.y2 = comp.y + we.oy; }
          }
          markJunctionsDirty();
          render();
        }
        return;
      }
    }

    if (_boxDrag && S.mode === 'select') {
      _boxDrag.cx = wx; _boxDrag.cy = wy;
      const bx = Math.min(_boxDrag.sx, wx), by = Math.min(_boxDrag.sy, wy);
      const bw = Math.abs(wx - _boxDrag.sx), bh = Math.abs(wy - _boxDrag.sy);
      selL.innerHTML = `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" class="sc-box-sel"/>`;
      return;
    }

    if (S.mode === 'place') renderGhost();
    // Fix 1: wire preview uses pin-snapped coords
    if (S.mode === 'wire')  renderWirePreview(wx, wy);
    if (S.mode === 'bus')   renderBusPreview(wx, wy);
    // Label ghost
    if (S.mode === 'label') {
      ghostL.innerHTML = `<rect x="${wx}" y="${wy - 8}" width="40" height="16" fill="#1e2030" stroke="#1a7fd4" stroke-width="1" rx="2" opacity="0.7"/>
<text x="${wx + 4}" y="${wy}" class="sc-netlabel" opacity="0.7">net</text>`;
    }
  });

  // ── Mouse down ──
  svgEl.addEventListener('mousedown', e => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault(); _panDrag = { lx: e.clientX, ly: e.clientY }; return;
    }
    if (e.button === 0 && S.mode === 'select') {
      let el = e.target as HTMLElement | null;
      let cid: string | null = null;
      while (el && el !== (svgEl as unknown as HTMLElement)) {
        if ((el as HTMLElement & { dataset: DOMStringMap }).dataset?.['cid']) {
          cid = (el as HTMLElement & { dataset: DOMStringMap }).dataset['cid']!;
          break;
        }
        el = el.parentElement;
      }
      if (cid) {
        const comp = S.comps.find(c => c.id === cid);
        if (comp) {
          const [wx, wy] = evToWorld(e);
          _dragComp = { id: cid, startX: wx, startY: wy, origX: comp.x, origY: comp.y };
          _dragActive = false;
          // Record original positions for multi-select drag
          _dragMultiOrigComps = new Map();
          _dragMultiOrigWires = new Map();
          if (S.selMulti.has(cid)) {
            for (const id2 of S.selMulti) {
              const c2 = S.comps.find(c => c.id === id2);
              if (c2) _dragMultiOrigComps.set(id2, { x: c2.x, y: c2.y });
            }
            for (const wid of S.selWireMulti) {
              const w2 = S.wires.find(w => w.id === wid);
              if (w2) _dragMultiOrigWires.set(wid, { x1: w2.x1, y1: w2.y1, x2: w2.x2, y2: w2.y2 });
            }
          }
          // Collect wire endpoints that lie on this component's pins
          _dragWireEnds = [];
          const def2 = SYMDEFS[comp.type];
          if (def2) {
            for (const pin of getEffectivePins(comp)) {
              const rp = rotPt(pin, comp.rot);
              const px = comp.x + rp[0], py = comp.y + rp[1];
              for (const w of S.wires) {
                if (w.x1 === px && w.y1 === py)
                  _dragWireEnds.push({ wireId: w.id, end: 1, ox: rp[0], oy: rp[1] });
                if (w.x2 === px && w.y2 === py)
                  _dragWireEnds.push({ wireId: w.id, end: 2, ox: rp[0], oy: rp[1] });
              }
            }
          }
        }
      } else {
        // Start box select on empty area
        const [wx, wy] = evToWorld(e);
        _boxDrag = { sx: wx, sy: wy, cx: wx, cy: wy };
      }
    }
  });

  // ── Mouse up ──
  window.addEventListener('mouseup', () => {
    if (_panDrag) { _suppressNextClick = true; }
    _panDrag = null;
    if (_dragActive) {
      // Split wires at pin positions after drag-drop
      if (_dragComp) {
        const draggedComp = S.comps.find(c => c.id === _dragComp!.id);
        if (draggedComp) splitWiresAtPins(draggedComp);
      }
      pushHistory();
      _suppressNextClick = true;
    }
    _dragComp = null;
    _dragActive = false;
    _dragWireEnds = [];
    _dragMultiOrigComps = new Map();
    _dragMultiOrigWires = new Map();

    if (_boxDrag) {
      const bx1 = Math.min(_boxDrag.sx, _boxDrag.cx), by1 = Math.min(_boxDrag.sy, _boxDrag.cy);
      const bx2 = Math.max(_boxDrag.sx, _boxDrag.cx), by2 = Math.max(_boxDrag.sy, _boxDrag.cy);
      if (bx2 - bx1 > GRID || by2 - by1 > GRID) {
        S.selMulti = new Set(
          S.comps
            .filter(c => c.x >= bx1 && c.x <= bx2 && c.y >= by1 && c.y <= by2)
            .map(c => c.id)
        );
        S.selWireMulti = new Set(
          S.wires
            .filter(w =>
              w.x1 >= bx1 && w.x1 <= bx2 && w.y1 >= by1 && w.y1 <= by2 &&
              w.x2 >= bx1 && w.x2 <= bx2 && w.y2 >= by1 && w.y2 <= by2
            )
            .map(w => w.id)
        );
        S.sel = null; S.selWire = null;
        if (S.selMulti.size > 0) showProps(null);
        _suppressNextClick = true;
        render();
      }
      _boxDrag = null;
      selL.innerHTML = '';
    }
  });

  // ── Click ──
  svgEl.addEventListener('click', e => {
    if (e.button !== 0) return;
    if (_suppressNextClick) { _suppressNextClick = false; return; }
    const [wx, wy] = evToWorld(e);
    if (S.mode === 'place')       placeComp(wx, wy);
    // Fix 1: wire click uses pin-snapped coords
    else if (S.mode === 'wire')   wireClick(...snapToPin(wx, wy));
    else if (S.mode === 'label')  placeLabel(wx, wy);
    else if (S.mode === 'annot')   placeAnnot(wx, wy);
    else if (S.mode === 'bus')     busClick(wx, wy);
    else if (_placingDirective)   placeDirective(wx, wy);
    else                          selectAt(e, wx, wy);
  });

  // ── Double-click: inline edit value ──
  svgEl.addEventListener('dblclick', e => {
    let el = e.target as HTMLElement | null;
    while (el && el !== (svgEl as unknown as HTMLElement)) {
      if ((el as HTMLElement & { dataset: DOMStringMap }).dataset?.['cid']) {
        const cid = (el as HTMLElement & { dataset: DOMStringMap }).dataset['cid']!;
        const comp = S.comps.find(c => c.id === cid);
        if (comp) {
          S.sel = cid; showProps(comp); render();
          // Focus value input in panel
          const vi = propsBodyEl.querySelector<HTMLInputElement>('#pi-val');
          if (vi) { vi.focus(); vi.select(); }
          else {
            const ni = propsBodyEl.querySelector<HTMLInputElement>('#pi-name');
            if (ni) { ni.focus(); ni.select(); }
          }
        }
        return;
      }
      el = el.parentElement;
    }
  });

  // ── Double-click on annotation: edit text ──
  annotL.addEventListener('dblclick', e => {
    let el2 = e.target as HTMLElement | null;
    while (el2 && el2 !== (annotL as unknown as HTMLElement)) {
      const aid = (el2 as HTMLElement & { dataset: DOMStringMap }).dataset?.['aid'];
      if (aid) {
        const annot = S.annots.find(a => a.id === aid);
        if (annot) {
          const t = prompt('Edit annotation:', annot.text);
          if (t !== null && t.trim()) {
            pushHistory(); annot.text = t.trim(); render();
          }
        }
        return;
      }
      el2 = el2.parentElement;
    }
  });

  // ── Right click ──
  svgEl.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (S.mode === 'place') { S.placingRot = nextRot(S.placingRot); renderGhost(); }
    else if (S.mode === 'wire' && S.wireStart) { S.wireStart = null; ghostL.innerHTML = ''; }
  });

  // ── Wheel zoom ──
  svgEl.addEventListener('wheel', e => {
    e.preventDefault();
    const r  = svgEl.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const zOld = S.zoom;
    S.zoom *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
    S.zoom = Math.max(0.2, Math.min(4, S.zoom));
    S.pan.x = mx - (mx - S.pan.x) * (S.zoom / zOld);
    S.pan.y = my - (my - S.pan.y) * (S.zoom / zOld);
    pzEl.setAttribute('transform', `translate(${S.pan.x},${S.pan.y}) scale(${S.zoom})`);
  }, { passive: false });

  // ── Keyboard ──
  window.addEventListener('keydown', e => {
    if ((e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') { enterSelect(); return; }
    if (e.key === 'w' || e.key === 'W') { enterWire(); return; }
    if (e.key === 'n' || e.key === 'N') { enterLabel(); return; }
    if (e.key === 'd' || e.key === 'D') { enterDirective(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') &&
        (S.sel || S.selWire || S.selLabel || S.selDir || S.selMulti.size > 0)) { deleteSelected(); return; }
    // Copy
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      if (S.sel) {
        const c = S.comps.find(cc => cc.id === S.sel);
        if (c) clipboardCopy([{ ...c, extra: { ...c.extra } }]);
      } else if (S.selMulti.size > 0) {
        clipboardCopy(S.comps
          .filter(c => S.selMulti.has(c.id))
          .map(c => ({ ...c, extra: { ...c.extra } })));
      }
      return;
    }
    // Paste
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      clipboardPaste();
      if (_clipboard.length === 0) return;
      e.preventDefault();
      pushHistory();
      S.selMulti = new Set();
      S.sel = null;
      const offset = GRID * 2;
      for (const src of _clipboard) {
        const nc: Comp = { ...src, extra: { ...src.extra }, id: uid(),
          name: autoName(src.type), x: src.x + offset, y: src.y + offset };
        S.comps.push(nc);
        S.selMulti.add(nc.id);
      }
      markJunctionsDirty(); render(); return;
    }
    if (e.key === 'r' || e.key === 'R') {
      if (S.mode === 'place') { S.placingRot = nextRot(S.placingRot); renderGhost(); }
      else if (S.sel) {
        const c = S.comps.find(c => c.id === S.sel);
        if (c) { pushHistory(); c.rot = nextRot(c.rot); render(); showProps(c); }
      }
    }
    if (e.key === 'm' || e.key === 'M') {
      if (S.mode === 'place') { S.placingRot = toggleMirror(S.placingRot); renderGhost(); }
      else if (S.sel) {
        const c = S.comps.find(c => c.id === S.sel);
        if (c) { pushHistory(); c.rot = toggleMirror(c.rot); render(); showProps(c); }
      }
    }
  });
}

// ─── Place component ──────────────────────────────────────────────────────────

function placeComp(x: number, y: number): void {
  if (!S.placing) return;
  const comp: Comp = {
    id: uid(), type: S.placing,
    name: autoName(S.placing), value: defaultValue(S.placing),
    x, y, rot: S.placingRot, extra: {},
  };
  S.comps.push(comp);
  // Fix 2: split any wire that this component's pin lands on
  splitWiresAtPins(comp);
  markJunctionsDirty();
  pushHistory();
  render();
  renderGhost();
}

// ─── Wire click ───────────────────────────────────────────────────────────────

function wireClick(wx: number, wy: number): void {
  if (!S.wireStart) { S.wireStart = { x: wx, y: wy }; return; }
  const { x: sx, y: sy } = S.wireStart;
  if (sx === wx && sy === wy) { S.wireStart = null; ghostL.innerHTML = ''; return; }
  if (sx === wx || sy === wy) {
    S.wires.push({ id: uid(), x1: sx, y1: sy, x2: wx, y2: wy });
    markJunctionsDirty();
    pushHistory();
  } else {
    S.wires.push({ id: uid(), x1: sx, y1: sy, x2: wx, y2: sy });
    S.wires.push({ id: uid(), x1: wx, y1: sy, x2: wx, y2: wy });
    markJunctionsDirty();
    pushHistory();
  }
  S.wireStart = { x: wx, y: wy };
  render();
}

// ─── Place label ─────────────────────────────────────────────────────────────


function placeAnnot(wx: number, wy: number): void {
  const text = prompt('Annotation text:');
  if (!text || !text.trim()) return;
  pushHistory();
  S.annots.push({ id: uid(), x: snap(wx), y: snap(wy), text: text.trim(), fontSize: 12 });
  render();
}

function placeLabel(wx: number, wy: number): void {
  const name = prompt('Net name:', 'VCC') ?? '';
  if (!name.trim()) return;
  const label: NetLabel = { id: uid(), x: wx, y: wy, name: name.trim() };
  pushHistory();
  S.labels.push(label);
  render();
}

// ─── Directive placement & props ─────────────────────────────────────────────

function placeDirective(wx: number, wy: number): void {
  directiveModal((text) => {
    const dir: Directive = { id: uid(), x: wx, y: wy, text };
    pushHistory();
    S.directives.push(dir);
    _placingDirective = false;
    document.getElementById('sc-btn-dir')!.classList.remove('sc-active');
    svgEl.style.cursor = 'default';
    render();
  });
}

function showDirectiveProps(dir: Directive): void {
  propsBodyEl.innerHTML = `
<div class="sc-pr"><div class="sc-pl">SPICE Directive</div>
<textarea class="sc-pi" id="pi-dir-txt" rows="4" spellcheck="false">${dir.text}</textarea></div>
<div class="sc-pbs">
  <button class="sc-pbtn del" id="pi-del-dir">&#10005; Delete</button>
</div>`;
  const ta = propsBodyEl.querySelector<HTMLTextAreaElement>('#pi-dir-txt')!;
  ta.addEventListener('input', e => {
    dir.text = (e.target as HTMLTextAreaElement).value;
    render();
  });
  ta.addEventListener('change', () => pushHistory());
  ta.focus(); ta.select();
  propsBodyEl.querySelector<HTMLButtonElement>('#pi-del-dir')!
    .addEventListener('click', () => {
      pushHistory();
      S.directives = S.directives.filter(d => d.id !== dir.id);
      S.selDir = null; showProps(null); render();
    });
}

// ─── Select at click ──────────────────────────────────────────────────────────

function selectAt(e: MouseEvent, wx: number, wy: number): void {
  S.selMulti = new Set();

  // Check directive hit
  let el = e.target as HTMLElement | null;
  let did: string | null = null;
  while (el && el !== (svgEl as unknown as HTMLElement)) {
    if ((el as HTMLElement & { dataset: DOMStringMap }).dataset?.['did']) {
      did = (el as HTMLElement & { dataset: DOMStringMap }).dataset['did']!;
      break;
    }
    el = el.parentElement;
  }
  if (did) {
    const dir = S.directives.find(d => d.id === did);
    if (dir) {
      S.sel = null; S.selWire = null; S.selLabel = null;
      S.selDir = did === S.selDir ? null : did;
      if (S.selDir) showDirectiveProps(dir); else showProps(null);
      render(); return;
    }
  }

  // Check label hit
  let lid: string | null = null;
  el = e.target as HTMLElement | null;
  while (el && el !== (svgEl as unknown as HTMLElement)) {
    if ((el as HTMLElement & { dataset: DOMStringMap }).dataset?.['lid']) {
      lid = (el as HTMLElement & { dataset: DOMStringMap }).dataset['lid']!;
      break;
    }
    el = el.parentElement;
  }
  if (lid) {
    const label = S.labels.find(l => l.id === lid);
    if (label) {
      S.sel = null; S.selWire = null;
      S.selLabel = lid === S.selLabel ? null : lid;
      if (S.selLabel) showLabelProps(label); else showProps(null);
      render(); return;
    }
  }

  // Check comp hit
  el = e.target as HTMLElement | null;
  let found: string | null = null;
  while (el && el !== (svgEl as unknown as HTMLElement)) {
    if ((el as HTMLElement & { dataset: DOMStringMap }).dataset?.['cid']) {
      found = (el as HTMLElement & { dataset: DOMStringMap }).dataset['cid']!;
      break;
    }
    el = el.parentElement;
  }
  if (found) {
    S.selWire = null; S.selLabel = null;
    if (found === S.sel) { S.sel = null; showProps(null); }
    else { S.sel = found; showProps(S.comps.find(c => c.id === found) ?? null); }
    render(); return;
  }

  // Check wire hit
  const threshold = 6 / S.zoom;
  let hitWire: string | null = null;
  let bestDist = threshold;
  for (const w of S.wires) {
    const d = ptToSegDist(wx, wy, w.x1, w.y1, w.x2, w.y2);
    if (d < bestDist) { bestDist = d; hitWire = w.id; }
  }
  if (hitWire) {
    S.sel = null; S.selLabel = null;
    const wire = S.wires.find(w => w.id === hitWire)!;
    if (hitWire === S.selWire) { S.selWire = null; showProps(null); }
    else { S.selWire = hitWire; showWireProps(wire); }
    render(); return;
  }

  // Check annot hit
  let aid: string | null = null;
  el = e.target as HTMLElement | null;
  while (el && el !== (svgEl as unknown as HTMLElement)) {
    if ((el as HTMLElement & { dataset: DOMStringMap }).dataset?.['aid']) {
      aid = (el as HTMLElement & { dataset: DOMStringMap }).dataset['aid']!;
      break;
    }
    el = el.parentElement;
  }
  if (aid) {
    const annot = S.annots.find(a => a.id === aid);
    if (annot) {
      S.sel = null; S.selWire = null; S.selLabel = null; S.selDir = null;
      S.selAnnot = aid === S.selAnnot ? null : aid;
      render(); return;
    }
  }

  S.sel = null; S.selWire = null; S.selLabel = null; S.selAnnot = null; showProps(null);
  render();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initEditor(root: HTMLElement): void {
  S.comps = []; S.wires = []; S.junctions = []; S.labels = []; S.directives = []; S.annots = [];
  S.sel = null; S.selWire = null; S.selLabel = null; S.selDir = null; S.selAnnot = null; S.selMulti = new Set(); S.selWireMulti = new Set();
  S.mode = 'select'; S.placing = null; S.placingRot = 'R0';
  S.wireStart = null; S.mouse = { x: 0, y: 0 };
  S.pan = { x: 200, y: 200 }; S.zoom = 1;
  S.counters = {}; S.lastNet = '';
  _nid = 1; _suppressNextClick = false; _panDrag = null; _dragComp = null; _dragActive = false;
  _clipboard = []; _boxDrag = null; _placingDirective = false;
  _hist.length = 0; _histIdx = -1; _junctionsDirty = true;

  injectCSS();
  root.innerHTML = buildHTML();
  svgEl       = root.querySelector<SVGSVGElement>('#sc-canvas')!;
  pzEl        = root.querySelector<SVGGElement>('#sc-pz')!;
  compL       = root.querySelector<SVGGElement>('#sc-comps')!;
  wireL       = root.querySelector<SVGGElement>('#sc-wires')!;
  juncL       = root.querySelector<SVGGElement>('#sc-juncs')!;
  ghostL      = root.querySelector<SVGGElement>('#sc-ghost')!;
  selL        = root.querySelector<SVGGElement>('#sc-sel')!;
  statusEl    = root.querySelector<HTMLElement>('#sc-status')!;
  infoEl      = root.querySelector<HTMLElement>('#sc-info')!;
  netlistEl   = root.querySelector<HTMLElement>('#sc-netlist')!;
  propsBodyEl = root.querySelector<HTMLElement>('#sc-props-body')!;
  dlBtn       = root.querySelector<HTMLButtonElement>('#sc-dl')!;
  dlAscBtn    = root.querySelector<HTMLButtonElement>('#sc-dl-asc')!;
  hintEl      = root.querySelector<HTMLElement>('#sc-hint-txt')!;
  annotL      = root.querySelector<SVGGElement>('#sc-annots')!;
  titleBlockL = root.querySelector<SVGGElement>('#sc-titleblock')!;
  undoBtn     = root.querySelector<HTMLButtonElement>('#sc-btn-undo')!;
  redoBtn     = root.querySelector<HTMLButtonElement>('#sc-btn-redo')!;

  buildPalette(root.querySelector<HTMLElement>('#sc-palette')!);
  bindEvents(root);

  // Fix 4: restore saved schematic if present
  const restored = loadFromStorage();
  if (restored) { markJunctionsDirty(); }

  // Seed history with current state (empty or restored)
  _hist.push(cloneSnap());
  _histIdx = 0;
  updateUndoRedoBtns();

  render();

  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
    (window as unknown as Record<string, unknown>)['_SC'] = S;
    (window as unknown as Record<string, unknown>)['_SYMDEFS'] = SYMDEFS;
    (window as unknown as Record<string, unknown>)['_render'] = render;
    (window as unknown as Record<string, unknown>)['_generateNetlist'] = generateNetlist;
  }
}
