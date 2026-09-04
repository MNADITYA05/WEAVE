import type { SymDef } from '../schematic-symbols';

export const SWITCHES: Record<string, SymDef> = {
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
};
