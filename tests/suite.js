'use strict';
// ── Weave netlist→schematic test suite ────────────────────────────────────
// Run in browser console: await runSuite()
// Category filter:        await runSuite(true, 'BJT')
// Unit tests only:        await runUnitTests()

const SUITE = [

  // ── RESISTORS ─────────────────────────────────────────────────────────
  { cat:'Resistor', name:'voltage divider',
    net:`V1 vcc 0 5\nR1 vcc out 10k\nR2 out 0 10k\n.dc V1 0 5 0.1\n.end` },
  { cat:'Resistor', name:'series chain 3',
    net:`V1 in 0 AC 1\nR1 in n1 1k\nR2 n1 n2 2k\nR3 n2 0 3k\n.ac dec 10 1 1Meg\n.end` },
  { cat:'Resistor', name:'series chain 4',
    net:`V1 in 0 AC 1\nR1 in n1 1k\nR2 n1 n2 1k\nR3 n2 n3 1k\nR4 n3 0 1k\n.ac dec 10 1 1Meg\n.end` },
  { cat:'Resistor', name:'parallel pair',
    net:`V1 in 0 AC 1\nR1 in out 10k\nR2 in out 20k\nR3 out 0 5k\n.ac dec 10 1 1Meg\n.end` },
  { cat:'Resistor', name:'T-network',
    net:`V1 in 0 AC 1\nR1 in n1 1k\nR2 n1 out 1k\nR3 n1 0 2k\n.ac dec 10 1 1Meg\n.end` },
  { cat:'Resistor', name:'pi-network',
    net:`V1 in 0 AC 1\nR1 in 0 1k\nR2 in out 500\nR3 out 0 1k\n.ac dec 10 1 1Meg\n.end` },
  { cat:'Resistor', name:'Wheatstone bridge',
    net:`V1 vcc 0 5\nR1 vcc n1 1k\nR2 vcc n2 1k\nR3 n1 0 1k\nR4 n2 0 1.1k\nRg n1 n2 10k\n.dc V1 5 5 1\n.end` },

  // ── RC / RL / RLC ─────────────────────────────────────────────────────
  { cat:'RC/RL/RLC', name:'RC low-pass',
    net:`V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 10 1 1Meg\n.end` },
  { cat:'RC/RL/RLC', name:'RC high-pass',
    net:`V1 in 0 AC 1\nC1 in out 100n\nR1 out 0 1k\n.ac dec 10 1 1Meg\n.end` },
  { cat:'RC/RL/RLC', name:'RC integrator',
    net:`V1 in 0 PULSE(0 1 0 1n 1n 500u 1m)\nR1 in n1 10k\nC1 n1 0 100n\n.tran 2m\n.end` },
  { cat:'RC/RL/RLC', name:'RC differentiator',
    net:`V1 in 0 PULSE(0 1 0 1n 1n 500u 1m)\nC1 in n1 100n\nR1 n1 0 10k\n.tran 2m\n.end` },
  { cat:'RC/RL/RLC', name:'RL low-pass',
    net:`V1 in 0 AC 1\nR1 in out 100\nL1 out 0 1m\n.ac dec 10 1 100k\n.end` },
  { cat:'RC/RL/RLC', name:'RL high-pass',
    net:`V1 in 0 AC 1\nL1 in out 1m\nR1 out 0 100\n.ac dec 10 1 100k\n.end` },
  { cat:'RC/RL/RLC', name:'RLC series resonant',
    net:`V1 in 0 AC 1\nR1 in n1 10\nL1 n1 n2 1m\nC1 n2 0 100n\n.ac dec 10 100 1Meg\n.end` },
  { cat:'RC/RL/RLC', name:'RLC parallel resonant',
    net:`V1 in 0 AC 1\nR1 in out 1k\nL1 out 0 1m\nC1 out 0 100n\n.ac dec 10 100 1Meg\n.end` },
  { cat:'RC/RL/RLC', name:'two-pole RC ladder',
    net:`V1 in 0 AC 1\nR1 in n1 1k\nC1 n1 0 100n\nR2 n1 out 1k\nC2 out 0 100n\n.ac dec 10 1 1Meg\n.end` },

  // ── BJT ───────────────────────────────────────────────────────────────
  { cat:'BJT', name:'common-emitter amplifier',
    net:`V1 vcc 0 12\nV2 in 0 SINE(0 10m 1k) AC 1\nC1 in b 1u\nR1 vcc b 47k\nR2 b 0 10k\nRC vcc c 4.7k\nRE e 0 1k\nCE e 0 100u\nQ1 c b e 2N3904\n.tran 5m\n.end` },
  { cat:'BJT', name:'emitter follower',
    net:`V1 vcc 0 12\nV2 in 0 SINE(0 1 1k) AC 1\nR1 vcc b 47k\nR2 b 0 10k\nRE e 0 1k\nQ1 c b e 2N3904\n.tran 5m\n.end` },
  { cat:'BJT', name:'push-pull output stage',
    net:`V1 vcc 0 15\nV2 vee 0 -15\nV3 in 0 SINE(0 5 1k)\nQ1 vcc in out 2N3904\nQ2 vee in out 2N3906\nRL out 0 8\n.tran 2m\n.end` },
  { cat:'BJT', name:'current mirror',
    net:`V1 vcc 0 5\nIref vcc nb 1m\nQ1 nb nb 0 2N3904\nQ2 nb nb 0 2N3904\nRL vcc nc 1k\n.dc V1 5 5 1\n.end` },
  { cat:'BJT', name:'differential pair',
    net:`V1 vcc 0 12\nV2 vee 0 -12\nV3 in1 0 AC 1\nV4 in2 0 0\nRC1 vcc c1 5k\nRC2 vcc c2 5k\nRE vee e 2k\nQ1 c1 in1 e 2N3904\nQ2 c2 in2 e 2N3904\n.ac dec 10 1 1Meg\n.end` },
  { cat:'BJT', name:'cascode amplifier',
    net:`V1 vcc 0 15\nV2 in 0 AC 1\nR1 vcc b1 100k\nR2 b1 0 47k\nR3 vcc b2 47k\nR4 b2 0 22k\nRC vcc c2 4.7k\nRE e1 0 1k\nQ1 c1 b1 e1 2N3904\nQ2 c2 b2 c1 2N3904\n.ac dec 10 1 100k\n.end` },
  { cat:'BJT', name:'PNP common-emitter',
    net:`V1 vcc 0 12\nV2 in 0 AC 1\nR1 b 0 47k\nR2 vcc b 10k\nRC c 0 4.7k\nRE vcc e 1k\nQ1 c b e 2N3906\n.ac dec 10 1 100k\n.end` },
  { cat:'BJT', name:'4-terminal NPN (bulk pin collapse)',
    net:`V1 vcc 0 12\nR1 vcc c 4.7k\nRB b 0 100k\nQ1 c b e 0 2N3904\n.dc V1 12 12 1\n.end` },
  { cat:'BJT', name:'PARAM tail on Q line',
    net:`V1 vcc 0 12\nRC vcc c 4.7k\nRB b 0 100k\nQ1 c b e 2N3904 Tnom=27\n.dc V1 12 12 1\n.end` },

  // ── MOSFET ────────────────────────────────────────────────────────────
  { cat:'MOSFET', name:'NMOS common-source',
    net:`V1 vdd 0 5\nV2 vg 0 2.5\nRD vdd d 1k\nRS s 0 100\nM1 d vg s s NMOS\n.dc V2 0 5 0.1\n.end` },
  { cat:'MOSFET', name:'PMOS common-source',
    net:`V1 vdd 0 5\nV2 vg 0 2.5\nRD d 0 1k\nM1 d vg vdd vdd PMOS\n.dc V2 0 5 0.1\n.end` },
  { cat:'MOSFET', name:'CMOS inverter',
    net:`V1 vdd 0 3.3\nV2 in 0 PULSE(0 3.3 0 1n 1n 5n 10n)\nMP out in vdd vdd PMOS\nMN out in 0 0 NMOS\nCL out 0 1p\n.tran 20n\n.end` },
  { cat:'MOSFET', name:'NMOS source follower',
    net:`V1 vdd 0 5\nV2 vg 0 AC 1\nRS s 0 1k\nM1 vdd vg s s NMOS\n.ac dec 10 1 1Meg\n.end` },
  { cat:'MOSFET', name:'PMOS source follower',
    net:`V1 vdd 0 5\nV2 vg 0 AC 1\nRS 0 s 1k\nM1 0 vg s s PMOS\n.ac dec 10 1 1Meg\n.end` },

  // ── OP-AMP ────────────────────────────────────────────────────────────
  { cat:'Op-amp', name:'inverting amplifier',
    net:`V1 vcc 0 15\nV2 vee 0 -15\nV3 in 0 SINE(0 0.1 1k) AC 1\nR1 in inm 10k\nR2 inm out 100k\nXU1 0 inm vcc vee out OP27\n.tran 5m\n.end` },
  { cat:'Op-amp', name:'non-inverting amplifier',
    net:`V1 vcc 0 15\nV2 vee 0 -15\nV3 in 0 AC 1\nR1 0 inm 10k\nR2 inm out 90k\nXU1 in inm vcc vee out OP27\n.ac dec 10 1 10k\n.end` },
  { cat:'Op-amp', name:'voltage follower',
    net:`V1 vcc 0 15\nV2 vee 0 -15\nV3 in 0 AC 1\nXU1 in out vcc vee out OP27\n.ac dec 10 1 10k\n.end` },
  { cat:'Op-amp', name:'summing amplifier',
    net:`V1 vcc 0 15\nV2 vee 0 -15\nVa vin_a 0 AC 1\nVb vin_b 0 AC 1\nRa vin_a n1 10k\nRb vin_b n1 10k\nRf n1 out 100k\nXU1 0 n1 vcc vee out OP27\n.ac dec 10 1 1Meg\n.end` },
  { cat:'Op-amp', name:'difference amplifier',
    net:`V1 vcc 0 15\nV2 vee 0 -15\nVa vin1 0 AC 1\nVb vin2 0 AC 1\nR1 vin1 n1 10k\nR2 vin2 n2 10k\nR3 n2 0 10k\nRf n1 out 10k\nXU1 n2 n1 vcc vee out OP27\n.ac dec 10 1 1Meg\n.end` },
  { cat:'Op-amp', name:'integrator',
    net:`V1 vcc 0 15\nV2 vee 0 -15\nV3 in 0 PULSE(0 1 0 1n 1n 5u 10u)\nR1 in inm 10k\nCf inm out 100n\nXU1 0 inm vcc vee out OP27\n.tran 50u\n.end` },
  { cat:'Op-amp', name:'differentiator',
    net:`V1 vcc 0 15\nV2 vee 0 -15\nV3 in 0 SINE(0 1 1k)\nCin in inm 100n\nRf inm out 10k\nXU1 0 inm vcc vee out OP27\n.tran 5m\n.end` },
  { cat:'Op-amp', name:'Sallen-Key LPF',
    net:`V1 vcc 0 15\nV2 vee 0 -15\nV3 in 0 AC 1\nR1 in n1 11.3k\nR2 n1 n2 11.3k\nC1 n1 out 20n\nC2 n2 0 10n\nXU1 n2 inm vcc vee out OP27\nR3 inm out 1\n.ac dec 100 10 100k\n.end` },
  { cat:'Op-amp', name:'instrumentation amplifier',
    net:`V1 vcc 0 15\nV2 vee 0 -15\nV3 vin1 0 SINE(0 10m 1k)\nV4 vin2 0 SINE(0 11m 1k)\nR1 0 n1 10k\nR2 n1 out1 90k\nR3 out1 n2 90k\nR4 n2 out 10k\nXU1 vin1 n1 vcc vee out1 OP27\nXU2 vin2 n2 vcc vee out OP27\n.tran 5m\n.end` },
  { cat:'Op-amp', name:'comparator with hysteresis',
    net:`V1 vcc 0 5\nV2 in 0 SINE(0 2.5 1k)\nVref ref 0 2.5\nR1 vcc out 10k\nRh out inp 100k\nRd inp ref 10k\nXU1 inp in vcc 0 out OP27\n.tran 5m\n.end` },
  { cat:'Op-amp', name:'Wien bridge oscillator',
    net:`V1 vcc 0 15\nV2 vee 0 -15\nR1 in n1 10k\nC1 n1 out 16n\nR2 n1 0 10k\nC2 in 0 16n\nRf out inm 29k\nRg inm 0 10k\nXU1 n1 inm vcc vee out OP27\n.tran 1m\n.end` },

  // ── DIODE ─────────────────────────────────────────────────────────────
  { cat:'Diode', name:'half-wave rectifier',
    net:`V1 in 0 SINE(0 5 60)\nD1 in out 1N4148\nRL out 0 1k\n.tran 50m\n.end` },
  { cat:'Diode', name:'full-wave bridge rectifier',
    net:`V1 in 0 SINE(0 12 60)\nD1 in p 1N4148\nD2 n in 1N4148\nD3 0 p 1N4148\nD4 n 0 1N4148\nRL p n 1k\n.tran 50m\n.end` },
  { cat:'Diode', name:'clamp circuit',
    net:`V1 in 0 SINE(0 5 1k)\nD1 in out 1N4148\nC1 out 0 10u\nRL out 0 10k\n.tran 5m\n.end` },

  // ── JFET ──────────────────────────────────────────────────────────────
  { cat:'JFET', name:'N-JFET common-source',
    net:`V1 vdd 0 12\nV2 vg 0 -1\nRD vdd d 4.7k\nRS s 0 1k\nJ1 d vg s 2N5457\n.dc V2 -3 0 0.1\n.end` },

  // ── CONTROLLED SOURCES ────────────────────────────────────────────────
  { cat:'Controlled sources', name:'VCVS (E)',
    net:`V1 in 0 AC 1\nR1 in 0 1k\nE1 out 0 in 0 10\nRL out 0 1k\n.ac dec 10 1 1Meg\n.end` },
  { cat:'Controlled sources', name:'VCCS (G)',
    net:`V1 in 0 AC 1\nR1 in 0 1k\nG1 out 0 in 0 0.01\nRL out 0 1k\n.ac dec 10 1 1Meg\n.end` },
  { cat:'Controlled sources', name:'CCCS (F)',
    net:`V1 in 0 AC 1\nVsense in n1 0\nR1 n1 0 1k\nF1 out 0 Vsense 50\nRL out 0 1k\n.ac dec 10 1 1Meg\n.end` },
  { cat:'Controlled sources', name:'CCVS (H)',
    net:`V1 in 0 AC 1\nVsense in n1 0\nR1 n1 0 1k\nH1 out 0 Vsense 1k\nRL out 0 1k\n.ac dec 10 1 1Meg\n.end` },

  // ── BEHAVIORAL SOURCE ─────────────────────────────────────────────────
  { cat:'Behavioral', name:'voltage behavioral source (B/V=)',
    net:`V1 in 0 AC 1\nR1 in n1 1k\nB1 out 0 V=V(n1)*2\nRL out 0 1k\n.ac dec 10 1 1Meg\n.end` },

  // ── MISC / EDGE CASES ─────────────────────────────────────────────────
  { cat:'Misc', name:'no sim directive - RC',
    net:`V1 vin 0 1\nR1 vin n1 1k\nR2 n1 0 1k\nC1 n1 0 1n\n.end` },
  { cat:'Misc', name:'no sim directive - RC chain',
    net:`V1 in 0 1\nR1 in n1 1k\nR2 n1 n2 1k\nC1 n2 0 100n\n.end` },
  { cat:'Misc', name:'current source load',
    net:`V1 vcc 0 5\nI1 vcc out 1m\nR1 out 0 1k\nC1 out 0 100n\n.tran 1m\n.end` },
  { cat:'Misc', name:'LT1004 shunt reference',
    net:`XU1 OUT 0 LT1004-1.2\nR1 OUT N001 36K\nV1 N001 0 PULSE(0 5 100u 10n 10n 500u 1)\n.tran 700u\n.end` },
  { cat:'Misc', name:'continuation line (+)',
    net:`V1 vcc 0 5\nR1 vcc\n+ n1 10k\nR2 n1 0 10k\n.dc V1 0 5 0.1\n.end` },
  { cat:'Misc', name:'mixed case component names',
    net:`v1 VCC 0 5\nr1 VCC out 10K\nr2 OUT 0 10K\n.dc v1 0 5 0.1\n.end` },
  { cat:'Misc', name:'pathological star topology (SAFE_MODES stress)',
    net:`V1 vcc 0 5\nR1 vcc h 1k\nR2 h a 1k\nR3 h b 1k\nR4 h c 1k\nR5 h d 1k\nR6 h e 1k\nR7 h f 1k\nR8 a 0 1k\nR9 b 0 1k\nR10 c 0 1k\nR11 d 0 1k\nR12 e 0 1k\nR13 f 0 1k\n.dc V1 0 5 0.1\n.end` },

];

