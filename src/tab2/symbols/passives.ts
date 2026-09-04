import type { SymDef } from '../schematic-symbols';

export const PASSIVES: Record<string, SymDef> = {
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
  // Transformer: 4 pins, auto-emits L1+L2+K in netlist
  XFMR: {
    label:'Transformer', prefix:'T', group:'Passives',
    pins:[[-32,-16],[-32,16],[32,-16],[32,16]], pinNames:['P+','P-','S+','S-'],
    refOffset:[0,-30], valOffset:[0,30],
    svg:`<line x1="-32" y1="-16" x2="-20" y2="-16"/>
<line x1="-32" y1="16" x2="-20" y2="16"/>
<path d="M-20,-16 A8,8,0,0,1,-20,0 A8,8,0,0,1,-20,16" fill="none"/>
<line x1="-2" y1="-20" x2="-2" y2="20" stroke-width="2"/>
<line x1="2" y1="-20" x2="2" y2="20" stroke-width="2"/>
<path d="M20,-16 A8,8,0,0,0,20,0 A8,8,0,0,0,20,16" fill="none"/>
<line x1="32" y1="-16" x2="20" y2="-16"/>
<line x1="32" y1="16" x2="20" y2="16"/>`,
  },
};
