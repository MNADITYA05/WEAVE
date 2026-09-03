/**
 * topology.ts — Analog topology detection
 *
 * Detects common analog circuit patterns (diff pairs, current mirrors, cascodes,
 * source degeneration) and annotates the ELK graph with layout hints that keep
 * topology members grouped in the same layer.
 *
 * These are heuristics: they work for the most common textbook topologies but
 * may misfire on unusual naming or unconventional pin ordering. Dedicated tests
 * for each pattern are the correct safety net (see tests/).
 */

import type { DetectedTopology, ElkGraph, TopologyComp } from '../types.js';

/** Input shape accepted by detectTopologies(). */
export interface TopologyNetlist {
  readonly components: readonly TopologyComp[];
}

/**
 * Detect common analog topologies in a parsed netlist.
 *
 * @param netlist - Object with a `components` array of {name, type, nets}
 * @returns Array of detected topology descriptors, in detection order
 */
export function detectTopologies(netlist: TopologyNetlist): DetectedTopology[] {
  const topos: DetectedTopology[] = [];
  const comps = netlist.components;

  // net → components sharing it
  const netMap = new Map<string, TopologyComp[]>();
  for (const c of comps) {
    for (const n of c.nets) {
      if (!netMap.has(n)) netMap.set(n, []);
      netMap.get(n)!.push(c);
    }
  }

  const used = new Set<string>();

  const bjts = comps.filter(c => c.type === 'Q' || c.type === 'q');
  const fets = comps.filter(c => c.type === 'M' || c.type === 'm');
  const resistors = comps.filter(c => c.type === 'R' || c.type === 'r');

  // ── Differential pair ─────────────────────────────────────────────────────
  function checkDiffPair(
    arr: readonly TopologyComp[],
    emitterPin: number,
    basePin: number,
  ): void {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i]!;
        const b = arr[j]!;
        if (used.has(a.name) || used.has(b.name)) continue;
        const aE = a.nets[emitterPin];
        const bE = b.nets[emitterPin];
        if (!aE || !bE || aE !== bE || aE === '0') continue;
        const aB = a.nets[basePin];
        const bB = b.nets[basePin];
        if (!aB || !bB || aB === bB) continue;
        topos.push({ type: 'diff_pair', nodes: [a.name, b.name], sharedNet: aE });
        used.add(a.name);
        used.add(b.name);
      }
    }
  }
  checkDiffPair(bjts, 2, 1);
  checkDiffPair(fets, 2, 1);

  // ── Current mirror ────────────────────────────────────────────────────────
  function checkMirror(
    arr: readonly TopologyComp[],
    gatePin: number,
    drainPin: number,
  ): void {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i]!;
        const b = arr[j]!;
        if (used.has(a.name) || used.has(b.name)) continue;
        const aG = a.nets[gatePin];
        const bG = b.nets[gatePin];
        if (!aG || !bG || aG !== bG) continue;
        const aD = a.nets[drainPin];
        const bD = b.nets[drainPin];
        if (aD === aG || bD === bG) {
          topos.push({ type: 'current_mirror', nodes: [a.name, b.name] });
          used.add(a.name);
          used.add(b.name);
        }
      }
    }
  }
  checkMirror(bjts, 1, 0);
  checkMirror(fets, 1, 0);

  // ── Cascode ───────────────────────────────────────────────────────────────
  function checkCascode(
    arr: readonly TopologyComp[],
    drainPin: number,
    sourcePin: number,
  ): void {
    for (let i = 0; i < arr.length; i++) {
      for (let j = 0; j < arr.length; j++) {
        if (i === j) continue;
        const a = arr[i]!;
        const b = arr[j]!;
        if (used.has(a.name) || used.has(b.name)) continue;
        const aD = a.nets[drainPin];
        const bS = b.nets[sourcePin];
        if (aD && aD === bS) {
          topos.push({ type: 'cascode', nodes: [b.name, a.name] });
          used.add(a.name);
          used.add(b.name);
        }
      }
    }
  }
  checkCascode(bjts, 0, 2);
  checkCascode(fets, 0, 2);

  // ── Source degeneration ───────────────────────────────────────────────────
  for (const t of [...bjts, ...fets]) {
    if (used.has(t.name)) continue;
    const srcNet = t.nets[2];
    if (!srcNet || srcNet === '0') continue;
    for (const r of resistors) {
      if (used.has(r.name)) continue;
      if (r.nets.includes(srcNet)) {
        topos.push({ type: 'src_degen', nodes: [t.name, r.name] });
        used.add(r.name);
        break;
      }
    }
  }

  return topos;
}

/**
 * Annotate an ELK graph with layout hints derived from detected topologies.
 *
 * @param elkGraph - The ELK graph to annotate (mutated in place)
 * @param topos    - Topologies returned by detectTopologies()
 * @returns The same elkGraph, annotated
 */
export function applyTopologyHints(elkGraph: ElkGraph, topos: readonly DetectedTopology[]): ElkGraph {
  if (!topos.length) return elkGraph;

  const nodeMap = new Map<string, ElkGraph['children'][number]>();
  for (const n of elkGraph.children) nodeMap.set(n.id, n);

  let groupId = 0;
  for (const topo of topos) {
    groupId++;
    for (const name of topo.nodes) {
      const n = nodeMap.get(name);
      if (!n) continue;
      n.layoutOptions = n.layoutOptions ?? {};
      n.layoutOptions['org.eclipse.elk.partitioning.partition'] = String(groupId);
      if (topo.type === 'diff_pair') {
        n.layoutOptions['org.eclipse.elk.layered.crossingMinimization.semiInteractive'] = 'true';
      }
    }
  }
  return elkGraph;
}

/** @deprecated Use detectTopologies() — this alias exists for backward compatibility. */
export const _detectTopologies = (netlist: TopologyNetlist): DetectedTopology[] =>
  detectTopologies(netlist);

/** @deprecated Use applyTopologyHints() — this alias exists for backward compatibility. */
export const _applyTopologyHints = applyTopologyHints;
