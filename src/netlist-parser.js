'use strict';
import { PREFIX2SYM, SYMBOLS, SUBCKT2SYM, resolveSub } from './symbols.js';
// ---------- netlist parser ----------
export function parseNetlist(text){
  const comps = [], directives = [];
  // join SPICE '+' continuation lines before parsing
  const joined = [];
  for (const ln of text.split(/\r?\n/)){
    if (/^\s*\+/.test(ln) && joined.length) joined[joined.length-1] += ' '+ln.replace(/^\s*\+/,' ');
    else joined.push(ln);
  }
  let insub = 0;   // inside a .subckt ... .ends definition body
  for (let i=0;i<joined.length;i++){
    let ln = joined[i].trim();
    if (!ln || ln.startsWith('*') || ln.startsWith(';')) continue;
    if (i===0) continue; // SPICE convention: first line is always title, always skip
    if (ln.startsWith('.')){
      if (/^\.subckt\b/i.test(ln)) insub++;
      else if (/^\.ends\b/i.test(ln)) insub = Math.max(0, insub-1);
      if (!/^\.end\b/i.test(ln)) directives.push(ln);
      continue;
    }
    // cards inside an inline .subckt body are part of the model DEFINITION,
    // not instances of this circuit: keep them as directives (so the emitted
    // schematic still carries the model and simulates) but never as comps.
    if (insub > 0){ console.info('netlist-parser: skipping subckt body line (insub='+insub+'): '+ln); directives.push(ln); continue; }
    const tok = ln.split(/\s+/);
    const name = tok[0], P = name[0].toUpperCase();
    if ('RCLVID'.includes(P)){
      const value = tok.slice(3).join(' ');
      comps.push({ name, sym: PREFIX2SYM[P], nets: [tok[1],tok[2]], value });
    } else if (P==='E' || P==='G'){
      // VCVS/VCCS: 4 nodes then gain/expression
      const nets=tok.slice(1,5);
      comps.push({ name, sym: P==='E'?'e':'g', nets, value: tok.slice(5).join(' ') });
    } else if (P==='F' || P==='H'){
      // CCCS/CCVS: 2 nodes then controlling source and gain
      const nets=tok.slice(1,3);
      comps.push({ name, sym: P==='F'?'f':'h', nets, value: tok.slice(3).join(' ') });
    } else if (P==='B'){
      // behavioral source: 2 nodes then V=/I= expression
      const nets=tok.slice(1,3);
      const expr=tok.slice(3).join(' ');
      comps.push({ name, sym: /^I\s*=/i.test(expr)?'bi':'bv', nets, value: expr });
    } else if (P==='S'){
      // voltage switch: out+ out- ctl+ ctl- model
      const nets=tok.slice(1,5);
      comps.push({ name, sym:'sw', nets, value: tok.slice(5).join(' ') });
    } else if (P==='W'){
      // current switch: 2 nodes, Vsense model
      const nets=tok.slice(1,3);
      comps.push({ name, sym:'csw', nets, value: tok.slice(3).join(' ') });
    } else if (P==='A'){
      // LTspice special-function device: 8 terminals, model, PARAM=VAL tail.
      // symbol pins map onto the 8 A-terminals via their SpiceOrder numbers
      const body=tok.slice(1);
      let mi=-1;
      for (let z=8; z<body.length; z++) if (!body[z].includes('=')){ mi=z; break; }
      if (mi<0 || body.length<9) throw new Error(name+': A-device model token missing');
      const nodes8=body.slice(0,8), model=body[mi];
      const alias={samplehold:'SpecialFunctions\\sample'};
      const q=model.toLowerCase();
      let sym = alias[q]
        || (SYMBOLS['Digital\\'+q] ? 'Digital\\'+q : null)
        || (SYMBOLS['SpecialFunctions\\'+q] ? 'SpecialFunctions\\'+q : null);
      if (!sym || !SYMBOLS[sym] || !SYMBOLS[sym].ord)
        throw new Error(name+': A-device symbol '+model+' not in table');
      const nets=SYMBOLS[sym].ord.map(o=>nodes8[o-1]);
      comps.push({ name, sym, nets, value: model+' '+body.slice(mi+1).join(' ') });
    } else if (P==='J'){
      // real JFETs have 3 nodes; a 2-node "J" is a renamed jumper/short
      const nets3=tok.slice(1,tok.length-1);
      if (tok.length-1-1===2 || (tok.length===3)){
        comps.push({ name, sym:'Misc\\jumper', nets:tok.slice(1,3), value:'' });
      } else {
        const model=tok[tok.length-1];
        const nets=tok.slice(1,tok.length-1);
        if (nets.length!==3) throw new Error(name+': JFET expects 3 nodes');
        const sym=/^p|pjf|2n54|lsj/i.test(model)?'pjf':'njf';
        comps.push({ name, sym, nets, value: model });
      }
    } else if (P==='T'){
      // lossless transmission line: 4 nodes then params
      const nets=tok.slice(1,5);
      comps.push({ name, sym:'tline', nets, value: tok.slice(5).join(' ') });
    } else if (P==='K'){
      directives.push(ln);   // coupling statement is schematic text
      continue;
    } else if (P==='Q' || P==='M'){
      let te = tok.length-1;
      while (te>1 && tok[te].includes('=')) te--;   // drop Tambient=.. tails
      const model = tok[te];
      const nodes = tok.slice(1, te);
      if (nodes.length!==3 && nodes.length!==4)
        throw new Error(name+': expected 3 or 4 nodes, got '+nodes.length);
      // netlists do not carry polarity; guess from the model name, default N-type
      const PNP=/pnp|2n3906|2n2907|2n5401|2n4403|bc327|bc32[78]|bc55[678]|bc85[678]|bc860|mmbt390?6|mmbt2907|tip3[02]|tip42|bd13[68]|bd140|s8550|ss8550/i;
      const PMOS=/pmos|irf9\d|irf954|si23\d|bss84|ao340[13]|irlml640[12]|fdn34[08]p|ndp6020p|zvp/i;
      const NPN=/npn|2n390[24]|2n222[29]|2n4401|2n5551|2n5089|bc54[789]|bc55[012]|bc337|bc817|bc84[678]|bc85[012]|mmbt390[24]|mmbt2222|tip3[13]|tip4[13]|bd13[579]|s9013|ss9013/i;
      const NMOS=/nmos|irf[1-8]\d\d|bs170|2n700[02]|ao340[02]|si230\d|irlml250\d|fqp|zvn|stp/i;
      let base;
      if (P==='Q') {
        if (PNP.test(model)) base='pnp';
        else if (NPN.test(model)) base='npn';
        else throw new Error(name+': cannot determine BJT polarity from model name "'+model+'" — model name must match a known NPN or PNP part');
      } else {
        if (PMOS.test(model)) base='pmos';
        else if (NMOS.test(model)) base='nmos';
        else throw new Error(name+': cannot determine MOSFET polarity from model name "'+model+'" — model name must match a known NMOS or PMOS part');
      }
      // LTspice exports 3-pin BJTs/MOSFETs with the bulk/substrate appended as
      // a 4th node tied to ground (Q) or source (M); collapse those back to
      // the standard 3-pin symbol instead of the 4-terminal variant
      let use = nodes;
      if (nodes.length===4 && ((P==='Q' && nodes[3]==='0') || (P==='M' && nodes[3]===nodes[2])))
        use = nodes.slice(0,3);
      const sym = base + (use.length===4?'4':'');
      if (!SYMBOLS[sym]) throw new Error(name+': no symbol '+sym);
      comps.push({ name, sym, nets: use, value: model });
    } else if (P==='X'){
      // subckt name = last non-param token; PARAM=VAL tails are kept in value
      let se = tok.length-1;
      while (se>1 && tok[se].includes('=')) se--;
      const sub = tok[se];
      const params = tok.slice(se+1).join(' ');
      const nets = tok.slice(1, se);
      let sym = resolveSub(sub, nets.length, params);
      if (!sym) throw new Error(name+': unknown subckt "'+sub+'" with '+nets.length+' pins — add it to symtable or define a .subckt body');
      if (SYMBOLS[sym].pins.length !== nets.length)
        throw new Error(name+': "'+sub+'" symbol has '+SYMBOLS[sym].pins.length+' pins, netlist gives '+nets.length);
      comps.push({ name, sym, nets, value: sub + (params?' '+params:'') });
    } else {
      // tolerant fallback: lines like "U1 in- inm vp vm out LT1002A"
      // (extractor netlists carry no X prefix); accept as X-card when the
      // last token resolves to a known symbol or a 5-pin opamp
      let se2 = tok.length-1;
      while (se2>1 && tok[se2].includes('=')) se2--;
      const sub = tok[se2];
      const params2 = tok.slice(se2+1).join(' ');
      const nets = tok.slice(1, se2);
      let sym = resolveSub(sub, nets.length, params2);
      if (!sym) throw new Error(name+': unknown subckt "'+sub+'" with '+nets.length+' pins — add it to symtable or define a .subckt body');
      if (sym && SYMBOLS[sym].pins.length===nets.length){
        comps.push({ name, sym, nets, value: sub + (params2?' '+params2:'') });
      } else if (tok.length>=3){
        // instance names don't always encode the element type: LTspice lets
        // any part be renamed (a resistor called ZA3, etc). For a two- or
        // three-terminal line whose value looks passive or is a crystal /
        // jumper, fall back to a sensible symbol by shape.
        const twoNets = tok.slice(1,3);
        const val = tok.slice(3).join(' ');
        if (/xtal|crystal|quartz/i.test(val) || /^Y/i.test(name))
          comps.push({ name, sym:'Misc\\xtal', nets:twoNets, value:val });
        else if (/jumper|short/i.test(val) || (twoNets.length===2 && !val))
          comps.push({ name, sym:'Misc\\jumper', nets:twoNets, value:val });
        else throw new Error('unsupported element: '+name+' — unknown instance prefix "'+name[0]+'" with value "'+val+'"');
      } else {
        // unknown instance prefix (Z, Y, ...): these are LTspice naming
        // variants of ordinary parts. Infer from node count: 2 nodes -> a
        // generic two-terminal (res body), so the net topology is preserved
        // even if the exact glyph is unknown.
        // nodes = leading tokens until the first value-looking token
        const body = tok.slice(1).filter(t2=>!t2.includes('='));
        let nEnd = body.length;
        for (let z=0; z<body.length; z++){
          if (/^[\d.{+-]/.test(body[z])){ nEnd=z; break; }
        }
        throw new Error('unsupported element: '+name+' — unknown instance prefix "'+name[0]+'" with '+nEnd+' apparent nodes');
      }
    }
  }
  return { comps, directives };
}