// ── Output quality checks ─────────────────────────────────────────────────────
function _checkGrid(asc) {
  const errs = [];
  for (const ln of asc.split(/\r?\n/)) {
    const t = ln.trim().split(/\s+/);
    if (t[0]==='SYMBOL' && t.length>=4) {
      const x=parseInt(t[2]),y=parseInt(t[3]);
      if (x%16!==0) errs.push(`SYMBOL ${t[1]} x=${x} not on 16-grid`);
      if (y%16!==0) errs.push(`SYMBOL ${t[1]} y=${y} not on 16-grid`);
    }
    if (t[0]==='WIRE' && t.length>=5) {
      const cs=t.slice(1,5).map(Number);
      for (const v of cs) if (v%16!==0) { errs.push(`WIRE coord ${v} not on 16-grid`); break; }
    }
  }
  return errs;
}

function _checkOverlap(asc) {
  const seen=new Map(), errs=[];
  for (const ln of asc.split(/\r?\n/)) {
    const t=ln.trim().split(/\s+/);
    if (t[0]==='SYMBOL' && t.length>=4) {
      const k=t[2]+','+t[3];
      if (seen.has(k)) errs.push(`overlap at (${t[2]},${t[3]}): ${seen.get(k)} and ${t[1]}`);
      else seen.set(k,t[1]);
    }
  }
  return errs;
}

