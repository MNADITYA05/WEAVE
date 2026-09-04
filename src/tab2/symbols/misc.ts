import type { SymDef } from '../schematic-symbols';

export const MISC: Record<string, SymDef> = {
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
  X: {
    label:'Subcircuit', prefix:'X', group:'Other',
    pins:[[0,-32],[0,32]], pinNames:['1','2'],
    refOffset:[20,-4], valOffset:[20,14],
    svg:`<rect x="-16" y="-24" width="32" height="48" fill="none" stroke-dasharray="4,3"/>
<line x1="0" y1="-32" x2="0" y2="-24"/>
<line x1="0" y1="24" x2="0" y2="32"/>
<text x="0" y="5" text-anchor="middle" font-size="11" fill="currentColor">X</text>`,
  },
};
