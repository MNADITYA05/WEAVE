import type { SymDef } from '../schematic-symbols';

export const SEMIS: Record<string, SymDef> = {
  D: {
    label:'Diode', prefix:'D', group:'Semis',
    pins:[[0,-24],[0,24]], pinNames:['A','K'],
    refOffset:[14,-2], valOffset:[14,14],
    svg:`<line x1="0" y1="-24" x2="0" y2="-10"/>
<polyline points="-10,-10 10,-10 0,10 -10,-10" fill="none"/>
<line x1="-10" y1="10" x2="10" y2="10"/>
<line x1="0" y1="10" x2="0" y2="24"/>`,
  },
  LED: {
    label:'LED', prefix:'D', group:'Semis',
    pins:[[0,-24],[0,24]], pinNames:['A','K'],
    refOffset:[14,-2], valOffset:[14,14],
    svg:`<line x1="0" y1="-24" x2="0" y2="-10"/>
<polyline points="-10,-10 10,-10 0,10 -10,-10" fill="none"/>
<line x1="-10" y1="10" x2="10" y2="10"/>
<line x1="0" y1="10" x2="0" y2="24"/>
<line x1="6" y1="4" x2="14" y2="-4"/>
<polyline points="11,-4 14,-4 14,-1" fill="none"/>
<line x1="10" y1="8" x2="18" y2="0"/>
<polyline points="15,0 18,0 18,3" fill="none"/>`,
  },
  ZENER: {
    label:'Zener', prefix:'D', group:'Semis',
    pins:[[0,-24],[0,24]], pinNames:['A','K'],
    refOffset:[14,-2], valOffset:[14,14],
    svg:`<line x1="0" y1="-24" x2="0" y2="-10"/>
<polyline points="-10,-10 10,-10 0,10 -10,-10" fill="none"/>
<polyline points="-14,10 -10,10 10,10 14,6" fill="none"/>
<line x1="0" y1="10" x2="0" y2="24"/>`,
  },
  SCHOTTKY: {
    label:'Schottky', prefix:'D', group:'Semis',
    pins:[[0,-24],[0,24]], pinNames:['A','K'],
    refOffset:[14,-2], valOffset:[14,14],
    svg:`<line x1="0" y1="-24" x2="0" y2="-10"/>
<polyline points="-10,-10 10,-10 0,10 -10,-10" fill="none"/>
<polyline points="-13,7 -10,10 -10,13" fill="none"/>
<polyline points="13,7 10,10 10,13" fill="none"/>
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
    pins:[[0,-32],[-32,0],[0,32],[16,0]], pinNames:['D','G','S','B'],
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
<line x1="0" y1="0" x2="16" y2="0"/>
<polyline points="-5,4 0,0 -5,-4" fill="none"/>`,
  },
  M_PMOS: {
    label:'PMOS', prefix:'M', group:'Semis',
    pins:[[0,32],[-32,0],[0,-32],[16,0]], pinNames:['D','G','S','B'],
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
<line x1="0" y1="0" x2="16" y2="0"/>
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
};
