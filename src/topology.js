'use strict';
// ── Stage 3: Analog topology detection ────────────────────────────
export function _detectTopologies(netlist) {
  // Returns array of {type, nodes} for detected subcircuits
  // Input: parsed netlist object with components array [{name,type,nets}]
  const topos = [];
  const comps = netlist.components || [];

  // Build net→components map
  const netMap = {};
  for (const c of comps) {
    for (const n of c.nets) {
      if (!netMap[n]) netMap[n] = [];
      netMap[n].push(c);
    }
  }

  const used = new Set();

  // ── Differential pair: two matched transistors sharing emitter/source net
  //    and having separate base/gate inputs
  const bjts = comps.filter(c => c.type === 'Q' || c.type === 'q');
  const fets = comps.filter(c => c.type === 'M' || c.type === 'm');

  function checkDiffPair(arr, emitterPin, basePin) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i+1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        if (used.has(a.name) || used.has(b.name)) continue;
        // Same emitter/source net
        const aE = a.nets[emitterPin], bE = b.nets[emitterPin];
        if (aE && aE === bE && aE !== '0') {
          // Different base/gate nets
          const aB = a.nets[basePin], bB = b.nets[basePin];
          if (aB && bB && aB !== bB) {
            topos.push({type:'diff_pair', nodes:[a.name, b.name], sharedNet: aE});
            used.add(a.name); used.add(b.name);
          }
        }
      }
    }
  }
  checkDiffPair(bjts, 2, 1); // BJT: nets[0]=C nets[1]=B nets[2]=E
  checkDiffPair(fets, 2, 1); // FET: nets[0]=D nets[1]=G nets[2]=S

  // ── Current mirror: two transistors with tied bases/gates, one diode-connected
  function checkMirror(arr, gatePin, drainPin) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i+1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        if (used.has(a.name) || used.has(b.name)) continue;
        const aG = a.nets[gatePin], bG = b.nets[gatePin];
        if (aG && aG === bG) {
          // One is diode-connected (gate tied to drain)
          const aD = a.nets[drainPin], bD = b.nets[drainPin];
          if (aD === aG || bD === bG) {
            topos.push({type:'current_mirror', nodes:[a.name, b.name]});
            used.add(a.name); used.add(b.name);
          }
        }
      }
    }
  }
  checkMirror(bjts, 1, 0);
  checkMirror(fets, 1, 0);

  // ── Cascode: two transistors stacked (drain of one → source of next)
  function checkCascode(arr, drainPin, sourcePin) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = 0; j < arr.length; j++) {
        if (i === j) continue;
        const a = arr[i], b = arr[j];
        if (used.has(a.name) || used.has(b.name)) continue;
        if (a.nets[drainPin] && a.nets[drainPin] === b.nets[sourcePin]) {
          topos.push({type:'cascode', nodes:[b.name, a.name]}); // b on top
          used.add(a.name); used.add(b.name);
        }
      }
    }
  }
  checkCascode(bjts, 0, 2);
  checkCascode(fets, 0, 2);

  // ── Source degeneration: transistor with resistor in source/emitter path
  const resistors = comps.filter(c => c.type === 'R' || c.type === 'r');
  for (const t of [...bjts, ...fets]) {
    if (used.has(t.name)) continue;
    const srcNet = t.nets[2]; // emitter/source
    if (!srcNet || srcNet === '0') continue;
    for (const r of resistors) {
      if (used.has(r.name)) continue;
      if (r.nets.includes(srcNet)) {
        topos.push({type:'src_degen', nodes:[t.name, r.name]});
        used.add(r.name); // don't double-count the transistor - it may be in a diff pair too
        break;
      }
    }
  }

  return topos;
}

// Annotate ELK graph with topology hints (group nodes into same layer)
export function _applyTopologyHints(elkGraph, topos) {
  if (!elkGraph || !topos.length) return elkGraph;
  // For each detected topology, ensure nodes appear in same layer
  // by setting their priority/position hints
  const nodeMap = {};
  for (const n of (elkGraph.children || [])) {
    nodeMap[n.id] = n;
  }
  let groupId = 0;
  for (const topo of topos) {
    groupId++;
    for (const name of topo.nodes) {
      const n = nodeMap[name];
      if (n) {
        n.layoutOptions = n.layoutOptions || {};
        // Force same layer via partitioning
        n.layoutOptions['org.eclipse.elk.partitioning.partition'] = String(groupId);
        if (topo.type === 'diff_pair') {
          // Symmetric placement hint
          n.layoutOptions['org.eclipse.elk.layered.crossingMinimization.semiInteractive'] = 'true';
        }
      }
    }
  }
  return elkGraph;
}
// ── End Stage 3 ────────────────────────────────────────────────────
