/**
 * canvas-render.ts — SVG render, ghost preview, zoom-to-fit, title block
 */
import type { SymDef } from './schematic-symbols.js';
import { SYMDEFS, IC_SYMDEFS, makeIcSymDef } from './schematic-symbols.js';
import { S, _junctionsDirty, clearJunctionsDirty } from './state.js';
import { getEffectivePins, svgTransform } from './rotation.js';
import { computeEditorJunctions, snapToPin } from './hit-test.js';

// ─── DOM layer refs (set by initEditor) ───────────────────────────────────────

let pzEl:      SVGGElement;
let wireL:     SVGGElement;
let compL:     SVGGElement;
let juncL:     SVGGElement;
let selL:      SVGGElement;
let ghostL:    SVGGElement;
let annotL:    SVGGElement;
let infoEl:    HTMLElement;
let titleBlockL: SVGGElement;
let svgEl:     SVGSVGElement;

export function setRenderLayers(layers: {
  pzEl: SVGGElement; wireL: SVGGElement; compL: SVGGElement;
  juncL: SVGGElement; selL: SVGGElement; ghostL: SVGGElement;
  annotL: SVGGElement; infoEl: HTMLElement; titleBlockL: SVGGElement;
  svgEl: SVGSVGElement;
}): void {
  pzEl = layers.pzEl; wireL = layers.wireL; compL = layers.compL;
  juncL = layers.juncL; selL = layers.selL; ghostL = layers.ghostL;
  annotL = layers.annotL; infoEl = layers.infoEl;
  titleBlockL = layers.titleBlockL; svgEl = layers.svgEl;
}

// ─── Main render ──────────────────────────────────────────────────────────────

export function render(): void {
  pzEl.setAttribute('transform', `translate(${S.pan.x},${S.pan.y}) scale(${S.zoom})`);

  if (_junctionsDirty) {
    computeEditorJunctions();
    clearJunctionsDirty();
  }

  wireL.innerHTML = S.wires.map(w => {
    const isSel   = w.id === S.selWire;
    const isMulti = S.selWireMulti.has(w.id);
    const isBus   = !!w.bus;
    const stroke  = isSel ? '#1a7fd4' : isMulti ? '#ff9900' : isBus ? '#336699' : '#1a1a1a';
    const sw      = isSel ? 3 : isMulti ? 3 : isBus ? 4 : 2;
    return `<line id="scw-${w.id}" data-wid="${w.id}"
     x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}"
     stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" style="cursor:default"/>`;
  }).join('');

  let csvg = '';
  for (const c of S.comps) {
    const def: SymDef | undefined = SYMDEFS[c.type] ?? (c.type.startsWith('IC:') ? (IC_SYMDEFS.get(c.type) ?? makeIcSymDef(c.type.slice(3)) ?? undefined) : undefined);
    if (!def) continue;
    const isSel  = c.id === S.sel;
    const stroke = isSel ? '#1a7fd4' : '#1a1a1a';
    const pins   = getEffectivePins(c);
    const isIC   = c.type.startsWith('IC:');
    const selPad = isIC ? 8 : 6;
    const selMinX = isIC ? Math.min(...def.pins.map(p => p[0])) - selPad : -38;
    const selMinY = isIC ? Math.min(...def.pins.map(p => p[1])) - selPad : -44;
    const selW    = isIC ? Math.max(...def.pins.map(p => p[0])) - selMinX + selPad : 76;
    const selH    = isIC ? Math.max(...def.pins.map(p => p[1])) - selMinY + selPad : 88;
    csvg += `<g id="scc-${c.id}" data-cid="${c.id}" transform="translate(${c.x},${c.y}) ${svgTransform(c.rot)}" style="cursor:pointer">`;
    if (isSel) csvg += `<rect x="${selMinX}" y="${selMinY}" width="${selW}" height="${selH}" fill="#1a7fd440" stroke="#1a7fd4" stroke-width="1" rx="3" stroke-dasharray="4,2"/>`;
    csvg += `<g stroke="${stroke}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" color="${stroke}">`;
    csvg += def.svg;
    csvg += '</g>';
    if (def.refOffset && c.name)  csvg += `<text x="${def.refOffset[0]}" y="${def.refOffset[1]}" font-size="11" fill="${stroke}" font-family="monospace" style="user-select:none">${c.name}</text>`;
    if (def.valOffset && c.value) csvg += `<text x="${def.valOffset[0]}" y="${def.valOffset[1]}" font-size="10" fill="#666" font-family="monospace" style="user-select:none">${c.value}</text>`;
    for (const [px, py] of pins) csvg += `<circle cx="${px}" cy="${py}" r="2.5" fill="${isSel ? '#1a7fd4' : '#888'}" stroke="none"/>`;
    csvg += `<rect x="${selMinX}" y="${selMinY}" width="${selW}" height="${selH}" fill="transparent"/>`;
    csvg += '</g>';
  }
  compL.innerHTML = csvg;

  juncL.innerHTML = S.junctions.map(j => `<circle cx="${j.x}" cy="${j.y}" r="4" fill="#1a1a1a"/>`).join('');

  const labelSvg = S.labels.map(l => {
    const isSel  = l.id === S.selLabel;
    const stroke = isSel ? '#ff9900' : '#1a7fd4';
    const pad = 4, charW = 7.5, h = 16;
    const w = l.name.length * charW + pad * 2;
    return `<g data-lid="${l.id}" style="cursor:pointer">
<rect x="${l.x}" y="${l.y - h / 2}" width="${w}" height="${h}" fill="#1e2030" stroke="${stroke}" stroke-width="1" rx="2"/>
<line x1="${l.x}" y1="${l.y}" x2="${l.x - 8}" y2="${l.y}" stroke="${stroke}" stroke-width="1.5"/>
<text x="${l.x + pad}" y="${l.y}" class="sc-netlabel" fill="${stroke}">${l.name}</text>
</g>`;
  }).join('');
  juncL.innerHTML += labelSvg;

  let multiSelSvg = '';
  for (const id of S.selMulti) {
    const c = S.comps.find(cc => cc.id === id);
    if (c) multiSelSvg += `<rect x="${c.x - 38}" y="${c.y - 44}" width="76" height="88" fill="none" stroke="#ff9900" stroke-width="1.5" stroke-dasharray="4,2" rx="3" transform="${svgTransform(c.rot).replace('matrix', 'translate(' + c.x + ',' + c.y + ') matrix').slice(0, -1)}"/>`;
  }
  selL.innerHTML = multiSelSvg;

  const dirSvg = S.directives.map(d => {
    const isSel  = d.id === S.selDir;
    const lines  = d.text.split('\n');
    const lineH  = 14, pad = 5;
    const maxLen = Math.max(...lines.map(l => l.length));
    const bw = maxLen * 7.3 + pad * 2, bh = lines.length * lineH + pad * 2;
    const stroke = isSel ? '#ff9900' : '#4ec9b0';
    const textLines = lines.map((l, i) =>
      `<tspan x="${d.x + pad}" dy="${i === 0 ? 0 : lineH}">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</tspan>`
    ).join('');
    return `<g data-did="${d.id}" style="cursor:pointer">
<rect x="${d.x}" y="${d.y}" width="${bw}" height="${bh}" fill="#0d1117" stroke="${stroke}" stroke-width="${isSel ? 1.5 : 1}" rx="2" opacity="0.9"/>
<text x="${d.x + pad}" y="${d.y + pad + 11}" class="sc-directive" fill="${stroke}">${textLines}</text>
</g>`;
  }).join('');
  juncL.innerHTML += dirSvg;

  annotL.innerHTML = S.annots.map(a => {
    const isSel  = a.id === S.selAnnot;
    const lines  = a.text.split('\n');
    const lineH  = a.fontSize + 4;
    const escText = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const tspans = lines.map((l, i) =>
      `<tspan x="${a.x}" dy="${i === 0 ? 0 : lineH}">${escText(l)}</tspan>`
    ).join('');
    return `<g data-aid="${a.id}" style="cursor:pointer">
${isSel ? `<rect x="${a.x - 2}" y="${a.y - a.fontSize - 2}" width="${Math.max(...lines.map(l => l.length)) * a.fontSize * 0.62 + 4}" height="${lines.length * lineH + 4}" fill="none" stroke="#ff9900" stroke-width="1" stroke-dasharray="3,2" rx="2"/>` : ''}
<text x="${a.x}" y="${a.y}" class="sc-annot-text" font-size="${a.fontSize}" fill="${isSel ? '#ff9900' : '#e0e0e0'}">${tspans}</text>
</g>`;
  }).join('');

  if (S.mode !== 'place' && S.mode !== 'label' && S.mode !== 'annot' && S.mode !== 'bus') ghostL.innerHTML = '';
  renderTitleBlock();
  infoEl.textContent = `${S.comps.filter(c => !SYMDEFS[c.type]?.netName).length} comp · ${S.wires.length} wire · ${S.labels.length} label · ${S.directives.length} dir`;
}

