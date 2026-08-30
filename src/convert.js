'use strict';
import { GRID, snap, rot, rotBBox } from './geometry.js';
import { SYMBOLS } from './symbols.js';
import { SAFE_MODES } from './safe-modes.js';
import { parseNetlist } from './netlist-parser.js';
import { classifyNets, isFlag, railLabel } from './classifier.js';
import { netDepths, decorateComponents } from './orientation.js';
import { buildElkGraph } from './layout.js';
import { _detectTopologies, _applyTopologyHints } from './topology.js';
import { routeWires } from './router.js?v=2';
import { resolveCollisions } from './place-repair.js';

import { emitAsc } from './renderer.js';
import { _mergeWires, _detectJunctions } from './wire-merge.js?v=3';
// PATCHED_V8_DYNAMIC_SUPPLY
// ---------- main ----------
export async function convert(text, opts){
  opts = opts || {};
  const { comps, directives } = parseNetlist(text);
  const cls = classifyNets(comps);
  const depth = netDepths(comps, cls);

  decorateComponents(comps, cls, depth);

  // feedback elements: a two-terminal whose nets are the input and output of
  // the SAME opamp is pulled out of the graph and placed above that opamp
  const opamps = comps.filter(c=>c.isOp);
  if (!opts.noFb) for (const c of comps){
    if (c.nets.length!==2 || c.isOp) continue;
    if (!(cls.get(c.nets[0])==='signal' && cls.get(c.nets[1])==='signal')) continue;
    for (const u of opamps){
      const inputIdxs = SYMBOLS[u.sym].pins.map((_,i)=>i).filter(i=>i!==u.outPinIdx);
      const inIdx = inputIdxs.find(i => u.nets[i]===c.nets[0] || u.nets[i]===c.nets[1]);
      if (inIdx===undefined) continue;
      const inNet = u.nets[inIdx];
      const other = (c.nets[0]===inNet) ? c.nets[1] : c.nets[0];
      if (other !== u.nets[u.outPinIdx]) continue;
      c.isFb = true; c.fbOf = u; c.fbInIdx = inIdx; c.fbInNet = inNet;
      c.rot = (c.nets[0]===inNet) ? 'R270' : 'R90'; // input-side pin on the left
      const S=SYMBOLS[c.sym];
      c.rpins = S.pins.map(p=>rot(p,c.rot));
      c.rbb = rotBBox(S.bbox,c.rot);
      for (const p of c.rpins){
        c.rbb[0]=Math.min(c.rbb[0],p[0]); c.rbb[1]=Math.min(c.rbb[1],p[1]);
        c.rbb[2]=Math.max(c.rbb[2],p[0]); c.rbb[3]=Math.max(c.rbb[3],p[1]);
      }
        c.inGraph = false;
      u.fbList = u.fbList||[]; u.fbList.push(c);
      break;
    }
  }
  // far feedback: two-terminal from an opamp's OUT net back to a lower-depth
  // upstream net (feedback across a whole stage, e.g. Sallen-Key C1);
  // stacked on tiers above the local feedback of that opamp
  if (!opts.noFar) for (const c of comps){
    if (c.isFb || c.nets.length!==2 || c.isOp) continue;
    if (!(cls.get(c.nets[0])==='signal' && cls.get(c.nets[1])==='signal')) continue;
    for (const u of opamps){
      const outIdx = c.nets.findIndex(n=>n===u.nets[u.outPinIdx]);
      if (outIdx<0) continue;
      const upNet = c.nets[1-outIdx];
      if ((depth.get(upNet)??99) >= (depth.get(u.nets[u.outPinIdx])??0)) continue;
      c.isFar = true; c.farOf = u; c.upNet = upNet;
      c.rot = (outIdx===1) ? 'R270' : 'R90';   // upstream pin on the left
      const S=SYMBOLS[c.sym];
      c.rpins = S.pins.map(p=>rot(p,c.rot));
      c.rbb = rotBBox(S.bbox,c.rot);
      for (const p of c.rpins){
        c.rbb[0]=Math.min(c.rbb[0],p[0]); c.rbb[1]=Math.min(c.rbb[1],p[1]);
        c.rbb[2]=Math.max(c.rbb[2],p[0]); c.rbb[3]=Math.max(c.rbb[3],p[1]);
      }
        c.inGraph = false;
      u.farList = u.farList||[]; u.farList.push(c);
      break;
    }
  }
  // divider ground/rail leg: two-terminal from an opamp's feedback input
  // net to gnd/rail, drawn horizontal in line with that input, flag at far end
  if (!opts.noLeg) for (const c of comps){
    if (c.isFb || c.nets.length!==2 || c.isOp) continue;
    const flagIdx = [0,1].find(i=>isFlag(cls.get(c.nets[i])));
    if (flagIdx===undefined) continue;
    const sigNet = c.nets[1-flagIdx];
    if (cls.get(sigNet)!=='signal') continue;
    for (const u of opamps){
      if (!u.fbList || !u.fbList.some(F=>F.fbInNet===sigNet)) continue;
      // slot left of the input must be free: no other in-graph pins on this net
      const others = comps.some(o=>o!==c && o!==u && o.inGraph && o.nets.includes(sigNet));
      if (others) break;
      c.isLeg = true; c.legOf = u;
      c.legInIdx = [0,1].find(i=>u.nets[i]===sigNet);
      c.rot = (flagIdx===0) ? 'R270' : 'R90';   // flag pin on the left
      const S=SYMBOLS[c.sym];
      c.rpins = S.pins.map(p=>rot(p,c.rot));
      c.rbb = rotBBox(S.bbox,c.rot);
      for (const p of c.rpins){
        c.rbb[0]=Math.min(c.rbb[0],p[0]); c.rbb[1]=Math.min(c.rbb[1],p[1]);
        c.rbb[2]=Math.max(c.rbb[2],p[0]); c.rbb[3]=Math.max(c.rbb[3],p[1]);
      }
        c.inGraph = false;
      u.legList = u.legList||[]; u.legList.push(c);
      break;
    }
  }
  // hangable shunt: one flag net, signal net has a real bus (>=2 other
  // in-graph pins); excluded from ELK and hung below the bus afterwards
  for (const c of comps){
    if (opts.noHang) break;
    if (c.isFb || c.isLeg || c.nets.length!==2 || c.isOp) continue;
    if (c.sym==='voltage' || c.sym==='current') continue;  // sources never hang
    const flagIdx = [0,1].find(i=>isFlag(cls.get(c.nets[i])));
    if (flagIdx===undefined) continue;
    const sigNet = c.nets[1-flagIdx];
    if (cls.get(sigNet)!=='signal') continue;
    const others = comps.filter(o=>o!==c && o.inGraph && !o.isFb && !o.isLeg && o.nets.includes(sigNet)).length;
    if (others>=1){ c.isHang=true; c.hangNet=sigNet; c.inGraph=false; }
  }
  // reserve corridors: above for feedback, left for divider legs
  for (const u of opamps){
    const tiers = (u.fbList?u.fbList.length:0) + (u.farList?u.farList.length:0);
    if (tiers){
      u.rbb[1] = Math.min(u.rbb[1], 32 - (176 + 80*(tiers-1)));
      u.rbb[2] = Math.max(u.rbb[2], 80);
      if (u.fbList && u.fbList.some(F=>F.fbInIdx===0)) u.rbb[0] = Math.min(u.rbb[0], -64);
    }
    if (u.legList) u.rbb[0] = Math.min(u.rbb[0], -160);
  }


  const {graph, portId, bridges} = buildElkGraph(comps, opts, cls, depth);

  // Singleton ELK instance — reuse Worker across calls; kill and recreate on timeout
  if (!convert._elk) convert._elk = new ELK();
  const elk = convert._elk;
  // Stage 3: detect analog topologies and hint ELK layout
  const _netlObj = {components: comps.map(c=>({name:c.name, type:(c.sym||'').charAt(0).toUpperCase(), nets:c.nets||[]}))};
  const _topos = _detectTopologies(_netlObj);
  if (_topos.length) { console.log('Topologies detected:', _topos.map(t=>t.type+':'+t.nodes.join('+'))); }
  _applyTopologyHints(graph, _topos);
  const out = await Promise.race([
    elk.layout(graph),
    new Promise((_,rej) => setTimeout(() => {
      if (typeof elk.terminateWorker === 'function') elk.terminateWorker();
      convert._elk = null; // force fresh instance next call
      rej(new Error('ELK layout timeout'));
    }, 7000))
  ]);

  // snap node positions; compute symbol origins and absolute pin coords
  const byName = new Map(comps.map(c=>[c.name,c]));
  for (const n of out.children){
    const c = byName.get(n.id);
    c.x = snap(n.x); c.y = snap(n.y);
    c.place = ()=>{
      c.origin = [c.x - c.rbb[0], c.y - c.rbb[1]];
      c.abs = c.rpins.map(p => [c.origin[0]+p[0], c.origin[1]+p[1]]);
      c.tips = c.rtips.map(p => [c.origin[0]+p[0], c.origin[1]+p[1]]);
    };
    c.place();
  }
  // nudge each opamp so its inverting (then noninverting) input row lines up
  // with the series element feeding it, letting the feeder enter dead straight
  for (const u of opamps.filter(u=>u.inGraph)){
    for (const inIdx of [1,0]){
      const pid = u.name+'.p'+inIdx;
      const e = (out.edges||[]).find(e=>e.targets[0]===pid);
      if (!e) continue;
      const src = comps.find(c=>c.inGraph && e.sources[0].startsWith(c.name+'.p'));
      if (!src || src.nets.length!==2) continue;
      const si = +e.sources[0].split('.p')[1];
      const delta = src.tips[si][1] - u.tips[inIdx][1];
      if (delta!==0 && Math.abs(delta)<=32 && delta%GRID===0){ u.y += delta; u.place(); }
      break;
    }
  }
  // series element Y-nudge: align series elements feeding opamp inputs
  for (const u of opamps.filter(u => u.inGraph)) {
    for (const inIdx of [0, 1]) {
      if (!u.tips || !u.tips[inIdx]) continue;
      const inTip = u.tips[inIdx];
      const partner = comps.find(c =>
        c.inGraph && c.nets.length === 2 && !c.isOp &&
        c.nets.includes(u.nets[inIdx])
      );
      if (!partner) continue;
      const pi = partner.nets.indexOf(u.nets[inIdx]);
      if (!partner.tips || !partner.tips[pi]) continue;
      const delta = partner.tips[pi][1] - inTip[1];
      if (delta !== 0 && Math.abs(delta) <= 48 && delta % GRID === 0) {
        partner.origin[1] -= delta;
        partner.abs = partner.rpins.map(p => [partner.origin[0]+p[0], partner.origin[1]+p[1]]);
        partner.tips = partner.rtips.map(p => [partner.origin[0]+p[0], partner.origin[1]+p[1]]);
        partner.y = partner.origin[1] + partner.rbb[1];
      }
    }
  }

  resolveCollisions(comps);
  const {wires, flags} = routeWires(comps, opamps, out.edges, portId, bridges, cls, opts);
  let asc = emitAsc(comps, wires, flags, directives);
  asc = _mergeWires(asc);
  asc = _detectJunctions(asc);
  return asc;
}
