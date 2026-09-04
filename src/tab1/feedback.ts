/**
 * feedback.ts — Feedback classification
 *
 * Stage 4→5 of the pipeline: converts DecoratedComponent[] → AnnotatedComponent[].
 *
 * This module is a PURE TRANSFORM. It creates a brand-new AnnotatedComponent for
 * every input, annotating each with feedback/leg/hang classification. The input
 * DecoratedComponent objects are never mutated.
 *
 * Four feedback patterns are detected:
 *
 *   isFb   — Local feedback: a two-terminal element whose nets are the INPUT
 *             and OUTPUT of the same opamp. Placed above the opamp body.
 *
 *   isFar  — Far feedback: a two-terminal element connecting an opamp's OUTPUT
 *             back to a lower-depth upstream net (e.g. Sallen-Key filter caps).
 *             Stacked above local feedback in tiers.
 *
 *   isLeg  — Divider leg: a two-terminal element connecting an opamp's feedback
 *             input net to gnd/rail (the bottom of a voltage divider). Placed
 *             horizontally to the left of the opamp's input.
 *
 *   isHang — Hangable shunt: a two-terminal element with one flag net whose
 *             signal net has ≥2 other in-graph connections (a real bus). Pulled
 *             below the bus and connected with a T-junction.
 *
 * Elements classified as isFb, isFar, isLeg, or isHang get inGraph=false and are
 * excluded from ELK, then placed manually by the router.
 *
 * The opts flags noFb / noFar / noLeg / noHang suppress the corresponding pass.
 */

import { rot, rotBBox } from '../shared/geometry.js';
import type {
  DecoratedComponent,
  AnnotatedComponent,
  NetClassMap,
  NetDepthMap,
  BBox,
  Point,
  RotCode,
} from '../types.js';
import { isFlag } from './classifier.js';

import { SYMBOLS } from './symbols.js';

