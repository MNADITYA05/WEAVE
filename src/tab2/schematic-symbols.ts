/**
 * schematic-symbols.ts — public interface definitions + re-exports from symbols/
 *
 * Symbol data is split across src/tab2/symbols/:
 *   passives.ts  sources.ts  semis.ts  switches.ts
 *   logic.ts     opamp.ts    misc.ts   power.ts
 *   index.ts  ← merges all, exports SYMDEFS + PALETTE_GROUPS
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

export interface PaletteGroup {
  name:  string;
  types: string[];
}

export { SYMDEFS, PALETTE_GROUPS, LOGIC_BEXPR } from './symbols/index';
