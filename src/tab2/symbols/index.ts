/**
 * symbols/index.ts — merges all symbol sub-modules into SYMDEFS and PALETTE_GROUPS
 */
export type { SymDef, PaletteGroup } from '../schematic-symbols';

import { PASSIVES }  from './passives';
import { SOURCES }   from './sources';
import { SEMIS }     from './semis';
import { SWITCHES }  from './switches';
import { LOGIC }     from './logic';
import { OPAMP }     from './opamp';
import { MISC }      from './misc';
import { POWER }     from './power';

export { LOGIC_BEXPR } from './logic';

import type { SymDef, PaletteGroup } from '../schematic-symbols';

export const SYMDEFS: Record<string, SymDef> = {
  ...PASSIVES,
  ...SOURCES,
  ...SEMIS,
  ...SWITCHES,
  ...LOGIC,
  ...OPAMP,
  ...MISC,
  ...POWER,
};

export const PALETTE_GROUPS: PaletteGroup[] = [
  { name:'Passives', types:['R','C','L','K','XFMR'] },
  { name:'Sources',  types:['V','I','E','G','F','H','B'] },
  { name:'Semis',    types:['D','LED','ZENER','SCHOTTKY','Q_NPN','Q_PNP','M_NMOS','M_PMOS','J_N','J_P'] },
  { name:'Switches', types:['S','W'] },
  { name:'Logic',    types:['AND2','OR2','NAND2','NOR2','XOR2','XNOR2','NOT','BUF'] },
  { name:'Linear',   types:['OPAMP'] },
  { name:'Other',    types:['T','X'] },
  { name:'Power',    types:['GND','EARTH','CHASSIS','AGND','DGND','PGND','VDD','VCC','V5','V3V3','V1V8','VSS','VEE'] },
];