function _checkZeroLengthWires(asc) {
  const errs=[];
  for (const ln of asc.split(/\r?\n/)) {
    const t=ln.trim().split(/\s+/);
    if (t[0]==='WIRE' && t.length>=5 && t[1]===t[3] && t[2]===t[4])
      errs.push(`zero-length wire at (${t[1]},${t[2]})`);
  }
  return errs;
}

function _checkDuplicateWires(asc) {
  const seen=new Set(), errs=[];
  for (const ln of asc.split(/\r?\n/)) {
    const t=ln.trim().split(/\s+/);
    if (t[0]==='WIRE' && t.length>=5) {
      const [x1,y1,x2,y2]=t.slice(1,5).map(Number);
      const k=(x1<x2||(x1===x2&&y1<=y2))?`${x1},${y1},${x2},${y2}`:`${x2},${y2},${x1},${y1}`;
      if (seen.has(k)) errs.push(`duplicate wire ${k}`); else seen.add(k);
    }
  }
  return errs;
}

function _checkBoundingBox(asc) {
  const LIMIT=50000, errs=[];
  for (const ln of asc.split(/\r?\n/)) {
    const t=ln.trim().split(/\s+/);
    if (t[0]==='SYMBOL' && t.length>=4) {
      for (const v of [parseInt(t[2]),parseInt(t[3])])
        if (Math.abs(v)>LIMIT) { errs.push(`coord ${v} exceeds ±${LIMIT}`); break; }
    }
    if (t[0]==='WIRE' && t.length>=5) {
      for (const v of t.slice(1,5).map(Number))
        if (Math.abs(v)>LIMIT) { errs.push(`coord ${v} exceeds ±${LIMIT}`); break; }
    }
  }
  return errs;
}

