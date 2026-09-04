import type { SymDef } from '../schematic-symbols';

// All 2-input gates: pins IN1=[-32,-12], IN2=[-32,12], OUT=[32,0]
// Single-input gates:  pins IN=[-32,0], OUT=[32,0]
// Prefix 'U', behavioral B-element emitted by netlist generator

export const LOGIC: Record<string, SymDef> = {
  AND2: {
    label:'AND', prefix:'U', group:'Logic',
    pins:[[-32,-12],[-32,12],[32,0]], pinNames:['IN1','IN2','OUT'],
    refOffset:[0,-26], valOffset:null,
    svg:`<line x1="-32" y1="-12" x2="-14" y2="-12"/>
<line x1="-32" y1="12" x2="-14" y2="12"/>
<polyline points="-14,-20 -14,20" fill="none"/>
<path d="M-14,-20 L6,-20 A20,20,0,0,1,6,20 L-14,20" fill="none"/>
<line x1="6" y1="0" x2="32" y2="0"/>`,
  },
  OR2: {
    label:'OR', prefix:'U', group:'Logic',
    pins:[[-32,-12],[-32,12],[32,0]], pinNames:['IN1','IN2','OUT'],
    refOffset:[0,-26], valOffset:null,
    svg:`<line x1="-32" y1="-12" x2="-16" y2="-12"/>
<line x1="-32" y1="12" x2="-16" y2="12"/>
<path d="M-20,-20 Q-6,-20 16,0 Q-6,20 -20,20 Q-10,0 -20,-20" fill="none"/>
<line x1="16" y1="0" x2="32" y2="0"/>`,
  },
  NAND2: {
    label:'NAND', prefix:'U', group:'Logic',
    pins:[[-32,-12],[-32,12],[32,0]], pinNames:['IN1','IN2','OUT'],
    refOffset:[0,-26], valOffset:null,
    svg:`<line x1="-32" y1="-12" x2="-14" y2="-12"/>
<line x1="-32" y1="12" x2="-14" y2="12"/>
<polyline points="-14,-20 -14,20" fill="none"/>
<path d="M-14,-20 L4,-20 A20,20,0,0,1,4,20 L-14,20" fill="none"/>
<circle cx="8" cy="0" r="4" fill="none"/>
<line x1="12" y1="0" x2="32" y2="0"/>`,
  },
  NOR2: {
    label:'NOR', prefix:'U', group:'Logic',
    pins:[[-32,-12],[-32,12],[32,0]], pinNames:['IN1','IN2','OUT'],
    refOffset:[0,-26], valOffset:null,
    svg:`<line x1="-32" y1="-12" x2="-16" y2="-12"/>
<line x1="-32" y1="12" x2="-16" y2="12"/>
<path d="M-20,-20 Q-6,-20 12,0 Q-6,20 -20,20 Q-10,0 -20,-20" fill="none"/>
<circle cx="16" cy="0" r="4" fill="none"/>
<line x1="20" y1="0" x2="32" y2="0"/>`,
  },
  XOR2: {
    label:'XOR', prefix:'U', group:'Logic',
    pins:[[-32,-12],[-32,12],[32,0]], pinNames:['IN1','IN2','OUT'],
    refOffset:[0,-26], valOffset:null,
    svg:`<line x1="-32" y1="-12" x2="-16" y2="-12"/>
<line x1="-32" y1="12" x2="-16" y2="12"/>
<path d="M-24,-20 Q-10,0 -24,20" fill="none"/>
<path d="M-20,-20 Q-6,-20 16,0 Q-6,20 -20,20 Q-10,0 -20,-20" fill="none"/>
<line x1="16" y1="0" x2="32" y2="0"/>`,
  },
  XNOR2: {
    label:'XNOR', prefix:'U', group:'Logic',
    pins:[[-32,-12],[-32,12],[32,0]], pinNames:['IN1','IN2','OUT'],
    refOffset:[0,-26], valOffset:null,
    svg:`<line x1="-32" y1="-12" x2="-16" y2="-12"/>
<line x1="-32" y1="12" x2="-16" y2="12"/>
<path d="M-24,-20 Q-10,0 -24,20" fill="none"/>
<path d="M-20,-20 Q-6,-20 12,0 Q-6,20 -20,20 Q-10,0 -20,-20" fill="none"/>
<circle cx="16" cy="0" r="4" fill="none"/>
<line x1="20" y1="0" x2="32" y2="0"/>`,
  },
  NOT: {
    label:'NOT', prefix:'U', group:'Logic',
    pins:[[-32,0],[32,0]], pinNames:['IN','OUT'],
    refOffset:[0,-26], valOffset:null,
    svg:`<line x1="-32" y1="0" x2="-20" y2="0"/>
<polyline points="-20,-16 -20,16 14,0 -20,-16" fill="none"/>
<circle cx="18" cy="0" r="4" fill="none"/>
<line x1="22" y1="0" x2="32" y2="0"/>`,
  },
  BUF: {
    label:'BUF', prefix:'U', group:'Logic',
    pins:[[-32,0],[32,0]], pinNames:['IN','OUT'],
    refOffset:[0,-26], valOffset:null,
    svg:`<line x1="-32" y1="0" x2="-20" y2="0"/>
<polyline points="-20,-16 -20,16 18,0 -20,-16" fill="none"/>
<line x1="18" y1="0" x2="32" y2="0"/>`,
  },
};

// Behavioral B-element expressions for logic gates (LTspice SPICE syntax)
// Threshold 2.5 V, output swing 0–5 V
export const LOGIC_BEXPR: Record<string, (i: string[]) => string> = {
  AND2:  ([a,b,o]) => `B${o} ${o} 0 V=${a}>2.5 & ${b}>2.5 ? 5 : 0`,
  OR2:   ([a,b,o]) => `B${o} ${o} 0 V=${a}>2.5 | ${b}>2.5 ? 5 : 0`,
  NAND2: ([a,b,o]) => `B${o} ${o} 0 V=${a}>2.5 & ${b}>2.5 ? 0 : 5`,
  NOR2:  ([a,b,o]) => `B${o} ${o} 0 V=${a}>2.5 | ${b}>2.5 ? 0 : 5`,
  XOR2:  ([a,b,o]) => `B${o} ${o} 0 V=V(${a})>2.5 ? (V(${b})>2.5 ? 0:5) : (V(${b})>2.5 ? 5:0)`,
  XNOR2: ([a,b,o]) => `B${o} ${o} 0 V=V(${a})>2.5 ? (V(${b})>2.5 ? 5:0) : (V(${b})>2.5 ? 0:5)`,
  NOT:   ([a,o])   => `B${o} ${o} 0 V=V(${a})>2.5 ? 0 : 5`,
  BUF:   ([a,o])   => `B${o} ${o} 0 V=V(${a})>2.5 ? 5 : 0`,
};
