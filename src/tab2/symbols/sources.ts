import type { SymDef } from '../schematic-symbols';

export const SOURCES: Record<string, SymDef> = {
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
};
