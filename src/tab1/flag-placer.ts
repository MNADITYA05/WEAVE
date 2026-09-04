/**
 * flag-placer.ts — Hang-shunt placement and cross-net contact guard for router.ts.
 *
 * Exported functions:
 *   placeHangShunts — place components that hang off a rail/gnd net
 *   crossNetGuard   — detect and bump wires that cross-contact foreign nets
 */

import { GRID, snap, rot, rotBBox } from '../shared/geometry.js';
import { SYMBOLS } from './symbols.js';
import { isFlag } from './classifier.js';
import type { Point, BBox, RotCode, NetClassMap } from '../types.js';
import { type WorkComp, type WSeg, ptOnSeg, segRectHit, segSegTouch } from './route-types.js';
import { RoutingError } from '../errors.js';

// ─── placeHangShunts ─────────────────────────────────────────────────────────

/**
 * For each component marked isHang, places it either on a horizontal bus run
 * of its hangNet (shunt style) or directly above/below a component tip
 * (pull-up style), then emits the stub wire connecting it.
 */
export function placeHangShunts(
  comps:    WorkComp[],
  opamps:   WorkComp[],
  cls:      NetClassMap,
  wires:    WSeg[],
  allSegsF: () => WSeg[],
): void {
  const tipUse = new Map<string, number>();

  for (const c of comps.filter(c => c.isHang)) {
    const bus    = allSegsF().filter(w => w[4] === c.hangNet && w[1] === w[3] && Math.abs(w[2] - w[0]) >= GRID);
    const maxRun = bus.reduce((m, w) => Math.max(m, Math.abs(w[2] - w[0])), 0);

    if (!bus.length || maxRun < 48) {
      // ── Pull-up style: place directly off a component tip ─────────────────
      const o  = comps.find(o => o.inGraph && o.nets.includes(c.hangNet!));
      if (!o) throw new RoutingError(`${c.name}: net ${c.hangNet} has no placed partner`);
      const i      = o.nets.indexOf(c.hangNet!);
      const tip    = o.tips![i]!;
      let dir: Point = o.esc[i] ?? [0, -1];
      if (dir[0] === 0) {
        const vNet = allSegsF().filter(w => w[4] === c.hangNet && w[0] === w[2] && w[0] === tip[0]);
        if (vNet.length) {
          const flagApproxY = tip[1] + dir[1] * 96;
          if (vNet.some(w => Math.min(w[1], w[3]) <= flagApproxY && flagApproxY <= Math.max(w[1], w[3])))
            dir = [1, 0];
        }
      }
      const tk = `${tip[0]},${tip[1]}`;
      tipUse.set(tk, (tipUse.get(tk) ?? 0) + 1);
      const k      = tipUse.get(tk)! - 1;
      const sigIdx = c.nets.findIndex(n => n === c.hangNet);
      // choose rotation based on escape direction and pin order
      {
        let rotc: RotCode;
        if      (dir[1] === -1) rotc = (sigIdx === 0) ? 'R180' : 'R0';
        else if (dir[1] ===  1) rotc = (sigIdx === 0) ? 'R0'   : 'R180';
        else if (dir[0] ===  1) rotc = (sigIdx === 0) ? 'R270' : 'R90';
        else                    rotc = (sigIdx === 0) ? 'R90'  : 'R270';
        c.rot   = rotc;
        const S = SYMBOLS[c.sym]!;
        c.rpins = S.pins.map(p => rot(p, c.rot));
        c.rbb   = rotBBox(S.bbox, c.rot);
        for (const p of c.rpins) {
          c.rbb[0] = Math.min(c.rbb[0], p[0]); c.rbb[1] = Math.min(c.rbb[1], p[1]);
          c.rbb[2] = Math.max(c.rbb[2], p[0]); c.rbb[3] = Math.max(c.rbb[3], p[1]);
        }
      }
      const usedOrgF = new Set(comps.filter(o2 => o2.origin && o2 !== c)
        .map(o2 => `${o2.origin![0]},${o2.origin![1]}`));
      const landing = (b: Point): string => {
        const pp: Point = [b[0] + dir[0] * GRID, b[1] + dir[1] * GRID];
        return `${pp[0] - c.rpins[sigIdx]![0]},${pp[1] - c.rpins[sigIdx]![1]}`;
      };
      const others = allSegsF().filter(w => w[4] !== c.hangNet);
      const bodies = comps.filter(o2 => o2.origin && o2 !== c && o2 !== o).map(o2 => {
        const r = rotBBox(SYMBOLS[o2.sym]!.bbox, o2.rot);
        return [o2.origin![0] + r[0], o2.origin![1] + r[1], o2.origin![0] + r[2], o2.origin![1] + r[3]] as BBox;
      });
      const clean = (b: Point): boolean => {
        const seg: WSeg = [tip[0], tip[1], b[0], b[1]];
        if (others.some(w => segSegTouch(seg, w))) return false;
        if (bodies.some(r => segRectHit(seg, r))) return false;
        if (usedOrgF.has(landing(b))) return false;
        return true;
      };
      let base: Point | null = null;
      let kk = k;
      for (let step = 0; step < 10 && base === null; step++, kk++) {
        if (kk === 0) {
          const b0: Point = [tip[0], tip[1]];
          if (!usedOrgF.has(landing(b0))) base = b0;
          continue;
        }
        const cand: Point[] = [
          [tip[0] - dir[1] * kk * 96, tip[1] + dir[0] * kk * 96],
          [tip[0] + dir[1] * kk * 96, tip[1] - dir[0] * kk * 96],
          [tip[0] + dir[0] * kk * 112, tip[1] + dir[1] * kk * 112],
        ];
        base = cand.find(clean) ?? cand.find(b => !usedOrgF.has(landing(b))) ?? null;
      }
      if (base === null) base = [tip[0], tip[1]];
      const kEff   = (base[0] === tip[0] && base[1] === tip[1]) ? 0 : 1;
      const pinPt: Point = [base[0] + dir[0] * GRID, base[1] + dir[1] * GRID];
      c.origin = [pinPt[0] - c.rpins[sigIdx]![0], pinPt[1] - c.rpins[sigIdx]![1]];
      c.abs    = c.rpins.map(p => [c.origin![0] + p[0], c.origin![1] + p[1]] as Point);
      c.x      = c.origin[0] + c.rbb[0];
      c.y      = c.origin[1] + c.rbb[1];
      c.flagDir = c.nets.map((n, i2) => i2 === sigIdx ? null : dir as Point);
      if (kEff > 0) wires.push([tip[0], tip[1], base[0], base[1], c.hangNet!]);
      wires.push([base[0], base[1], pinPt[0], pinPt[1], c.hangNet!]);
      continue;
    }

    // ── Shunt style: place on a horizontal bus run ─────────────────────────
    const sigIdx   = c.nets.findIndex(n => n === c.hangNet);
    const flagIdx2 = c.nets.findIndex(n => isFlag(cls.get(n)));
    const dirSign  = cls.get(c.nets[flagIdx2]!) === 'rail' ? -1 : 1;
    const oxs      = opamps.filter(u => u.origin).map(u => u.origin![0]);

    if (dirSign < 0) {
      c.rot = c.rot === 'R0' ? 'R180' : c.rot === 'R180' ? 'R0' : c.rot;
      const S = SYMBOLS[c.sym]!;
      c.rpins = S.pins.map(p => rot(p, c.rot));
      c.rbb   = rotBBox(S.bbox, c.rot);
      for (const p of c.rpins) {
        c.rbb[0] = Math.min(c.rbb[0], p[0]); c.rbb[1] = Math.min(c.rbb[1], p[1]);
        c.rbb[2] = Math.max(c.rbb[2], p[0]); c.rbb[3] = Math.max(c.rbb[3], p[1]);
      }
      c.flagDir = c.nets.map((n, i2) => i2 === flagIdx2 ? [0, -1] as Point : null);
    }

    const cands: Array<[number, number, WSeg]> = [];
    for (const B of bus) {
      const xl = Math.min(B[0], B[2]), xr = Math.max(B[0], B[2]);
      for (const x of new Set([
        snap((xl + xr) / 2),
        snap(xl + (xr - xl) * 0.25),
        snap(xl + (xr - xl) * 0.75),
        xl + GRID > xr ? xl : xl + GRID,
        xr - GRID < xl ? xr : xr - GRID,
      ])) {
        if (x >= xl && x <= xr) cands.push([x, B[1], B]);
      }
    }
    cands.sort((a, b) => {
      const da = Math.min(...oxs.map(o => Math.abs(a[0] - o)), 1e9);
      const db = Math.min(...oxs.map(o => Math.abs(b[0] - o)), 1e9);
      return db - da;
    });

    const placed = comps.filter(o => o.origin && o !== c);
    let done = false;

    for (const [x, y0, B] of cands) {
      const topPin: Point = [x, y0 + dirSign * GRID];
      const origin: Point = [topPin[0] - c.rpins[sigIdx]![0], topPin[1] - c.rpins[sigIdx]![1]];
      const oy2 = origin[1] + c.rbb[3];
      const rect: BBox = [
        origin[0] + c.rbb[0] - GRID,
        dirSign > 0 ? y0 + 1 : origin[1] + c.rbb[1] - GRID,
        origin[0] + c.rbb[2] + GRID,
        dirSign > 0 ? oy2 + GRID : y0 - 1,
      ];
      const drop: WSeg = [x, y0, x, y0 + dirSign * GRID];
      const fy   = origin[1] + c.rpins[flagIdx2]![1];
      const fey  = fy + dirSign * 32;
      const fpx  = origin[0] + c.rpins[flagIdx2]![0];
      const clash =
        allSegsF().some(w =>
          !(w[0] === B[0] && w[1] === B[1] && w[2] === B[2] && w[3] === B[3]) &&
          (segRectHit(w, rect) || segSegTouch(w, drop))
        ) ||
        allSegsF().some(w => w[4] === c.hangNet && w[0] === w[2] && w[0] === x &&
          Math.min(w[1], w[3]) <= fy && fy <= Math.max(w[1], w[3])) ||
        allSegsF().some(w =>
          w[4] !== c.hangNet && !(w[4] ?? '').startsWith('FLAG:') && ptOnSeg([fpx, fey], w)
        ) ||
        placed.some(o => {
          const R: BBox = [o.origin![0] + o.rbb[0], o.origin![1] + o.rbb[1], o.origin![0] + o.rbb[2], o.origin![1] + o.rbb[3]];
          return !(R[2] < rect[0] || R[0] > rect[2] || R[3] < rect[1] || R[1] > rect[3]);
        });
      if (clash) continue;
      c.origin = origin;
      c.abs    = c.rpins.map(p => [origin[0] + p[0], origin[1] + p[1]] as Point);
      c.x      = origin[0] + c.rbb[0];
      c.y      = origin[1] + c.rbb[1];
      wires.push([x, y0, x, y0 + dirSign * GRID, c.hangNet!]);
      done = true; break;
    }

    if (!done) {
      const usedOrg = new Set(comps.filter(o => o.origin && o !== c).map(o => `${o.origin![0]},${o.origin![1]}`));
      const ext: Array<[number, number, WSeg]> = [...cands];
      for (const B of bus) {
        const xl = Math.min(B[0], B[2]), xr = Math.max(B[0], B[2]);
        for (let x = xl; x <= xr; x += 6 * GRID) ext.push([x, B[1], B]);
      }
      let pick: [number, number, Point] | null = null;
      for (const [x, y0] of ext) {
        const tp: Point  = [x, y0 + dirSign * GRID];
        const org: Point = [tp[0] - c.rpins[sigIdx]![0], tp[1] - c.rpins[sigIdx]![1]];
        if (!usedOrg.has(`${org[0]},${org[1]}`)) {
          const fy2  = org[1] + c.rpins[flagIdx2]![1];
          const fey2 = fy2 + dirSign * 32;
          const fpx2 = org[0] + c.rpins[flagIdx2]![0];
          const vertOk = !allSegsF().some(w =>
            w[4] === c.hangNet && w[0] === w[2] && w[0] === x &&
            Math.min(w[1], w[3]) <= fy2 && fy2 <= Math.max(w[1], w[3])
          );
          const flagOk = !allSegsF().some(w =>
            w[4] !== c.hangNet && !(w[4] ?? '').startsWith('FLAG:') && ptOnSeg([fpx2, fey2], w)
          );
          if (vertOk && flagOk) { pick = [x, y0, org]; break; }
        }
      }
      if (!pick) {
        const [x, y0] = cands[0]!;
        const tp: Point = [x, y0 + dirSign * GRID];
        pick = [x, y0, [tp[0] - c.rpins[sigIdx]![0], tp[1] - c.rpins[sigIdx]![1]]];
      }
      const [x, y0, org] = pick;
      c.origin = org;
      c.abs    = c.rpins.map(p => [c.origin![0] + p[0], c.origin![1] + p[1]] as Point);
      c.x      = c.origin[0] + c.rbb[0];
      c.y      = c.origin[1] + c.rbb[1];
      wires.push([x, y0, x, y0 + dirSign * GRID, c.hangNet!]);
    }
  }
}

