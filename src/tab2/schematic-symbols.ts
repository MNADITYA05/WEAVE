/**
 * schematic-symbols.ts — SVG symbol definitions for the canvas schematic editor
 *
 * Each entry: label, prefix, group, pins (R0 coords relative to origin, SPICE order),
 * pinNames, netName (power flags only), refOffset, valOffset, svg → HTML string
 */

export interface SymDef {
  label:     string;
  prefix:    string;
  group:     string;
  pins:      [number, number][];
  pinNames:  string[];
  netName?:  string;
  refOffset: [number, number] | null;
  valOffset: [number, number] | null;
  svg:       string;
}

export const SYMDEFS: Record<string, SymDef> = {
  // ── PASSIVES ──────────────────────────────────────────────────────────────
  R: {
    label:'Resistor', prefix:'R', group:'Passives',
    pins:[[0,-32],[0,32]], pinNames:['p','n'],
    refOffset:[12,-4], valOffset:[12,14],
    svg:`<line x1="0" y1="-32" x2="0" y2="-20"/>
<polyline points="0,-20 9,-16 -9,-8 9,0 -9,8 0,12" fill="none"/>
<line x1="0" y1="12" x2="0" y2="32"/>`,
  },
  C: {
    label:'Capacitor', prefix:'C', group:'Passives',
    pins:[[0,-24],[0,24]], pinNames:['p','n'],
    refOffset:[14,-2], valOffset:[14,12],
    svg:`<line x1="0" y1="-24" x2="0" y2="-5"/>
<line x1="-12" y1="-5" x2="12" y2="-5"/>
<line x1="-12" y1="5" x2="12" y2="5"/>
<line x1="0" y1="5" x2="0" y2="24"/>`,
  },
  L: {
    label:'Inductor', prefix:'L', group:'Passives',
    pins:[[0,-32],[0,32]], pinNames:['p','n'],
    refOffset:[14,-4], valOffset:[14,14],
    svg:`<line x1="0" y1="-32" x2="0" y2="-24"/>
<path d="M0,-24 A8,8,0,0,1,0,-8 A8,8,0,0,1,0,8 A8,8,0,0,1,0,24" fill="none"/>
<line x1="0" y1="24" x2="0" y2="32"/>`,
  },
  K: {
    label:'Coupling', prefix:'K', group:'Passives',
    pins:[], pinNames:[],
    refOffset:[6,-20], valOffset:[6,20],
    svg:`<rect x="-14" y="-18" width="28" height="36" fill="none" stroke-dasharray="4,3"/>
<text x="0" y="5" text-anchor="middle" font-size="11" fill="currentColor">K</text>`,
  },
  // ── SOURCES ───────────────────────────────────────────────────────────────
  V: {
    label:'Voltage Src', prefix:'V', group:'Sources',
    pins:[[0,-32],[0,32]], pinNames:['p','n'],
    refOffset:[23,0], valOffset:[23,14],
    svg:`<line x1="0" y1="-32" x2="0" y2="-20"/>
<circle cx="0" cy="0" r="20" fill="none"/>
<line x1="0" y1="-13" x2="0" y2="-7"/>
<line x1="-3" y1="-10" x2="3" y2="-10"/>
<line x1="-3" y1="10" x2="3" y2="10"/>
<line x1="0" y1="20" x2="0" y2="32"/>`,
  },
  I: {
    label:'Current Src', prefix:'I', group:'Sources',
    pins:[[0,-32],[0,32]], pinNames:['p','n'],
    refOffset:[23,0], valOffset:[23,14],
    svg:`<line x1="0" y1="-32" x2="0" y2="-20"/>
<circle cx="0" cy="0" r="20" fill="none"/>
<line x1="0" y1="-13" x2="0" y2="10"/>
<polyline points="-5,2 0,10 5,2" fill="none"/>
<line x1="0" y1="20" x2="0" y2="32"/>`,
  },
  E: {
    label:'VCVS (E)', prefix:'E', group:'Sources',
    pins:[[0,-32],[0,32],[-32,-16],[-32,16]], pinNames:['p','n','cp','cn'],
    refOffset:[23,0], valOffset:[23,14],
    svg:`<line x1="0" y1="-32" x2="0" y2="-20"/>
<circle cx="0" cy="0" r="20" fill="none"/>
<line x1="0" y1="-13" x2="0" y2="-7"/>
<line x1="-3" y1="-10" x2="3" y2="-10"/>
<line x1="-3" y1="10" x2="3" y2="10"/>
<line x1="0" y1="20" x2="0" y2="32"/>
<line x1="-32" y1="-16" x2="-20" y2="-16"/>
<line x1="-32" y1="16" x2="-20" y2="16"/>
<text x="-28" y="-19" font-size="8" fill="currentColor">+</text>
<text x="-28" y="23" font-size="8" fill="currentColor">−</text>`,
  },
  G: {
    label:'VCCS (G)', prefix:'G', group:'Sources',
    pins:[[0,-32],[0,32],[-32,-16],[-32,16]], pinNames:['p','n','cp','cn'],
    refOffset:[23,0], valOffset:[23,14],
    svg:`<line x1="0" y1="-32" x2="0" y2="-20"/>
<circle cx="0" cy="0" r="20" fill="none"/>
<line x1="0" y1="-13" x2="0" y2="10"/>
<polyline points="-5,2 0,10 5,2" fill="none"/>
<line x1="0" y1="20" x2="0" y2="32"/>
<line x1="-32" y1="-16" x2="-20" y2="-16"/>
<line x1="-32" y1="16" x2="-20" y2="16"/>
<text x="-28" y="-19" font-size="8" fill="currentColor">+</text>
<text x="-28" y="23" font-size="8" fill="currentColor">−</text>`,
  },
  F: {
    label:'CCCS (F)', prefix:'F', group:'Sources',
    pins:[[0,-32],[0,32]], pinNames:['p','n'],
    refOffset:[23,0], valOffset:[23,14],
    svg:`<line x1="0" y1="-32" x2="0" y2="-20"/>
<circle cx="0" cy="0" r="20" fill="none"/>
<line x1="0" y1="-13" x2="0" y2="10"/>
<polyline points="-5,2 0,10 5,2" fill="none"/>
<text x="-6" y="-14" font-size="9" fill="currentColor">F</text>
<line x1="0" y1="20" x2="0" y2="32"/>`,
  },
  H: {
    label:'CCVS (H)', prefix:'H', group:'Sources',
    pins:[[0,-32],[0,32]], pinNames:['p','n'],
    refOffset:[23,0], valOffset:[23,14],
    svg:`<line x1="0" y1="-32" x2="0" y2="-20"/>
<circle cx="0" cy="0" r="20" fill="none"/>
<line x1="0" y1="-13" x2="0" y2="-7"/>
<line x1="-3" y1="-10" x2="3" y2="-10"/>
<line x1="-3" y1="10" x2="3" y2="10"/>
<text x="-6" y="-14" font-size="9" fill="currentColor">H</text>
<line x1="0" y1="20" x2="0" y2="32"/>`,
  },
  B: {
    label:'Behavioral (B)', prefix:'B', group:'Sources',
    pins:[[0,-32],[0,32]], pinNames:['p','n'],
    refOffset:[23,0], valOffset:[23,14],
    svg:`<line x1="0" y1="-32" x2="0" y2="-20"/>
<circle cx="0" cy="0" r="20" fill="none"/>
<text x="0" y="5" text-anchor="middle" font-size="13" fill="currentColor">B</text>
<line x1="0" y1="20" x2="0" y2="32"/>`,
  },
  // ── SEMICONDUCTORS ────────────────────────────────────────────────────────
  D: {
    label:'Diode', prefix:'D', group:'Semis',
    pins:[[0,-24],[0,24]], pinNames:['A','K'],
    refOffset:[14,-2], valOffset:[14,14],
    svg:`<line x1="0" y1="-24" x2="0" y2="-10"/>
<polyline points="-10,-10 10,-10 0,10 -10,-10" fill="none"/>
<line x1="-10" y1="10" x2="10" y2="10"/>
<line x1="0" y1="10" x2="0" y2="24"/>`,
  },
  Q_NPN: {
    label:'NPN BJT', prefix:'Q', group:'Semis',
    pins:[[0,-32],[-32,0],[0,32]], pinNames:['C','B','E'],
    refOffset:[10,-36], valOffset:[10,38],
    svg:`<line x1="-32" y1="0" x2="-14" y2="0"/>
<line x1="-14" y1="-24" x2="-14" y2="24"/>
<line x1="-14" y1="-14" x2="0" y2="-32"/>
<line x1="-14" y1="14" x2="0" y2="32"/>
<polyline points="-4,26 0,32 -8,30" fill="none"/>
<line x1="0" y1="-32" x2="0" y2="-28"/>
<line x1="0" y1="28" x2="0" y2="32"/>`,
  },
  Q_PNP: {
    label:'PNP BJT', prefix:'Q', group:'Semis',
    pins:[[0,32],[-32,0],[0,-32]], pinNames:['C','B','E'],
    refOffset:[10,-36], valOffset:[10,38],
    svg:`<line x1="-32" y1="0" x2="-14" y2="0"/>
<line x1="-14" y1="-24" x2="-14" y2="24"/>
<line x1="-14" y1="-14" x2="0" y2="-32"/>
<line x1="-14" y1="14" x2="0" y2="32"/>
<polyline points="-22,-4 -14,0 -22,4" fill="none"/>
<line x1="0" y1="-32" x2="0" y2="-28"/>
<line x1="0" y1="28" x2="0" y2="32"/>`,
  },
  M_NMOS: {
    label:'NMOS', prefix:'M', group:'Semis',
    pins:[[0,-32],[-32,0],[0,32]], pinNames:['D','G','S'],
    refOffset:[10,-36], valOffset:[10,38],
    svg:`<line x1="-32" y1="0" x2="-20" y2="0"/>
<line x1="-20" y1="-22" x2="-20" y2="22"/>
<line x1="-16" y1="-20" x2="-16" y2="-6"/>
<line x1="-16" y1="-2" x2="-16" y2="2"/>
<line x1="-16" y1="6" x2="-16" y2="20"/>
<line x1="-16" y1="0" x2="0" y2="0"/>
<line x1="0" y1="-16" x2="0" y2="-32"/>
<line x1="0" y1="16" x2="0" y2="32"/>
<line x1="0" y1="-16" x2="0" y2="16"/>
<polyline points="-5,4 0,0 -5,-4" fill="none"/>`,
  },
  M_PMOS: {
    label:'PMOS', prefix:'M', group:'Semis',
    pins:[[0,32],[-32,0],[0,-32]], pinNames:['D','G','S'],
    refOffset:[10,-36], valOffset:[10,38],
    svg:`<line x1="-32" y1="0" x2="-20" y2="0"/>
<line x1="-20" y1="-22" x2="-20" y2="22"/>
<line x1="-16" y1="-20" x2="-16" y2="-6"/>
<line x1="-16" y1="-2" x2="-16" y2="2"/>
<line x1="-16" y1="6" x2="-16" y2="20"/>
<line x1="-16" y1="0" x2="0" y2="0"/>
<line x1="0" y1="-16" x2="0" y2="-32"/>
<line x1="0" y1="16" x2="0" y2="32"/>
<line x1="0" y1="-16" x2="0" y2="16"/>
<polyline points="5,4 0,0 5,-4" fill="none"/>`,
  },
  J_N: {
    label:'N-JFET', prefix:'J', group:'Semis',
    pins:[[0,-32],[-32,0],[0,32]], pinNames:['D','G','S'],
    refOffset:[10,-36], valOffset:[10,38],
    svg:`<line x1="-32" y1="0" x2="-14" y2="0"/>
<line x1="-14" y1="-22" x2="-14" y2="22"/>
<line x1="-14" y1="-16" x2="0" y2="-16"/>
<line x1="0" y1="-16" x2="0" y2="-32"/>
<line x1="-14" y1="16" x2="0" y2="16"/>
<line x1="0" y1="16" x2="0" y2="32"/>
<polyline points="-22,-4 -14,0 -22,4" fill="none"/>`,
  },
  J_P: {
    label:'P-JFET', prefix:'J', group:'Semis',
    pins:[[0,32],[-32,0],[0,-32]], pinNames:['D','G','S'],
    refOffset:[10,-36], valOffset:[10,38],
    svg:`<line x1="-32" y1="0" x2="-14" y2="0"/>
<line x1="-14" y1="-22" x2="-14" y2="22"/>
<line x1="-14" y1="-16" x2="0" y2="-16"/>
<line x1="0" y1="-16" x2="0" y2="-32"/>
<line x1="-14" y1="16" x2="0" y2="16"/>
<line x1="0" y1="16" x2="0" y2="32"/>
<polyline points="-6,-4 -14,0 -6,4" fill="none"/>`,
  },
  // ── SWITCHES ──────────────────────────────────────────────────────────────
  S: {
    label:'V-Switch', prefix:'S', group:'Switches',
    pins:[[0,-24],[0,24],[32,-16],[32,16]], pinNames:['p','n','cp','cn'],
    refOffset:[12,-28], valOffset:[12,30],
    svg:`<line x1="0" y1="-24" x2="0" y2="-12"/>
<circle cx="0" cy="-12" r="2.5" fill="currentColor"/>
<line x1="0" y1="-12" x2="8" y2="4"/>
<circle cx="0" cy="12" r="2.5" fill="currentColor"/>
<line x1="0" y1="12" x2="0" y2="24"/>
<line x1="32" y1="-16" x2="14" y2="-16"/>
<line x1="32" y1="16" x2="14" y2="16"/>
<line x1="14" y1="-16" x2="14" y2="16"/>`,
  },
  W: {
    label:'I-Switch', prefix:'W', group:'Switches',
    pins:[[0,-24],[0,24]], pinNames:['p','n'],
    refOffset:[12,-28], valOffset:[12,30],
    svg:`<line x1="0" y1="-24" x2="0" y2="-12"/>
<circle cx="0" cy="-12" r="2.5" fill="currentColor"/>
<line x1="0" y1="-12" x2="8" y2="4"/>
<circle cx="0" cy="12" r="2.5" fill="currentColor"/>
<line x1="0" y1="12" x2="0" y2="24"/>
<text x="5" y="-16" font-size="9" fill="currentColor">W</text>`,
  },
  // ── TRANSMISSION LINE ─────────────────────────────────────────────────────
  T: {
    label:'Trans Line', prefix:'T', group:'Other',
    pins:[[-32,-16],[-32,16],[32,-16],[32,16]], pinNames:['A+','A-','B+','B-'],
    refOffset:[0,-28], valOffset:[0,28],
    svg:`<rect x="-24" y="-16" width="48" height="32" fill="none"/>
<line x1="-32" y1="-16" x2="-24" y2="-16"/>
<line x1="-32" y1="16" x2="-24" y2="16"/>
<line x1="24" y1="-16" x2="32" y2="-16"/>
<line x1="24" y1="16" x2="32" y2="16"/>
<text x="0" y="5" text-anchor="middle" font-size="10" fill="currentColor">T</text>`,
  },
  // ── SUBCIRCUIT ────────────────────────────────────────────────────────────
  X: {
    label:'Subcircuit', prefix:'X', group:'Other',
    pins:[[0,-32],[0,32]], pinNames:['1','2'],
    refOffset:[20,-4], valOffset:[20,14],
    svg:`<rect x="-16" y="-24" width="32" height="48" fill="none" stroke-dasharray="4,3"/>
<line x1="0" y1="-32" x2="0" y2="-24"/>
<line x1="0" y1="24" x2="0" y2="32"/>
<text x="0" y="5" text-anchor="middle" font-size="11" fill="currentColor">X</text>`,
  },
  // ── POWER / GROUND ────────────────────────────────────────────────────────
  GND: {
    label:'Ground', prefix:'GND', group:'Power',
    pins:[[0,0]], pinNames:['0'], netName:'0',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="8"/>
<line x1="-14" y1="8" x2="14" y2="8"/>
<line x1="-9" y1="14" x2="9" y2="14"/>
<line x1="-4" y1="20" x2="4" y2="20"/>`,
  },
  VDD: {
    label:'VDD Rail', prefix:'VDD', group:'Power',
    pins:[[0,0]], pinNames:['VDD'], netName:'VDD',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="-10"/>
<line x1="-14" y1="-10" x2="14" y2="-10"/>
<text x="0" y="-16" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor">VDD</text>`,
  },
  VCC: {
    label:'VCC Rail', prefix:'VCC', group:'Power',
    pins:[[0,0]], pinNames:['VCC'], netName:'VCC',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="-10"/>
<line x1="-14" y1="-10" x2="14" y2="-10"/>
<text x="0" y="-16" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor">VCC</text>`,
  },
  VSS: {
    label:'VSS Rail', prefix:'VSS', group:'Power',
    pins:[[0,0]], pinNames:['VSS'], netName:'VSS',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="8"/>
<line x1="-14" y1="8" x2="14" y2="8"/>
<text x="0" y="22" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor">VSS</text>`,
  },
};

export interface PaletteGroup {
  name:  string;
  types: string[];
}

export const PALETTE_GROUPS: PaletteGroup[] = [
  { name:'Passives',  types:['R','C','L','K'] },
  { name:'Sources',   types:['V','I','E','G','F','H','B'] },
  { name:'Semis',     types:['D','Q_NPN','Q_PNP','M_NMOS','M_PMOS','J_N','J_P'] },
  { name:'Switches',  types:['S','W'] },
  { name:'Other',     types:['T','X'] },
  { name:'Power',     types:['GND','VDD','VCC','VSS'] },
];
