/**
 * router.ts — Wire routing stage (orchestrator).
 *
 * Delegates to sub-modules:
 *   route-types.ts       — shared types + pure helpers
 *   direct-connector.ts  — ELK edge routing
 *   bridge-resolver.ts   — same-component repeated-net bridges
 *   feedback-placer.ts   — feedback element geometry + wiring
 *   flag-placer.ts       — hang-shunt placement + cross-net guard
 *
 * Inputs:
 *   comps     — placed + decorated components
 *   opamps    — subset of comps that are opamp-like
 *   elkEdges  — ELK output edges with routing sections
 *   portId    — maps (component, pinIndex) → ELK port id string
 *   bridges   — same-component repeated-net pin pairs
 *   cls       — net classification map
 *   opts      — routing feature flags
 *
 * Returns: { wires, flags }
 */

import { placeIsolated } from './place-isolated.js';
import { fixFlagDirs, emitFlags } from './flag-emit.js';
import { allSegs } from './route-types.js';
import { buildPortAbs, routeElkEdges, deconflictTips, simplifyAndFlush } from './direct-connector.js';
import { routeBridges } from './bridge-resolver.js';
import { buildFbJobs, placeDividerLegs, wireFeedback, wireFarFeedback } from './feedback-placer.js';
import { placeHangShunts, crossNetGuard } from './flag-placer.js';
import type { NetClassMap, WireSegment, FlagEntry, ElkEdge, RouteResult } from '../types.js';
import type { WorkComp, WSeg, RouteOpts } from './route-types.js';

export type { RouteOpts };

// ─── routeWires ───────────────────────────────────────────────────────────────

/**
 * Routes wires between all placed components and places off-graph components
 * (feedback, far-feedback, leg, hang, isolated).
 */
export function routeWires(
  comps:    WorkComp[],
  opamps:   WorkComp[],
  elkEdges: ElkEdge[],
  portId:   (c: WorkComp, i: number) => string,
  bridges:  Array<{ c: WorkComp; i: number; j: number }>,
  cls:      NetClassMap,
  opts:     RouteOpts,
): RouteResult {
  const wires: WSeg[] = [];

  // ── Stage A: port positions + escape stubs ────────────────────────────────
  const portAbs = buildPortAbs(comps, portId, wires);

  // ── Stage B: feedback geometry (wires deferred) ───────────────────────────
  const fbJobs = buildFbJobs(opamps);

  // ── Stage C: divider leg placement ───────────────────────────────────────
  placeDividerLegs(opamps, comps, wires);

  // ── Stage D: ELK edge routes ──────────────────────────────────────────────
  const routes = routeElkEdges(elkEdges, portAbs);

  // ── Stage E: external bridges ─────────────────────────────────────────────
  routeBridges(bridges, wires);

  // ── Stage F: deconflict routes vs stub tips ───────────────────────────────
  deconflictTips(comps, routes);

  // allSegsF — live snapshot of wires[] + in-progress routes[]
  // NOTE: after simplifyAndFlush the routes array is not cleared, so allSegsF
  // still includes them (double-counts them). This matches original behaviour.
  const allSegsF = (): WSeg[] => allSegs(wires, routes);

  // ── Stage G: feedback wiring ──────────────────────────────────────────────
  wireFeedback(fbJobs, wires, allSegsF);
  wireFarFeedback(opamps, comps, wires, allSegsF);

  // ── Stage H: isolated component placement ─────────────────────────────────
  placeIsolated(comps as never, allSegsF as never);

  // ── Stage I: L-simplify + flush routes → wires ────────────────────────────
  simplifyAndFlush(comps, routes, wires, opts, allSegsF);

  // ── Stage J: hang-shunt placement ────────────────────────────────────────
  placeHangShunts(comps, opamps, cls, wires, allSegsF);

  // ── Stage K: cross-net contact guard ─────────────────────────────────────
  crossNetGuard(wires);

  // ── Stage L: flag direction fix-up + emission ─────────────────────────────
  fixFlagDirs(comps as never, allSegsF as never, cls);
  const flags: FlagEntry[] = [];
  emitFlags(comps as never, wires as never, flags, cls);

  return { wires: wires as WireSegment[], flags };
}