function _checkWireCount(asc) {
  const wires=asc.split(/\r?\n/).filter(l=>l.trim().toUpperCase().startsWith('WIRE ')).length;
  const syms=asc.split(/\r?\n/).filter(l=>l.trim().toUpperCase().startsWith('SYMBOL ')).length;
  const limit=Math.max(syms*15,30);
  return wires>limit ? [`excessive wires: ${wires} for ${syms} symbols (limit ${limit})`] : [];
}

function _timeout(ms) {
  return new Promise((_,reject)=>setTimeout(()=>reject(new Error(`timed out after ${ms}ms`)),ms));
}

async function runTest(t) {
  const t0=performance.now();
  try {
    const asc=await Promise.race([convert(t.net),_timeout(8000)]);
    const ms=Math.round(performance.now()-t0);
    const errs=[
      ...compare(t.net,asc),
      ..._checkGrid(asc),
      ..._checkOverlap(asc),
      ..._checkZeroLengthWires(asc),
      ..._checkDuplicateWires(asc),
      ..._checkBoundingBox(asc),
      ..._checkWireCount(asc),
    ];
    return { cat:t.cat, name:t.name, status:errs.length?'WARN':'PASS', errors:errs, ms };
  } catch(e) {
    return { cat:t.cat, name:t.name, status:'FAIL', errors:[e.message], ms:Math.round(performance.now()-t0) };
  }
}

