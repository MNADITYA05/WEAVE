/**
 * types.ts — Weave pipeline stage interfaces
 *
 * Every pipeline stage consumes one shape and produces a different, richer shape.
 * Properties are NEVER added to an object after the stage that creates it.
 *
 * Pipeline order:
 *   text input
 *     → parseNetlist()       → ParsedComponent[]
 *     → classifyNets()       → NetClassMap          (separate; does not mutate comps)
 *     → netDepths()          → NetDepthMap          (separate; does not mutate comps)
 *     → decorateComponents() → DecoratedComponent[]
 *     → classifyFeedback()   → AnnotatedComponent[]
 *     → buildElkGraph()      → ElkGraph
 *     → elk.layout()         → ElkLayoutResult
 *     → applyLayout()        → PlacedComponent[]
 *     → routeWires()         → RouteResult
 *     → emitAsc()            → string (.asc text)
 */

// ─── Coordinate primitives ────────────────────────────────────────────────────

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

/**
 * Escape direction for a signal pin — the unit vector direction the wire
 * leaves the component body before entering the ELK graph edge.
 * null means the pin is not a signal pin (it is gnd or rail).
 */
export type EscDir = [number, number] | null;

// ─── Net classification ───────────────────────────────────────────────────────

/** The three classes a net can belong to. */
export type NetClass = 'gnd' | 'rail' | 'signal';

/** net name → NetClass */
export type NetClassMap = Map<string, NetClass>;

/** net name → BFS depth from source (undefined = unreachable from source) */
export type NetDepthMap = Map<string, number>;

// ─── Symbol definition (from symtable.js) ────────────────────────────────────

/** One pin in a symbol definition, in local symbol coordinates. */
export interface PinDef {
  /** Local x coordinate (multiple of GRID). */
  x: number;
  /** Local y coordinate (multiple of GRID). */
  y: number;
}

/** Symbol definition as stored in SYMBOLS / symtable.js. */
export interface SymbolDef {
  /** Pin positions in local symbol coordinates. */
  pins: Point[];
  /** Bounding box in local symbol coordinates. */
  bbox: BBox;
  /**
   * Optional SPICE pin ordering: maps symbol pin index (1-based position in
   * this array) to SPICE node position (1-based).
   */
  ord?: number[];
  /** Optional pre-defined SYMATTR blocks. */
  attrs?: Record<string, string>;
  /** Optional window overrides for label placement. */
  windows?: Record<string, [number, number, string]>;
  /** True for synthetic (virtual) symbols that bridge repeated-pin components. */
  synthetic?: boolean;
  /** SPICE element prefix, e.g. 'X' for subcircuits. */
  Prefix?: string;
  /** Default SpiceModel attribute value. */
  SpiceModel?: string;
  /** Default Value attribute. */
  Value?: string;
  /** Default Value2 attribute. */
  Value2?: string;
  /** Default SpiceLine attribute. */
  SpiceLine?: string;
  /** Default SpiceLine2 attribute. */
  SpiceLine2?: string;
}

// ─── Stage 1 output: ParsedComponent ─────────────────────────────────────────

/**
 * Output of parseNetlist().
 * Represents one SPICE element exactly as parsed — nothing more.
 */
export interface ParsedComponent {
  /** Instance name (e.g. "R1", "XU1"). */
  readonly name: string;
  /** Symbol key into the SYMBOLS table (e.g. "res", "npn", "OP27"). */
  readonly sym: string;
  /** Ordered net names this component connects to. */
  readonly nets: readonly string[];
  /** Raw SPICE value string (e.g. "10k", "2N3904", "SINE(0 1 1k)"). */
  readonly value: string;
}

/** Output of parseNetlist(): the full parsed netlist. */
export interface ParsedNetlist {
  readonly comps: readonly ParsedComponent[];
  readonly directives: readonly string[];
}

// ─── Stage 2/3: Net maps (not attached to components) ────────────────────────

// NetClassMap and NetDepthMap are defined above.

// ─── Stage 4 output: DecoratedComponent ──────────────────────────────────────

/**
 * Output of decorateComponents().
 * All geometry needed to build the ELK graph and place flags is computed here.
 * This is an immutable transform — a new object is created from each ParsedComponent.
 */
export interface DecoratedComponent extends ParsedComponent {
  /** Whether this component has an opamp-like pin layout. */
  readonly isOp: boolean;
  /**
   * Index into nets/pins of the output pin (only set when isOp === true).
   * The pin with the largest local x-coordinate.
   */
  readonly outPinIdx: number | undefined;
  /** Chosen LTspice rotation code for this component. */
  readonly rot: RotCode;
  /**
   * Rotated pin positions in symbol-local coordinates.
   * rpins[i] corresponds to nets[i].
   */
  readonly rpins: readonly Point[];
  /**
   * Rotated bounding box in symbol-local coordinates, expanded to include
   * flag placement space and escape stub endpoints.
   */
  readonly rbb: BBox;
  /**
   * Per-pin escape directions for signal pins.
   * esc[i] is null when nets[i] is gnd or rail.
   */
  readonly esc: readonly EscDir[];
  /**
   * Escape stub tip coordinates in symbol-local coordinates.
   * rtips[i] = rpins[i] + esc[i]*GRID (or rpins[i] when esc[i] is null).
   */
  readonly rtips: readonly Point[];
  /**
   * Per-pin flag placement direction for gnd/rail pins.
   * flagDir[i] is null for signal pins.
   */
  readonly flagDir: readonly (Point | null)[];
  /**
   * Whether this component participates in the ELK graph.
   * true when at least one net is classified as 'signal'.
   */
  readonly inGraph: boolean;
}