// ─── Ghost (placement preview) ────────────────────────────────────────────────

export function renderGhost(): void {
  if (S.mode !== 'place' || !S.placing) { ghostL.innerHTML = ''; return; }
  const def: SymDef | undefined = SYMDEFS[S.placing] ?? (S.placing.startsWith('IC:') ? (IC_SYMDEFS.get(S.placing) ?? makeIcSymDef(S.placing.slice(3)) ?? undefined) : undefined);
  if (!def) return;
  const { x, y } = S.mouse;
  const previewPins = def.pins;
  ghostL.innerHTML = `<g transform="translate(${x},${y}) ${svgTransform(S.placingRot)}" opacity="0.55">
<g stroke="#1a7fd4" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" color="#1a7fd4">
${def.svg}</g>
${previewPins.map(([px, py]) => `<circle cx="${px}" cy="${py}" r="3" fill="#1a7fd4" stroke="none"/>`).join('')}
</g>`;
}

// ─── Wire preview ─────────────────────────────────────────────────────────────

export function renderWirePreview(wx: number, wy: number): void {
  const [sx2, sy2] = snapToPin(wx, wy);
  const snapped = sx2 !== wx || sy2 !== wy;
  let snapDot = '';
  if (snapped) snapDot = `<circle cx="${sx2}" cy="${sy2}" r="5" class="sc-pin-snap"/>`;
  if (!S.wireStart) { ghostL.innerHTML = snapDot; return; }
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

// ─── Bus preview ──────────────────────────────────────────────────────────────

export function renderBusPreview(wx: number, wy: number): void {
  if (!S.wireStart) return;
  const { x: sx, y: sy } = S.wireStart;
  ghostL.innerHTML = `<line x1="${sx}" y1="${sy}" x2="${wx}" y2="${wy}" stroke="#336699" stroke-width="4" stroke-linecap="round" opacity="0.7"/>`;
}

// ─── Zoom to fit ──────────────────────────────────────────────────────────────

export function zoomToFit(): void {
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

// ─── Title block ──────────────────────────────────────────────────────────────

export function renderTitleBlock(): void {
  if (!titleBlockL) return;
  if (!S.titleBlock.visible) { titleBlockL.innerHTML = ''; return; }
  const tb = S.titleBlock;
  const W = 400, H = 100, margin = 20;
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

export function getGhostLayer(): SVGGElement { return ghostL; }
