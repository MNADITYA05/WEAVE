/**
 * hit-test.ts — World-coordinate helpers: snap, wire split, auto-name, junction detection, distance
 */
import type { Comp } from './types.js';
import { SYMDEFS } from './schematic-symbols.js';
import { S, snap, PIN_SNAP_THRESHOLD, uid, markJunctionsDirty } from './state.js';
import { rotPt, getEffectivePins } from './rotation.js';
import { onSeg } from '../shared/geometry.js';

// ─── SVG element ref (set by initEditor) ─────────────────────────────────────

let _svgEl: SVGSVGElement;
export function setHitTestSvgEl(el: SVGSVGElement): void { _svgEl = el; }

// ─── World ↔ screen ───────────────────────────────────────────────────────────

export function evToWorld(e: MouseEvent): [number, number] {
  const r = _svgEl.getBoundingClientRect();
  return [snap((e.clientX - r.left - S.pan.x) / S.zoom),
          snap((e.clientY - r.top  - S.pan.y) / S.zoom)];
}

// ─── Snap-to-pin ──────────────────────────────────────────────────────────────

export function snapToPin(wx: number, wy: number): [number, number] {
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

// ─── Wire split on component drop ─────────────────────────────────────────────

export function splitWiresAtPins(comp: Comp): void {
  const pins = getEffectivePins(comp);
  if (pins.length === 0) return;
  const toRemove = new Set<string>();
  const toAdd: import('./types.js').Wire[] = [];
  for (const p of pins) {
    const [rpx, rpy] = rotPt(p, comp.rot);
    const px = comp.x + rpx, py = comp.y + rpy;
    for (const w of S.wires) {
      if (toRemove.has(w.id)) continue;
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

export function autoName(type: string): string {
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

export function defaultValue(type: string): string {
  const map: Record<string, string> = {
    R:'1k', C:'1n', L:'1u', V:'5', I:'1m', D:'1N4148',
    Q_NPN:'2N3904', Q_PNP:'2N3906', M_NMOS:'NMOS', M_PMOS:'PMOS',
    J_N:'J2N3819', J_P:'J2N3819', B:'V=0', K:'1', T:'Td=1n Z0=50',
    E:'1', G:'1', F:'1', H:'1',
    S:'SWITMOD', W:'SWITMOD',
    X:'SUBCKT', GND:'0', VDD:'VDD', VCC:'VCC', VSS:'VSS',
  };
  return map[type] ?? '?';
}

// ─── Junction detection ───────────────────────────────────────────────────────

export function computeEditorJunctions(): void {
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

// ─── Wire hit distance ────────────────────────────────────────────────────────

export function ptToSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