// ── Unit tests ────────────────────────────────────────────────────────────────
async function runUnitTests(verbose=true) {
  const results=[];
  function push(cat,name,ok,detail) {
    results.push({cat,name,status:ok?'PASS':'FAIL',errors:ok?[]:[detail],ms:0});
    if(verbose) console.log((ok?'✓':'✗')+` [${cat}] ${name}`+(ok?'':' → '+detail));
  }

  // Wire merge
  (()=>{
    const asc=['Version 4','WIRE 0 0 32 0','WIRE 32 0 64 0','WIRE 64 0 96 0'].join('\n');
    const w=_mergeWires(asc).split('\n').filter(l=>l.trim().toUpperCase().startsWith('WIRE '));
    push('Unit/merge','collinear collapse',w.length===1&&w[0].includes('0 0 96 0'),'got: '+w.join('; '));
  })();
  (()=>{
    const asc=['Version 4','WIRE 0 0 32 0','WIRE 48 0 96 0'].join('\n');
    const w=_mergeWires(asc).split('\n').filter(l=>l.trim().toUpperCase().startsWith('WIRE '));
    push('Unit/merge','gap prevents merge',w.length===2,'expected 2 wires, got '+w.length);
  })();
  (()=>{
    const asc=['Version 4','WIRE 32 0 32 48','WIRE 32 48 32 96'].join('\n');
    const w=_mergeWires(asc).split('\n').filter(l=>l.trim().toUpperCase().startsWith('WIRE '));
    push('Unit/merge','vertical collinear collapse',w.length===1&&w[0].includes('32 0 32 96'),'got: '+w.join('; '));
  })();

  // Junction detection
  (()=>{
    const asc=['Version 4','WIRE 0 32 32 32','WIRE 32 0 32 64'].join('\n');
    const out=_detectJunctions(_mergeWires(asc));
    const hasJ=out.split('\n').some(l=>l.trim().toUpperCase().startsWith('JUNCTION 32 32'));
    push('Unit/junction','T-branch emits JUNCTION',hasJ,'JUNCTION 32 32 not found');
  })();
  (()=>{
    const asc=['Version 4','WIRE 0 0 32 0','WIRE 32 0 64 0'].join('\n');
    const out=_detectJunctions(_mergeWires(asc));
    const hasJ=out.split('\n').some(l=>l.trim().toUpperCase().startsWith('JUNCTION'));
    push('Unit/junction','straight-through no JUNCTION',!hasJ,'unexpected JUNCTION emitted');
  })();

  // Wire quality checks
  (()=>{
    const errs=_checkZeroLengthWires('WIRE 32 32 32 32');
    push('Unit/checks','zero-length wire detected',errs.length>0,'expected error');
  })();
  (()=>{
    const errs=_checkDuplicateWires('WIRE 0 0 32 0\nWIRE 0 0 32 0');
    push('Unit/checks','duplicate wire detected',errs.length>0,'expected error');
  })();
  (()=>{
    const errs=_checkDuplicateWires('WIRE 0 0 32 0\nWIRE 32 0 0 0');
    push('Unit/checks','reversed duplicate detected',errs.length>0,'expected error for reversed dup');
  })();

  // Parser unit tests
  (()=>{
    try {
      const r=parseNetlist('');
      push('Unit/parser','empty netlist',Array.isArray(r.comps)&&r.comps.length===0,'comps: '+JSON.stringify(r.comps));
    } catch(e) { push('Unit/parser','empty netlist',false,'threw: '+e.message); }
  })();
  (()=>{
    try {
      const r=parseNetlist('My Circuit Title\nR1 in out 1k\nV1 in 0 1\n.end');
      push('Unit/parser','title line skipped',!r.comps.some(c=>c.name==='My'),'leaked: '+JSON.stringify(r.comps[0]));
    } catch(e) { push('Unit/parser','title line skipped',false,'threw: '+e.message); }
  })();
  (()=>{
    const net=['Test','+ continuation','R1 vcc\n+ n1 10k','V1 vcc 0 1','.end'].join('\n');
    try {
      const r=parseNetlist('Test\nR1 vcc\n+ n1 10k\nV1 vcc 0 1\n.end');
      const r1=r.comps.find(c=>c.name==='R1');
      push('Unit/parser','+ continuation joins nets',r1&&r1.nets[0]==='vcc'&&r1.nets[1]==='n1','nets: '+JSON.stringify(r1&&r1.nets));
    } catch(e) { push('Unit/parser','+ continuation joins nets',false,'threw: '+e.message); }
  })();
  (()=>{
    try {
      const r=parseNetlist([
        'Test subckt skip',
        '.subckt myblock in out',
        'R1 in out 1k',
        '.ends myblock',
        'V1 vin 0 1',
        'Rx vin 0 10k',
        '.end'
      ].join('\n'));
      push('Unit/parser','subckt body skipped',!r.comps.some(c=>c.name==='R1'),'leaked: '+r.comps.map(c=>c.name).join(','));
    } catch(e) { push('Unit/parser','subckt body skipped',false,'threw: '+e.message); }
  })();
  (()=>{
    try {
      const r=parseNetlist('Test\nr1 VCC OUT 10K\nv1 VCC 0 5\n.end');
      push('Unit/parser','mixed case parsed',!!r.comps.find(c=>c.name&&c.name.toUpperCase()==='R1'),'comps: '+JSON.stringify(r.comps.map(c=>c.name)));
    } catch(e) { push('Unit/parser','mixed case parsed',false,'threw: '+e.message); }
  })();
  (()=>{
    try {
      const r=parseNetlist('Test\nQ1 c b e 0 2N3904\nV1 vcc 0 5\n.end');
      const q=r.comps.find(c=>c.name==='Q1');
      push('Unit/parser','4-terminal BJT collapses to 3 nets',q&&q.nets.length===3,'nets: '+JSON.stringify(q&&q.nets));
    } catch(e) { push('Unit/parser','4-terminal BJT collapses to 3 nets',false,'threw: '+e.message); }
  })();
  (()=>{
    try {
      const r=parseNetlist('Test\nQ1 c b e 2N3904 Tnom=27\nV1 vcc 0 5\n.end');
      const q=r.comps.find(c=>c.name==='Q1');
      push('Unit/parser','PARAM= tail stripped',q&&q.nets.length===3&&!q.nets.includes('Tnom=27'),'nets: '+JSON.stringify(q&&q.nets));
    } catch(e) { push('Unit/parser','PARAM= tail stripped',false,'threw: '+e.message); }
  })();

  return results;
}

