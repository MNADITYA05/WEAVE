'use strict';
import { GRID } from '../shared/geometry.js';
import { SYMBOLS } from './symbols.js';
import { isFlag } from './classifier.js';
// ── Stage: ELK graph construction ─────────────────────────────────────────
// Builds the ELK JSON graph from decorated components.
// Returns {graph, portId, bridges}.
export function buildElkGraph(comps, opts, cls, depth){
  // ELK graph over in-graph components and signal nets
  const children=[], edges=[];
  const portId=(c,i)=>c.name+'.p'+i;
  for (const c of comps.filter(c=>c.inGraph)){
    children.push({
      id: c.name,
      width: c.rbb[2]-c.rbb[0], height: c.rbb[3]-c.rbb[1],
      layoutOptions: { 'elk.portConstraints':'FIXED_POS' },
      ports: c.rtips.map((p,i)=>{
        const esc = c.esc[i];
        const side = !esc ? undefined
          : esc[0]>0 ? 'EAST' : esc[0]<0 ? 'WEST'
          : esc[1]<0 ? 'NORTH' : 'SOUTH';
        const lo = side ? {'elk.portSide': side} : {};
        return { id: portId(c,i), x: p[0]-c.rbb[0], y: p[1]-c.rbb[1], width:0, height:0, layoutOptions: lo };
      })
    });
  }
  const nets = new Map(); // signal net -> [{c, i}]
  // same-component repeated pins on one net: only the first joins the ELK
  // graph; the rest are bridged externally tip-to-tip after placement
  // (self-edges make ELK hug the node boundary and mow down foreign tips)
  const bridges=[];   // {c, i, j}: same net, bridged externally
  for (const c of comps.filter(c=>c.inGraph)){
    const forceBridge = opts.bridge || (SYMBOLS[c.sym] && SYMBOLS[c.sym].synthetic);
    const seen=new Map();   // net -> representative pin index
    c.nets.forEach((n,i)=>{
      if (cls.get(n)!=='signal') return;
      if (forceBridge && seen.has(n)){
        const r=seen.get(n);
        const dr=c.esc[r], di=c.esc[i];
        if (dr && di && dr[0]===di[0] && dr[1]===di[1]){
          bridges.push({c, i:r, j:i});   // same escape side: bridge externally
          return;
        }
      } else if (!seen.has(n)) seen.set(n,i);
      if (!nets.has(n)) nets.set(n,[]);
      nets.get(n).push({c,i});
    });
  }
  const isDriver = ({c,i}) => (c.isOp && i===(c.outPinIdx??4)) || ((c.sym==='voltage'||c.sym==='current') && i===0);
  // Build signal net adjacency for cycle detection (2-terminal signal↔signal components only)
  const compEdges = new Map();
  for (const cc of comps) {
    if (!cc.inGraph || cc.nets.length !== 2 || cc.isOp) continue;
    const [n0, n1] = cc.nets;
    if (cls.get(n0)!=='signal' || cls.get(n1)!=='signal') continue;
    if (!compEdges.has(n0)) compEdges.set(n0, []);
    if (!compEdges.has(n1)) compEdges.set(n1, []);
    compEdges.get(n0).push({net:n1, via:cc});
    compEdges.get(n1).push({net:n0, via:cc});
  }
  const hasPath = (src, dst, excludeC) => {
    const visited = new Set([src]);
    const queue = [src];
    while (queue.length) {
      const cur = queue.shift();
      for (const {net:nb, via} of (compEdges.get(cur)||[])) {
        if (via === excludeC) continue;
        if (nb === dst) return true;
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
      }
    }
    return false;
  };
  const isLoopComp = c => {
    if (c.nets.length !== 2 || c.isOp) return false;
    const [n0, n1] = c.nets;
    // Signal↔signal: principled cycle detection (catches feedback cross-connects)
    if (cls.get(n0)==='signal' && cls.get(n1)==='signal')
      return hasPath(n0, n1, c);
    // Signal↔flag (shunt/bypass): depth-diff heuristic (preserves existing behaviour)
    return Math.abs((depth.get(n0)??0)-(depth.get(n1)??0)) >= 2;
  };
  let eid=0;
  for (const [n,pins] of nets){
    if (pins.length<2) continue;
    let a = pins.findIndex(isDriver); if (a<0) a=0;
    for (let k=0;k<pins.length;k++){
      if (k===a) continue;
      if ((opts.bridge || (SYMBOLS[pins[k].c.sym]&&SYMBOLS[pins[k].c.sym].synthetic)) && pins[k].c===pins[a].c){
        // same component on both ends: never a self-edge; route via another
        // pin if one exists, else bridge externally
        const other = pins.findIndex((q,z)=>z!==a && q.c!==pins[a].c);
        if (other>=0){
          const loop2 = isLoopComp(pins[other].c) || isLoopComp(pins[k].c);
          edges.push({ id:'e'+(eid++), netName:n,
            sources:[portId(pins[other].c,pins[other].i)], targets:[portId(pins[k].c,pins[k].i)],
            layoutOptions: loop2 ? {'elk.layered.priority.straightness':'0'} : {'elk.layered.priority.straightness':'10'} });
        } else bridges.push({c:pins[a].c, i:pins[a].i, j:pins[k].i});
        continue;
      }
      const loop = isLoopComp(pins[a].c) || isLoopComp(pins[k].c);
      edges.push({ id:'e'+(eid++), netName:n,
        sources:[portId(pins[a].c,pins[a].i)], targets:[portId(pins[k].c,pins[k].i)],
        layoutOptions: loop ? {'elk.layered.priority.straightness':'0'} : {'elk.layered.priority.straightness':'10'} });
    }
  }
  const graph = {
    id:'root',
    layoutOptions:{
      'elk.algorithm':'layered',
      'elk.direction':'RIGHT',
      'elk.spacing.nodeNode':String(Math.round(80*(opts.spacingX||1)/16)*16),
      'elk.layered.spacing.nodeNodeBetweenLayers':String(Math.round(64*(opts.spacingX||1)/16)*16),
      'elk.spacing.edgeNode':'32',
      'elk.spacing.edgeEdge':'16',
      'elk.layered.spacing.edgeEdgeBetweenLayers':'16',
      'elk.layered.spacing.edgeNodeBetweenLayers':'16',
      'elk.edgeRouting':'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX',
      'org.eclipse.elk.partitioning.activate':'true',
    },
    children, edges
  };
  return {graph, portId, bridges};
}
// ── End ELK graph construction ─────────────────────────────────────────────