// ─── crossNetGuard ───────────────────────────────────────────────────────────

/**
 * Iterates committed wires looking for cross-net contacts (T-intersections or
 * collinear overlaps between segments of different nets). For each contact,
 * attempts to bump one wire sideways by up to ±3 GRID increments. Runs up to
 * 24 rounds until no contacts remain.
 */
export function crossNetGuard(wires: WSeg[]): void {
  const isV       = (w: WSeg): boolean => w[0] === w[2];
  const inInt     = (x: number, y: number, w: WSeg): boolean => {
    if ((x === w[0] && y === w[1]) || (x === w[2] && y === w[3])) return false;
    if (isV(w)) return x === w[0] && y > Math.min(w[1], w[3]) && y < Math.max(w[1], w[3]);
    if (w[1] === w[3]) return y === w[1] && x > Math.min(w[0], w[2]) && x < Math.max(w[0], w[2]);
    return false;
  };
  const colOverlap = (a: WSeg, b: WSeg): WSeg | null => {
    if (isV(a) && isV(b) && a[0] === b[0]) {
      const lo = Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3]));
      const hi = Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3]));
      if (lo < hi) return [a[0], lo, a[0], hi];
    }
    if (!isV(a) && !isV(b) && a[1] === b[1] && a[1] === b[3]) {
      const lo = Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2]));
      const hi = Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2]));
      if (lo < hi) return [lo, a[1], hi, a[1]];
    }
    return null;
  };
  const anyContact = (seg: WSeg, net: string): boolean =>
    wires.some(w => {
      if ((w[4] ?? '') === net) return false;
      if (colOverlap(seg, w)) return true;
      if (inInt(w[0], w[1], seg) || inInt(w[2], w[3], seg)) return true;
      if (inInt(seg[0], seg[1], w) || inInt(seg[2], seg[3], w)) return true;
      return false;
    });

  const bump = (idx: number, lo: number, hi: number, off: number): boolean => {
    const w   = wires[idx]!;
    const net = w[4] ?? '';
    const m   = GRID;
    if (isV(w)) {
      const x  = w[0], y1 = Math.min(w[1], w[3]), y2 = Math.max(w[1], w[3]);
      const a  = Math.max(y1, lo - m), b = Math.min(y2, hi + m);
      const nx = x + off;
      const parts: WSeg[] = [[x, y1, x, a, net], [x, a, nx, a, net], [nx, a, nx, b, net], [nx, b, x, b, net], [x, b, x, y2, net]];
      if (!parts.slice(1, 4).every(g => !anyContact(g, net))) return false;
      wires.splice(idx, 1, ...parts.filter(g => g[0] !== g[2] || g[1] !== g[3]));
      return true;
    } else {
      const y  = w[1], x1 = Math.min(w[0], w[2]), x2 = Math.max(w[0], w[2]);
      const a  = Math.max(x1, lo - m), b = Math.min(x2, hi + m);
      const ny = y + off;
      const parts: WSeg[] = [[x1, y, a, y, net], [a, y, a, ny, net], [a, ny, b, ny, net], [b, ny, b, y, net], [b, y, x2, y, net]];
      if (!parts.slice(1, 4).every(g => !anyContact(g, net))) return false;
      wires.splice(idx, 1, ...parts.filter(g => g[0] !== g[2] || g[1] !== g[3]));
      return true;
    }
  };

  for (let round = 0; round < 24; round++) {
    let fixed = false;
    outer:
    for (let i = 0; i < wires.length; i++) {
      for (let j = 0; j < wires.length; j++) {
        if (i === j) continue;
        const A = wires[i]!, B = wires[j]!;
        const ka = A[4] ?? '', kb = B[4] ?? '';
        if (ka === kb || !ka || !kb) continue;
        const ov = colOverlap(A, B);
        let lo: number, hi: number;
        const vert = isV(A);
        if (ov) { lo = vert ? ov[1] : ov[0]; hi = vert ? ov[3] : ov[2]; }
        else {
          let pt: [number, number] | null = null;
          if (inInt(B[0], B[1], A)) pt = [B[0], B[1]];
          else if (inInt(B[2], B[3], A)) pt = [B[2], B[3]];
          if (!pt) continue;
          lo = hi = vert ? pt[1] : pt[0];
        }
        for (const off of [GRID, -GRID, 2 * GRID, -2 * GRID, 3 * GRID, -3 * GRID]) {
          if (bump(i, lo, hi, off)) { fixed = true; break outer; }
        }
        {
          const vert2 = isV(B);
          let lo2 = lo, hi2 = hi;
          if (!ov) {
            let pt: [number, number] | null = null;
            if (inInt(A[0], A[1], B)) pt = [A[0], A[1]];
            else if (inInt(A[2], A[3], B)) pt = [A[2], A[3]];
            if (pt) { lo2 = hi2 = vert2 ? pt[1] : pt[0]; }
            else {
              lo2 = vert2 ? Math.min(B[1], B[3]) : Math.min(B[0], B[2]);
              hi2 = vert2 ? Math.max(B[1], B[3]) : Math.max(B[0], B[2]);
            }
          }
          for (const off of [GRID, -GRID, 2 * GRID, -2 * GRID, 3 * GRID, -3 * GRID]) {
            if (bump(j, lo2, hi2, off)) { fixed = true; break outer; }
          }
        }
      }
    }
    if (!fixed) break;
  }
}