// ── Round-trip tests ──────────────────────────────────────────────────────────
async function runRoundTripTests(verbose=true) {
  const results=[];
  const subset=SUITE.filter(t=>
    (t.cat==='Resistor'&&t.name==='voltage divider')||
    (t.cat==='RC/RL/RLC'&&t.name==='RC low-pass')||
    (t.cat==='BJT'&&t.name==='emitter follower')||
    (t.cat==='MOSFET'&&t.name==='CMOS inverter')
  );
  for (const t of subset) {
    const t0=performance.now();
    try {
      const asc=await Promise.race([convert(t.net),_timeout(8000)]);
      const netBack=window.asc2net?window.asc2net(asc):null;
      const ms=Math.round(performance.now()-t0);
      if (!netBack) {
        results.push({cat:'Round-trip',name:t.name,status:'WARN',ms,errors:['_asc2net not available']});
        if(verbose) console.log('⚠ [Round-trip] '+t.name+' → _asc2net not available');
        continue;
      }
      const errs=compare(netBack,asc);
      results.push({cat:'Round-trip',name:t.name,status:errs.length?'WARN':'PASS',errors:errs,ms});
      if(verbose) console.log((errs.length?'⚠':'✓')+' [Round-trip] '+t.name+(errs.length?' → '+errs[0]:'')+' '+ms+'ms');
    } catch(e) {
      results.push({cat:'Round-trip',name:t.name,status:'FAIL',errors:[e.message],ms:Math.round(performance.now()-t0)});
      if(verbose) console.log('✗ [Round-trip] '+t.name+' → '+e.message);
    }
  }
  return results;
}

// ── Main runner ───────────────────────────────────────────────────────────────
async function runSuite(verbose=true, catFilter=null) {
  const results=[];
  const suite=catFilter?SUITE.filter(t=>t.cat===catFilter):SUITE;
  for (const t of suite) {
    const r=await runTest(t);
    results.push(r);
    if(verbose) {
      const icon=r.status==='PASS'?'✓':r.status==='WARN'?'⚠':'✗';
      const slow=r.ms>2000?` ⏱${r.ms}ms`:'';
      console.log(`${icon} [${r.cat}] ${r.name}${slow}${r.errors.length?' → '+r.errors[0]:''}`);
    }
  }
  if (!catFilter) {
    results.push(...await runUnitTests(verbose));
    results.push(...await runRoundTripTests(verbose));
  }
  const pass=results.filter(r=>r.status==='PASS').length;
  const warn=results.filter(r=>r.status==='WARN').length;
  const fail=results.filter(r=>r.status==='FAIL').length;
  const slow=results.filter(r=>r.ms>2000).length;
  console.log(`\n${pass}/${results.length} PASS  ${warn} WARN  ${fail} FAIL${slow?' '+slow+' SLOW':''}`);
  return results;
}
