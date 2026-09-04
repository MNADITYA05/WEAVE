import type { SymDef } from '../schematic-symbols';

// OPAMP: IN+=[-32,-16], IN-=[-32,16], OUT=[32,0], V+=[0,-32], V-=[0,32]
// Emitted as X subcircuit — user sets value to model name (e.g. LT1001)
export const OPAMP: Record<string, SymDef> = {
  OPAMP: {
    label:'Op-Amp', prefix:'U', group:'Linear',
    pins:[[-32,-16],[-32,16],[32,0],[0,-32],[0,32]],
    pinNames:['IN+','IN-','OUT','V+','V-'],
    refOffset:[10,-36], valOffset:[10,36],
    svg:`<polyline points="-24,-28 -24,28 24,0 -24,-28" fill="none"/>
<line x1="-32" y1="-16" x2="-24" y2="-16"/>
<line x1="-32" y1="16" x2="-24" y2="16"/>
<line x1="24" y1="0" x2="32" y2="0"/>
<line x1="0" y1="-32" x2="0" y2="-20"/>
<line x1="0" y1="20" x2="0" y2="32"/>
<text x="-18" y="-11" font-size="10" fill="currentColor">+</text>
<text x="-18" y="20" font-size="10" fill="currentColor">−</text>`,
  },
};
