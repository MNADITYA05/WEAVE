/**
 * convert.ts — Main conversion orchestrator: SPICE netlist → LTspice .asc
 *
 * Pipeline:
 *   parseNetlist → classifyNets → netDepths → decorateComponents
 *   → classifyFeedback → buildElkGraph → elk.layout → applyLayout
 *   → routeWires → repairNets → emitAsc → mergeWires → detectJunctions
 *
 * ELK is injected via the IElk interface so the pipeline can run headless
 * (in tests) without a real ELK Web Worker.
 */

import { GRID, snap, rot, rotBBox } from '../shared/geometry.js';
import { parseNetlist } from './netlist-parser.js';
import { classifyNets, isFlag } from './classifier.js';
import { netDepths, decorateComponents } from './orientation.js';
import { classifyFeedback } from './feedback.js';
import { buildElkGraph } from './layout.js';
import { _detectTopologies, _applyTopologyHints } from '../shared/topology.js';
import { emitAsc } from './renderer.js';
import { mergeWires, detectJunctions } from './wire-merge.js';

// JS modules not yet migrated to TS — imported as-is
// @ts-ignore
import { routeWires }       from './router.js';
// @ts-ignore
import { resolveCollisions } from './place-repair.js';
// @ts-ignore
import { repairNets }        from './net-repair.js';

import type { IElk, AnnotatedComponent } from '../types.js';
import type { LayoutOpts } from './layout.js';
import type { FeedbackOpts } from './feedback.js';

// ─── Browser globals ──────────────────────────────────────────────────────────
declare const ELK: new () => IElk & { terminateWorker?: () => void };
declare const SYMBOLS: Record<string, {
  pins: [number, number][];
  bbox: [number, number, number, number];
}>;

// ─── ELK singleton ────────────────────────────────────────────────────────────
// Reuse the Web Worker across calls; kill and recreate on timeout.
// Stored on the convert function object so callers can pre-warm: convert._elk = new ELK()
export let _elkInstance: (IElk & { terminateWorker?: () => void }) | null = null;

// ─── ConvertOpts ─────────────────────────────────────────────────────────────

export interface ConvertOpts {
  noFb?:   boolean;
  noFar?:  boolean;
  noLeg?:  boolean;
  noHang?: boolean;
  /** Injectable ELK instance for headless testing */
  elk?:    IElk;
}

// ─── convert ─────────────────────────────────────────────────────────────────

