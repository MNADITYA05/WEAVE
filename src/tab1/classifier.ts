/**
 * classifier.ts — Net classification
 *
 * Classifies every net in the netlist as one of three classes:
 *   'gnd'    — the ground reference (net named "0")
 *   'rail'   — a DC supply net driven by a named voltage source
 *   'signal' — everything else (routed via ELK edges)
 *
 * This stage does NOT mutate components. It produces a NetClassMap that is
 * passed as a read-only input to every downstream stage.
 */

import type { NetClassMap, NetClass, ParsedComponent } from '../types.js';

/**
 * Classify every net reachable from the component list.
 *
 * @param comps - Parsed components from parseNetlist()
 * @returns Map from net name to its NetClass
 */
export function classifyNets(comps: readonly ParsedComponent[]): NetClassMap {
  const cls = new Map<string, NetClass>();

  // Collect all nets across all components
  const allNets = new Set<string>();
  for (const c of comps) {
    for (const n of c.nets) allNets.add(n);
  }

  // Default classification: '0' is ground, everything else is signal
  for (const n of allNets) {
    cls.set(n, n === '0' ? 'gnd' : 'signal');
  }

  // Upgrade signal nets to 'rail' when driven by a DC voltage source
  // whose other terminal is ground and whose net has a user-assigned name.
  // Auto-named nets (N001, N002, …) keep their wired connection instead of
  // becoming a floating rail flag.
  for (const c of comps) {
    if (c.sym !== 'voltage' || /SINE|PULSE|PWL|AC|EXP|SFFM/i.test(c.value)) continue;
    const dcVal = c.value.replace(/^DC\s+/i, '');
    if (!/^[-+]?\d/.test(dcVal)) continue;

    const [a, b] = c.nets as [string | undefined, string | undefined];
    const isUserNamed = (n: string): boolean => !/^n\d+$/i.test(n);

    if (a === '0' && b && b !== '0' && isUserNamed(b)) cls.set(b, 'rail');
    if (b === '0' && a && a !== '0' && isUserNamed(a)) cls.set(a, 'rail');
  }

  return cls;
}

/**
 * Returns true when a net class represents a flag (gnd or rail).
 * These nets are rendered as schematic flags rather than routed wires.
 */
export const isFlag = (t: NetClass | undefined): boolean =>
  t === 'gnd' || t === 'rail';

/**
 * Resolve the display label for a rail net.
 *
 * Auto-named nets (N001…) use the driving voltage source name (e.g. "VCC")
 * instead of the opaque auto-name.
 *
 * @param net   - Net name to label
 * @param comps - Parsed components (to find the driving source)
 * @returns Uppercase label string
 */
export function railLabel(net: string, comps: readonly ParsedComponent[]): string {
  if (!/^n\d+$/i.test(net)) return net.toUpperCase();

  const src = comps.find(c => {
    if (c.sym !== 'voltage' || /SINE|PULSE|PWL|AC|EXP|SFFM/i.test(c.value)) return false;
    const dcVal = c.value.replace(/^DC\s+/i, '');
    if (!/^[-+]?\d/.test(dcVal)) return false;
    return (c.nets[0] === net && c.nets[1] === '0')
        || (c.nets[1] === net && c.nets[0] === '0');
  });

  return src ? src.name.toUpperCase() : net.toUpperCase();
}
