/**
 * apply-layout.ts — Stage 7: map ELK layout output onto PlacedComponent positions.
 *
 * applyLayout()     — Stamps x/y/origin/abs/tips onto each AnnotatedComponent from
 *                     ELK's output nodes, then nudges opamps and their series feeders
 *                     so tips align on the same horizontal grid line.
 *
 * Pure data transform: mutates the AnnotatedComponent objects in-place
 * (they are our own freshly-created objects, not the original parsed input).
 */

import { GRID, snap } from '../shared/geometry.js';
import type { AnnotatedComponent, Point } from '../types.js';

// ─── ElkOutputNode (minimal shape we read from ELK's layout result) ──────────

interface ElkOutputNode {
  id:  string;
  x?:  number;
  y?:  number;
}

interface ElkOutputEdge {
  sources: string[];
  targets: string[];
}

interface ElkLayoutOutput {
  children?: ElkOutputNode[];
  edges?:    ElkOutputEdge[];
}

// ─── applyLayout ─────────────────────────────────────────────────────────────

/**
 * Stamps absolute positions from ELK output onto annotated components.
 * Runs two post-passes to nudge opamps and series feeders into alignment.
 *
 * @param annotated - The AnnotatedComponent array (mutated in place)
 * @param opamps    - The subset of annotated that are opamps
 * @param out       - ELK layout output (children + edges)
 */
export function applyLayout(
  annotated: AnnotatedComponent[],
  opamps:    AnnotatedComponent[],
  out:       ElkLayoutOutput,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Mutable = any;
  const byName = new Map(annotated.map(c => [c.name, c]));

  // ── Stamp x/y/origin/abs/tips from ELK nodes ─────────────────────────────
  for (const n of out.children ?? []) {
    const c = byName.get(n.id) as Mutable;
    if (!c) continue;
    c.x = snap(n.x ?? 0);
    c.y = snap(n.y ?? 0);
    c.origin = [c.x - c.rbb[0], c.y - c.rbb[1]];
    c.abs  = (c.rpins  as Point[]).map(p => [c.origin[0] + p[0], c.origin[1] + p[1]]);
    c.tips = (c.rtips  as Point[]).map(p => [c.origin[0] + p[0], c.origin[1] + p[1]]);
  }

  // ── Nudge opamps to align with their series feeder elements ──────────────
  for (const u of opamps.filter(u => u.inGraph)) {
    for (const inIdx of [1, 0]) {
      const uc = u as Mutable;
      const pid = u.name + '.p' + inIdx;
      const e = (out.edges ?? []).find(e => (e.targets[0] ?? '') === pid);
      if (!e) continue;
      const src0 = e.sources[0] ?? '';
      const src = annotated.find(c => c.inGraph && src0.startsWith(c.name + '.p'));
      if (!src || src.nets.length !== 2) continue;
      const si = +(src0.split('.p')[1] ?? '0');
      const sc = src as Mutable;
      const scTip = (sc.tips as Point[])[si];
      const ucTip = (uc.tips as Point[])[inIdx];
      if (!scTip || !ucTip) continue;
      const delta = scTip[1] - ucTip[1];
      if (delta !== 0 && Math.abs(delta) <= 32 && delta % GRID === 0) {
        uc.y += delta;
        uc.origin = [uc.x - uc.rbb[0], uc.y - uc.rbb[1]];
        uc.abs  = (uc.rpins  as Point[]).map((p: Point) => [uc.origin[0] + p[0], uc.origin[1] + p[1]]);
        uc.tips = (uc.rtips  as Point[]).map((p: Point) => [uc.origin[0] + p[0], uc.origin[1] + p[1]]);
      }
      break;
    }
  }

  // ── Nudge series elements feeding opamp inputs to align on the same row ──
  for (const u of opamps.filter(u => u.inGraph)) {
    for (const inIdx of [0, 1]) {
      const uc = u as Mutable;
      if (!uc.tips?.[inIdx]) continue;
      const inTip = (uc.tips as Point[])[inIdx]!;
      const partner = annotated.find(c =>
        c.inGraph && c.nets.length === 2 && !c.isOp &&
        c.nets.includes(u.nets[inIdx] ?? ''),
      );
      if (!partner) continue;
      const pc = partner as Mutable;
      const pi = partner.nets.indexOf(u.nets[inIdx] ?? '');
      if (!pc.tips?.[pi]) continue;
      const delta = (pc.tips[pi] as Point)[1] - inTip[1];
      if (delta !== 0 && Math.abs(delta) <= 48 && delta % GRID === 0) {
        pc.origin[1] -= delta;
        pc.abs  = (pc.rpins  as Point[]).map((p: Point) => [pc.origin[0] + p[0], pc.origin[1] + p[1]]);
        pc.tips = (pc.rtips  as Point[]).map((p: Point) => [pc.origin[0] + p[0], pc.origin[1] + p[1]]);
        pc.y = (pc.origin[1] as number) + (pc.rbb[1] as number);
      }
    }
  }
}