export async function convert(text: string, opts: ConvertOpts = {}): Promise<string> {
  // ── Stage 1: parse & classify ──────────────────────────────────────────────
  const { comps: rawComps, directives } = parseNetlist(text);
  const cls   = classifyNets(rawComps);
  const depth = netDepths(rawComps, cls);

  // ── Stage 2: decorate (immutable — returns new DecoratedComponent[]) ────────
  const decorated = decorateComponents(rawComps, cls, depth);

  // ── Stage 3: feedback classification ─────────────────────────────────────
  const fbOpts: FeedbackOpts = {};
  if (opts.noFb   !== undefined) fbOpts.noFb   = opts.noFb;
  if (opts.noFar  !== undefined) fbOpts.noFar  = opts.noFar;
  if (opts.noLeg  !== undefined) fbOpts.noLeg  = opts.noLeg;
  if (opts.noHang !== undefined) fbOpts.noHang = opts.noHang;
  const annotated: AnnotatedComponent[] = classifyFeedback(decorated, cls, depth, fbOpts);

  // ── Stage 4: ELK graph build ──────────────────────────────────────────────
  const opamps = annotated.filter(c => c.isOp);
  const layoutOpts: LayoutOpts = {};
  const { graph, portId, bridges } = buildElkGraph(annotated, layoutOpts, cls, depth);

  // ── Stage 5: topology hints ───────────────────────────────────────────────
  const netlObj = {
    components: annotated.map(c => ({
      name: c.name,
      type: (c.sym ?? '').charAt(0).toUpperCase(),
      nets: c.nets ?? [],
    })),
  };
  const topos = _detectTopologies(netlObj);
  if (topos.length) {
    console.log('Topologies detected:', topos.map((t: { type: string; nodes: readonly string[] }) => t.type + ':' + [...t.nodes].join('+')));
  }
  _applyTopologyHints(graph, topos);

  // ── Stage 6: ELK layout ───────────────────────────────────────────────────
  if (typeof ELK === 'undefined' && !opts.elk)
    throw new Error('ELK layout engine not loaded — check that elk.js script tag executed before convert() was called');

  let elk: IElk & { terminateWorker?: () => void };
  if (opts.elk) {
    elk = opts.elk as typeof elk;
  } else {
    if (!_elkInstance) _elkInstance = new ELK();
    elk = _elkInstance;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = await Promise.race([
    elk.layout(graph),
    new Promise<never>((_, rej) => setTimeout(() => {
      if (typeof elk.terminateWorker === 'function') elk.terminateWorker();
      _elkInstance = null;
      rej(new Error('ELK layout timeout'));
    }, 7000)),
  ]);

  // ── Stage 7: apply layout positions ──────────────────────────────────────
  // Mutate annotated components with placed positions.
  // (annotated is our own array — safe to mutate the placed fields)
  const byName = new Map(annotated.map(c => [c.name, c]));

  for (const n of out.children ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = byName.get(n.id) as any;
    if (!c) continue;
    c.x = snap(n.x); c.y = snap(n.y);
    c.origin = [c.x - c.rbb[0], c.y - c.rbb[1]];
    c.abs  = c.rpins.map((p: [number, number]) => [c.origin[0] + p[0], c.origin[1] + p[1]]);
    c.tips = c.rtips.map((p: [number, number]) => [c.origin[0] + p[0], c.origin[1] + p[1]]);
  }

  // Nudge opamps to align with series feeder elements
  for (const u of opamps.filter(u => u.inGraph)) {
    for (const inIdx of [1, 0]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uc = u as any;
      const pid = u.name + '.p' + inIdx;
      const e = (out.edges ?? []).find((e: { targets: string[]; sources: string[] }) => e.targets[0] === pid);
      if (!e) continue;
      const src = annotated.find(c => c.inGraph && e.sources[0].startsWith(c.name + '.p'));
      if (!src || src.nets.length !== 2) continue;
      const si = +e.sources[0].split('.p')[1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sc = src as any;
      const delta = sc.tips[si][1] - uc.tips[inIdx][1];
      if (delta !== 0 && Math.abs(delta) <= 32 && delta % GRID === 0) {
        uc.y += delta;
        uc.origin = [uc.x - uc.rbb[0], uc.y - uc.rbb[1]];
        uc.abs  = uc.rpins.map((p: [number, number]) => [uc.origin[0] + p[0], uc.origin[1] + p[1]]);
        uc.tips = uc.rtips.map((p: [number, number]) => [uc.origin[0] + p[0], uc.origin[1] + p[1]]);
      }
      break;
    }
  }

  // Series element Y-nudge: align series elements feeding opamp inputs
  for (const u of opamps.filter(u => u.inGraph)) {
    for (const inIdx of [0, 1]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uc = u as any;
      if (!uc.tips?.[inIdx]) continue;
      const inTip = uc.tips[inIdx];
      const partner = annotated.find(c =>
        c.inGraph && c.nets.length === 2 && !c.isOp &&
        c.nets.includes(u.nets[inIdx] ?? ''),
      );
      if (!partner) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pc = partner as any;
      const pi = partner.nets.indexOf(u.nets[inIdx] ?? '');
      if (!pc.tips?.[pi]) continue;
      const delta = pc.tips[pi][1] - inTip[1];
      if (delta !== 0 && Math.abs(delta) <= 48 && delta % GRID === 0) {
        pc.origin[1] -= delta;
        pc.abs  = pc.rpins.map((p: [number, number]) => [pc.origin[0] + p[0], pc.origin[1] + p[1]]);
        pc.tips = pc.rtips.map((p: [number, number]) => [pc.origin[0] + p[0], pc.origin[1] + p[1]]);
        pc.y = pc.origin[1] + pc.rbb[1];
      }
    }
  }

  // ── Stage 8: collision repair & wire routing ──────────────────────────────
  resolveCollisions(annotated);
  const { wires, flags } = routeWires(annotated, opamps, out.edges ?? [], portId, bridges, cls, opts);
  repairNets(annotated, wires, flags, cls);

  // ── Stage 9: emit + clean ─────────────────────────────────────────────────
  let asc = emitAsc(annotated as never, wires, flags, directives);
  asc = mergeWires(asc);
  asc = detectJunctions(asc);
  return asc;
}