// ─── Stage 5 output: AnnotatedComponent ──────────────────────────────────────

/**
 * Output of classifyFeedback().
 * Feedback, far-feedback, leg, and hang classifications are added.
 * Components excluded from the ELK graph (isFb, isFar, isLeg, isHang)
 * have inGraph set to false.
 */
export interface AnnotatedComponent extends DecoratedComponent {
  // ── Local feedback ──
  /** True when this is a local feedback element (straddles opamp in/out). */
  readonly isFb: boolean;
  /** The opamp this element feeds back across (set when isFb). */
  readonly fbOf?: AnnotatedComponent;
  /** Index of the opamp input pin this connects to (set when isFb). */
  readonly fbInIdx?: number;
  /** The opamp input net name (set when isFb). */
  readonly fbInNet?: string;

  // ── Far feedback ──
  /** True when this is a far-feedback element (spans across a whole stage). */
  readonly isFar: boolean;
  /** The opamp this element feeds back across (set when isFar). */
  readonly farOf?: AnnotatedComponent;
  /** The upstream net this element connects to (set when isFar). */
  readonly upNet?: string;

  // ── Divider leg ──
  /** True when this is a divider leg (flag net + opamp feedback input net). */
  readonly isLeg: boolean;
  /** The opamp this leg is associated with (set when isLeg). */
  readonly legOf?: AnnotatedComponent;
  /** The opamp input pin index this leg connects to (set when isLeg). */
  readonly legInIdx?: number;

  // ── Hangable shunt ──
  /** True when this is a hangable shunt (bypass component below the bus). */
  readonly isHang: boolean;
  /** The signal net this shunt hangs from (set when isHang). */
  readonly hangNet?: string;

  // ── Opamp attachment lists (set on the opamp, not on the satellite) ──
  /** Local feedback elements attached above this opamp. */
  readonly fbList?: readonly AnnotatedComponent[];
  /** Far feedback elements attached above this opamp. */
  readonly farList?: readonly AnnotatedComponent[];
  /** Divider leg elements attached to the left of this opamp. */
  readonly legList?: readonly AnnotatedComponent[];
}

// ─── Stage 6 output: PlacedComponent ─────────────────────────────────────────

/**
 * Output of applyLayout().
 * All coordinates are now absolute in the LTspice schematic coordinate space.
 */
export interface PlacedComponent extends AnnotatedComponent {
  /** ELK-assigned x position (snapped to GRID). Top-left of component bounding box. */
  readonly x: number;
  /** ELK-assigned y position (snapped to GRID). Top-left of component bounding box. */
  readonly y: number;
  /**
   * Symbol origin in absolute schematic coordinates.
   * origin = [x - rbb[0], y - rbb[1]]
   */
  readonly origin: Point;
  /**
   * Absolute pin positions in schematic coordinates.
   * abs[i] = [origin[0] + rpins[i][0], origin[1] + rpins[i][1]]
   */
  readonly abs: readonly Point[];
  /**
   * Absolute escape stub tip positions in schematic coordinates.
   * tips[i] = [origin[0] + rtips[i][0], origin[1] + rtips[i][1]]
   */
  readonly tips: readonly Point[];
}

// ─── Stage 7 output: RouteResult ─────────────────────────────────────────────

/**
 * A wire segment: [x1, y1, x2, y2, netName?]
 * The optional fifth element is the net name, used during routing bookkeeping
 * and stripped before emitAsc().
 */
export type WireSegment = [number, number, number, number, string?];

/**
 * A flag placement: [x, y, netLabel]
 */
export type FlagEntry = [number, number, string];

/** Output of routeWires(). */
export interface RouteResult {
  readonly wires: readonly WireSegment[];
  readonly flags: readonly FlagEntry[];
}

// ─── ELK types (minimal — ELK is loaded as a global UMD bundle) ──────────────

export interface ElkPort {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layoutOptions?: Record<string, string>;
}

export interface ElkNode {
  id: string;
  width: number;
  height: number;
  layoutOptions?: Record<string, string>;
  ports?: ElkPort[];
  x?: number;
  y?: number;
}

export interface ElkEdge {
  id: string;
  netName?: string;
  sources: string[];
  targets: string[];
  layoutOptions?: Record<string, string>;
  sections?: ElkEdgeSection[];
}

export interface ElkEdgeSection {
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  bendPoints?: { x: number; y: number }[];
}

export interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

/** Shape of the ELK instance injected into convert(). */
export interface IElk {
  layout(graph: ElkGraph): Promise<ElkGraph>;
  terminateWorker?(): void;
}

// ─── Bridge ───────────────────────────────────────────────────────────────────

/**
 * A bridge represents two pins on the same component that share a net
 * and must be connected externally (tip-to-tip) rather than via an ELK edge.
 */
export interface Bridge {
  readonly c: AnnotatedComponent;
  readonly i: number;
  readonly j: number;
}

// ─── ElkGraph build result ────────────────────────────────────────────────────

export interface ElkGraphResult {
  readonly graph: ElkGraph;
  readonly portId: (c: AnnotatedComponent, i: number) => string;
  readonly bridges: readonly Bridge[];
}

// ─── Topology ─────────────────────────────────────────────────────────────────

export type TopologyType =
  | 'diff_pair'
  | 'current_mirror'
  | 'cascode'
  | 'src_degen';

export interface DetectedTopology {
  readonly type: TopologyType;
  readonly nodes: readonly string[];
  readonly sharedNet?: string;
}

/** Minimal component shape accepted by _detectTopologies(). */
export interface TopologyComp {
  readonly name: string;
  /** Single uppercase letter: 'R', 'Q', 'M', etc. */
  readonly type: string;
  readonly nets: readonly string[];
}
