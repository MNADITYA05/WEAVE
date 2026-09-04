/** A 2D point in LTspice grid units. */
export type Point = [number, number];

/**
 * Axis-aligned bounding box: [left, top, right, bottom] in local symbol coords.
 * All values are multiples of GRID (16).
 */
export type BBox = [number, number, number, number];

/**
 * LTspice rotation code.
 * M-prefix means mirror-x first, then rotate.
 */
export type RotCode =
  | 'R0' | 'R90' | 'R180' | 'R270'
  | 'MR0' | 'MR90' | 'MR180' | 'MR270';

/** One pin in a symbol definition, in local symbol coordinates. */
export interface PinDef {
  x: number;
  y: number;
}

/** Symbol definition as stored in SYMBOLS / symtable.js. */
export interface SymbolDef {
  pins: Point[];
  bbox: BBox;
  ord?: number[];
  attrs?: Record<string, string>;
  windows?: Record<string, [number, number, string]>;
  synthetic?: boolean;
  Prefix?: string;
  SpiceModel?: string;
  Value?: string;
  Value2?: string;
  SpiceLine?: string;
  SpiceLine2?: string;
}
