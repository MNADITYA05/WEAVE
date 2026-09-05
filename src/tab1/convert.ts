/**
 * convert.ts — Main conversion orchestrator: SPICE netlist → LTspice .asc
 *
 * Pipeline:
 *   parseNetlist → classifyNets → netDepths → decorateComponents
 *   → classifyFeedback → buildElkGraph → elk.layout → applyLayout
 *   → resolveCollisions → routeWires → repairNets → emitAsc
 *   → mergeWires → detectJunctions
 *
 * ELK is injected via the IElk interface so the pipeline can run headless
 * (in tests) without a real ELK Web Worker.
 */

import { _detectTopologies, _applyTopologyHints } from '../shared/topology.js';
import { resolveStdlib, stdlibReady } from './lib-resolver.js';
import { parseNetlist } from './netlist-parser.js';
import { classifyNets } from './classifier.js';
import { netDepths, decorateComponents } from './orientation.js';
import { classifyFeedback } from './feedback.js';
import { buildElkGraph } from './layout.js';
import { applyLayout } from './apply-layout.js';
import { routeWires } from './router.js';
import { resolveCollisions } from './place-repair.js';
import { repairNets } from './net-repair.js';
import { emitAsc } from './renderer.js';
import { mergeWires, detectJunctions } from './wire-merge.js';

import type { IElk, AnnotatedComponent, WireSegment, FlagEntry } from '../types.js';
import type { LayoutOpts } from './layout.js';
import type { FeedbackOpts } from './feedback.js';
import { LayoutError } from '../errors.js';
import { logger } from '../logger.js';

// ─── Browser globals ──────────────────────────────────────────────────────────
declare const ELK: new () => IElk & { terminateWorker?: () => void };

// ─── ELK singleton ────────────────────────────────────────────────────────────
// Reuse the Web Worker across calls; kill and recreate on timeout.
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

export async function convert(
  text: string,
  opts: ConvertOpts = {},
): Promise<{ asc: string; missingLibs: string[] }> {
  // ── Stage 0: stdlib resolution (Situation 2) ───────────────────────────────
  await stdlibReady;
  const { text: enrichedText, missingLibs } = resolveStdlib(text);

  // ── Stage 1: parse & classify ──────────────────────────────────────────────
  const { comps: rawComps, directives } = parseNetlist(enrichedText);
  const cls   = classifyNets(rawComps);
  const depth = netDepths(rawComps, cls);

  // ── Stage 2: decorate (immutable — returns new DecoratedComponent[]) ────────
  const decorated = decorateComponents(rawComps, cls, depth);

  // ── Stage 3: feedback classification ──────────────────────────────────────
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
    logger.debug('Topologies detected: ' + topos.map((t: { type: string; nodes: readonly string[] }) => t.type + ':' + [...t.nodes].join('+')).join(', '));
  }
  _applyTopologyHints(graph, topos);

  // ── Stage 6: ELK layout ───────────────────────────────────────────────────
  if (typeof ELK === 'undefined' && !opts.elk)
    throw new LayoutError('ELK layout engine not loaded — check that elk.js script tag executed before convert() was called');

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
  applyLayout(annotated, opamps, out);

  // ── Stage 8: collision repair & wire routing ──────────────────────────────
  resolveCollisions(annotated as never);
  const { wires: wiresRO, flags: flagsRO } = routeWires(annotated as never, opamps as never, out.edges ?? [], portId as never, bridges as never, cls, opts as never);
  const wires = wiresRO as WireSegment[];
  const flags = flagsRO as FlagEntry[];
  repairNets(annotated, wires, flags, cls);

  // ── Stage 9: emit + clean ─────────────────────────────────────────────────
  let asc = emitAsc(annotated as never, wires as never, flags as never, directives);
  asc = mergeWires(asc);
  asc = detectJunctions(asc);
  return { asc, missingLibs };
}