/** Options controlling which feedback passes run. */
export interface FeedbackOpts {
  noFb?:   boolean;
  noFar?:  boolean;
  noLeg?:  boolean;
  noHang?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Re-orient a two-terminal feedback element and recompute its geometry.
 * Returns the new rot, rpins, and rbb — the three fields that change.
 */
function reorientFeedback(
  sym: string,
  rotCode: RotCode,
): { rot: RotCode; rpins: Point[]; rbb: BBox } {
  const S = SYMBOLS[sym]!;
  const rpins: Point[] = S.pins.map(p => rot(p, rotCode));
  let rbb: BBox = [...rotBBox(S.bbox, rotCode)];
  for (const p of rpins) {
    rbb[0] = Math.min(rbb[0], p[0]);
    rbb[1] = Math.min(rbb[1], p[1]);
    rbb[2] = Math.max(rbb[2], p[0]);
    rbb[3] = Math.max(rbb[3], p[1]);
  }
  return { rot: rotCode, rpins, rbb };
}

// ─── classifyFeedback ────────────────────────────────────────────────────────

/**
 * Classify feedback elements in a decorated netlist.
 *
 * Returns a new AnnotatedComponent[] whose objects share all DecoratedComponent
 * fields but carry additional classification flags. Feedback elements that are
 * re-oriented also receive new rot/rpins/rbb values.
 *
 * The opamp attachment lists (fbList, farList, legList) are set on the opamp
 * AnnotatedComponent objects in this array, not on the satellites.
 *
 * @param decorated - Output of decorateComponents()
 * @param cls       - Net class map
 * @param depth     - Net depth map
 * @param opts      - Flags to suppress individual passes
 * @returns New AnnotatedComponent[] with feedback annotations
 */
export function classifyFeedback(
  decorated: readonly DecoratedComponent[],
  cls: NetClassMap,
  depth: NetDepthMap,
  opts: FeedbackOpts = {},
): AnnotatedComponent[] {
  // Start with a base annotation for every component (all flags false)
  const annotated: AnnotatedComponent[] = decorated.map(c => ({
    ...c,
    isFb:   false,
    isFar:  false,
    isLeg:  false,
    isHang: false,
  }));

  // Build a lookup map for O(1) access
  const byName = new Map<string, AnnotatedComponent>(
    annotated.map(a => [a.name, a])
  );

  const opamps = annotated.filter(c => c.isOp);

  // ── Pass 1: local feedback (isFb) ────────────────────────────────────────
  if (!opts.noFb) {
    for (const c of annotated) {
      if (c.nets.length !== 2 || c.isOp) continue;
      if (cls.get(c.nets[0]!) !== 'signal' || cls.get(c.nets[1]!) !== 'signal') continue;

      for (const u of opamps) {
        const inputIdxs = SYMBOLS[u.sym]!.pins
          .map((_, i) => i)
          .filter(i => i !== u.outPinIdx);

        const inIdx = inputIdxs.find(
          i => u.nets[i] === c.nets[0] || u.nets[i] === c.nets[1]
        );
        if (inIdx === undefined) continue;

        const inNet = u.nets[inIdx]!;
        const other = c.nets[0] === inNet ? c.nets[1]! : c.nets[0]!;
        if (other !== u.nets[u.outPinIdx!]) continue;

        // Orient: input-side pin on the left
        const newRot: RotCode = c.nets[0] === inNet ? 'R270' : 'R90';
        const geo = reorientFeedback(c.sym, newRot);

        // Mutate the annotated entry (it's our own new object, not the input)
        const ac = byName.get(c.name)!;
        Object.assign(ac, {
          ...geo,
          isFb:    true,
          fbOf:    u,
          fbInIdx: inIdx,
          fbInNet: inNet,
          inGraph: false,
        });

        // Register on the opamp's fbList
        const uac = byName.get(u.name)!;
        (uac as unknown as { fbList?: AnnotatedComponent[] }).fbList =
          uac.fbList ? [...uac.fbList, ac] : [ac];
        break;
      }
    }
  }

  // ── Pass 2: far feedback (isFar) ─────────────────────────────────────────
  if (!opts.noFar) {
    for (const c of annotated) {
      if (c.isFb || c.nets.length !== 2 || c.isOp) continue;
      if (cls.get(c.nets[0]!) !== 'signal' || cls.get(c.nets[1]!) !== 'signal') continue;

      for (const u of opamps) {
        const outIdx = c.nets.findIndex((n: string) => n === u.nets[u.outPinIdx!]);
        if (outIdx < 0) continue;
        const upNet = c.nets[1 - outIdx]!;
        const outDepth = depth.get(u.nets[u.outPinIdx!]!) ?? 0;
        const upDepth  = depth.get(upNet) ?? 99;
        if (upDepth >= outDepth) continue;

        const newRot: RotCode = outIdx === 1 ? 'R270' : 'R90';
        const geo = reorientFeedback(c.sym, newRot);

        const ac = byName.get(c.name)!;
        Object.assign(ac, {
          ...geo,
          isFar:   true,
          farOf:   u,
          upNet,
          inGraph: false,
        });

        const uac = byName.get(u.name)!;
        (uac as unknown as { farList?: AnnotatedComponent[] }).farList =
          uac.farList ? [...uac.farList, ac] : [ac];
        break;
      }
    }
  }

  // ── Pass 3: divider leg (isLeg) ──────────────────────────────────────────
  if (!opts.noLeg) {
    for (const c of annotated) {
      if (c.isFb || c.isFar || c.nets.length !== 2 || c.isOp) continue;
      const flagIdx = ([0, 1] as const).find(i => isFlag(cls.get(c.nets[i]!)));
      if (flagIdx === undefined) continue;
      const sigNet = c.nets[1 - flagIdx]!;
      if (cls.get(sigNet) !== 'signal') continue;

      for (const u of opamps) {
        if (!u.fbList || !u.fbList.some((F: AnnotatedComponent) => F.fbInNet === sigNet)) continue;
        // Only proceed when no other in-graph component also sits on this net
        const occupied = annotated.some(
          o => o !== c && o !== u && o.inGraph && o.nets.includes(sigNet)
        );
        if (occupied) break;

        const newRot: RotCode = flagIdx === 0 ? 'R270' : 'R90';
        const geo = reorientFeedback(c.sym, newRot);
        const legInIdx = ([0, 1] as const).find(i => u.nets[i] === sigNet);

        const ac = byName.get(c.name)!;
        Object.assign(ac, {
          ...geo,
          isLeg:    true,
          legOf:    u,
          legInIdx,
          inGraph:  false,
        });

        const uac = byName.get(u.name)!;
        (uac as unknown as { legList?: AnnotatedComponent[] }).legList =
          uac.legList ? [...uac.legList, ac] : [ac];
        break;
      }
    }
  }

  // ── Pass 4: hangable shunt (isHang) ──────────────────────────────────────
  if (!opts.noHang) {
    for (const c of annotated) {
      if (c.isFb || c.isFar || c.isLeg || c.nets.length !== 2 || c.isOp) continue;
      if (c.sym === 'voltage' || c.sym === 'current') continue;
      const flagIdx = ([0, 1] as const).find(i => isFlag(cls.get(c.nets[i]!)));
      if (flagIdx === undefined) continue;
      const sigNet = c.nets[1 - flagIdx]!;
      if (cls.get(sigNet) !== 'signal') continue;

      const othersOnNet = annotated.filter(
        o => o !== c && o.inGraph && !o.isFb && !o.isLeg && o.nets.includes(sigNet)
      ).length;

      if (othersOnNet >= 2) {
        const ac = byName.get(c.name)!;
        Object.assign(ac, { isHang: true, hangNet: sigNet, inGraph: false });
      }
    }
  }

  // ── Corridor reservation ──────────────────────────────────────────────────
  // Expand each opamp's rbb to reserve vertical space for feedback tiers
  // and horizontal space for divider legs. This must happen after all four
  // passes so the counts are final.
  for (const u of opamps) {
    const uac = byName.get(u.name)!;
    const tiers = (uac.fbList?.length ?? 0) + (uac.farList?.length ?? 0);
    const rbb: BBox = [...uac.rbb];

    if (tiers > 0) {
      rbb[1] = Math.min(rbb[1], 32 - (176 + 80 * (tiers - 1)));
      rbb[2] = Math.max(rbb[2], 80);
      if (uac.fbList?.some((F: AnnotatedComponent) => F.fbInIdx === 0)) {
        rbb[0] = Math.min(rbb[0], -64);
      }
    }
    if (uac.legList) {
      rbb[0] = Math.min(rbb[0], -160);
    }

    Object.assign(uac, { rbb });
  }

  return annotated;
}
