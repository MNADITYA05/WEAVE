/**
 * rotation.ts — Rotation/mirror helpers and effective-pin computation
 */
import type { RotCode } from './types.js';
import type { Comp } from './types.js';
import { SYMDEFS } from './schematic-symbols.js';

export function rotPt([x, y]: [number, number], code: RotCode): [number, number] {
  let rx = x;
  if (code[0] === 'M') rx = -rx;
  const k = parseInt(code.replace(/^M?R/, ''), 10) || 0;
  if (k === 0)   return [rx, y];
  if (k === 90)  return [-y, rx];
  if (k === 180) return [-rx, -y];
  if (k === 270) return [y, -rx];
  return [rx, y];
}

export function nextRot(code: RotCode): RotCode {
  const mirrored = code.startsWith('M');
  const base = mirrored ? code.slice(1) : code;
  const seq = ['R0', 'R90', 'R180', 'R270'];
  const next = seq[(seq.indexOf(base) + 1) % 4]!;
  return (mirrored ? 'M' + next : next) as RotCode;
}

export function toggleMirror(code: RotCode): RotCode {
  return (code.startsWith('M') ? code.slice(1) : 'M' + code) as RotCode;
}

export function svgTransform(code: RotCode): string {
  const [ax, ay] = rotPt([1, 0], code);
  const [bx, by] = rotPt([0, 1], code);
  return `matrix(${ax},${ay},${bx},${by},0,0)`;
}

export function getEffectivePins(c: Comp): [number, number][] {
  const def = SYMDEFS[c.type];
  if (!def) return [];
  if (c.type !== 'X') return def.pins;
  const n = Math.max(2, Math.min(16, parseInt(c.extra.pinCount ?? '2', 10) || 2));
  const spacing = 32;
  const totalH = (n - 1) * spacing;
  return Array.from({ length: n }, (_, i) =>
    [0, Math.round(-totalH / 2 + i * spacing)] as [number, number]);
}
