import type { SymDef } from '../schematic-symbols';

export const POWER: Record<string, SymDef> = {
  // ── Standard GND (net 0) ──────────────────────────────────────────────────
  GND: {
    label:'Ground', prefix:'GND', group:'Power',
    pins:[[0,0]], pinNames:['0'], netName:'0',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="8"/>
<line x1="-14" y1="8" x2="14" y2="8"/>
<line x1="-9" y1="14" x2="9" y2="14"/>
<line x1="-4" y1="20" x2="4" y2="20"/>`,
  },
  // Earth GND — three horizontal bars + ground stake (also net 0)
  EARTH: {
    label:'Earth GND', prefix:'GND', group:'Power',
    pins:[[0,0]], pinNames:['0'], netName:'0',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="8"/>
<line x1="-14" y1="8" x2="14" y2="8"/>
<line x1="-14" y1="13" x2="14" y2="13"/>
<line x1="-14" y1="18" x2="14" y2="18"/>`,
  },
  // Chassis GND — diagonal-hash style (net 0)
  CHASSIS: {
    label:'Chassis GND', prefix:'GND', group:'Power',
    pins:[[0,0]], pinNames:['0'], netName:'0',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="8"/>
<line x1="-14" y1="8" x2="14" y2="8"/>
<line x1="-14" y1="8" x2="-18" y2="16"/>
<line x1="-7" y1="8" x2="-11" y2="16"/>
<line x1="0" y1="8" x2="-4" y2="16"/>
<line x1="7" y1="8" x2="3" y2="16"/>
<line x1="14" y1="8" x2="10" y2="16"/>`,
  },
  // Analog GND
  AGND: {
    label:'AGND', prefix:'GND', group:'Power',
    pins:[[0,0]], pinNames:['AGND'], netName:'AGND',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="8"/>
<line x1="-14" y1="8" x2="14" y2="8"/>
<line x1="-9" y1="14" x2="9" y2="14"/>
<line x1="-4" y1="20" x2="4" y2="20"/>
<text x="0" y="32" text-anchor="middle" font-size="9" fill="currentColor">AGND</text>`,
  },
  // Digital GND
  DGND: {
    label:'DGND', prefix:'GND', group:'Power',
    pins:[[0,0]], pinNames:['DGND'], netName:'DGND',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="8"/>
<line x1="-14" y1="8" x2="14" y2="8"/>
<line x1="-9" y1="14" x2="9" y2="14"/>
<line x1="-4" y1="20" x2="4" y2="20"/>
<text x="0" y="32" text-anchor="middle" font-size="9" fill="currentColor">DGND</text>`,
  },
  // Power GND
  PGND: {
    label:'PGND', prefix:'GND', group:'Power',
    pins:[[0,0]], pinNames:['PGND'], netName:'PGND',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="8"/>
<line x1="-14" y1="8" x2="14" y2="8"/>
<line x1="-9" y1="14" x2="9" y2="14"/>
<line x1="-4" y1="20" x2="4" y2="20"/>
<text x="0" y="32" text-anchor="middle" font-size="9" fill="currentColor">PGND</text>`,
  },
  // ── Positive supply rails ─────────────────────────────────────────────────
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
  V5: {
    label:'+5V Rail', prefix:'PWR', group:'Power',
    pins:[[0,0]], pinNames:['+5V'], netName:'+5V',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="-10"/>
<line x1="-14" y1="-10" x2="14" y2="-10"/>
<text x="0" y="-16" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor">+5V</text>`,
  },
  V3V3: {
    label:'+3.3V Rail', prefix:'PWR', group:'Power',
    pins:[[0,0]], pinNames:['+3V3'], netName:'+3V3',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="-10"/>
<line x1="-18" y1="-10" x2="18" y2="-10"/>
<text x="0" y="-16" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor">+3.3V</text>`,
  },
  V1V8: {
    label:'+1.8V Rail', prefix:'PWR', group:'Power',
    pins:[[0,0]], pinNames:['+1V8'], netName:'+1V8',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="-10"/>
<line x1="-18" y1="-10" x2="18" y2="-10"/>
<text x="0" y="-16" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor">+1.8V</text>`,
  },
  // ── Negative supply rails ─────────────────────────────────────────────────
  VSS: {
    label:'VSS Rail', prefix:'VSS', group:'Power',
    pins:[[0,0]], pinNames:['VSS'], netName:'VSS',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="8"/>
<line x1="-14" y1="8" x2="14" y2="8"/>
<text x="0" y="22" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor">VSS</text>`,
  },
  VEE: {
    label:'VEE Rail', prefix:'VEE', group:'Power',
    pins:[[0,0]], pinNames:['VEE'], netName:'VEE',
    refOffset:null, valOffset:null,
    svg:`<line x1="0" y1="0" x2="0" y2="8"/>
<line x1="-14" y1="8" x2="14" y2="8"/>
<text x="0" y="22" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor">VEE</text>`,
  },
};
