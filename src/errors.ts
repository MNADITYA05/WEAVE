/**
 * errors.ts — Typed error hierarchy for Weave
 *
 * All pipeline errors extend WeaveError so callers can distinguish Weave
 * failures from unexpected JS errors with a single instanceof check.
 *
 *   ParseError   — bad netlist syntax or unsupported element
 *   SymbolError  — unknown symbol, model name, or subcircuit
 *   LayoutError  — ELK failure, placement collision, or geometry error
 *   RoutingError — wire routing or flag placement failure
 */

export class WeaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeaveError';
    // Maintains proper prototype chain in transpiled ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the input netlist cannot be parsed. */
export class ParseError extends WeaveError {
  constructor(message: string) { super(message); this.name = 'ParseError'; }
}

/** Thrown when a symbol, model name, or subcircuit cannot be resolved. */
export class SymbolError extends WeaveError {
  constructor(message: string) { super(message); this.name = 'SymbolError'; }
}

/** Thrown when ELK layout fails or component placement cannot be resolved. */
export class LayoutError extends WeaveError {
  constructor(message: string) { super(message); this.name = 'LayoutError'; }
}

/** Thrown when wire routing or flag placement cannot find a valid position. */
export class RoutingError extends WeaveError {
  constructor(message: string) { super(message); this.name = 'RoutingError'; }
}
