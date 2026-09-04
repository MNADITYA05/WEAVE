import type { Point, BBox, RotCode, SymbolDef } from '../shared/types.js';
export type { Point, BBox, RotCode, SymbolDef } from '../shared/types.js';

export type EscDir = [number, number] | null;

export type NetClass = 'gnd' | 'rail' | 'signal';
export type NetClassMap = Map<string, NetClass>;
export type NetDepthMap = Map<string, number>;

export interface ParsedComponent {
  readonly name: string;
  readonly sym: string;
  readonly nets: readonly string[];
  readonly value: string;
}

export interface ParsedNetlist {
  readonly comps: readonly ParsedComponent[];
  readonly directives: readonly string[];
}

export interface DecoratedComponent extends ParsedComponent {
  readonly isOp: boolean;
  readonly outPinIdx: number | undefined;
  readonly rot: RotCode;
  readonly rpins: readonly Point[];
  readonly rbb: BBox;
  readonly esc: readonly EscDir[];
  readonly rtips: readonly Point[];
  readonly flagDir: readonly (Point | null)[];
  readonly inGraph: boolean;
}

export interface AnnotatedComponent extends DecoratedComponent {
  readonly isFb: boolean;
  readonly fbOf?: AnnotatedComponent;
  readonly fbInIdx?: number;
  readonly fbInNet?: string;
  readonly isFar: boolean;
  readonly farOf?: AnnotatedComponent;
  readonly upNet?: string;
  readonly isLeg: boolean;
  readonly legOf?: AnnotatedComponent;
  readonly legInIdx?: number;
  readonly isHang: boolean;
  readonly hangNet?: string;
  readonly fbList?: readonly AnnotatedComponent[];
  readonly farList?: readonly AnnotatedComponent[];
  readonly legList?: readonly AnnotatedComponent[];
}

export interface PlacedComponent extends AnnotatedComponent {
  readonly x: number;
  readonly y: number;
  readonly origin: Point;
  readonly abs: readonly Point[];
  readonly tips: readonly Point[];
}

export type WireSegment = [number, number, number, number, string?];
export type FlagEntry = [number, number, string];

export interface RouteResult {
  readonly wires: readonly WireSegment[];
  readonly flags: readonly FlagEntry[];
}

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

export interface IElk {
  layout(graph: ElkGraph): Promise<ElkGraph>;
  terminateWorker?(): void;
}

export interface Bridge {
  readonly c: AnnotatedComponent;
  readonly i: number;
  readonly j: number;
}

export interface ElkGraphResult {
  readonly graph: ElkGraph;
  readonly portId: (c: AnnotatedComponent, i: number) => string;
  readonly bridges: readonly Bridge[];
}

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

export interface TopologyComp {
  readonly name: string;
  readonly type: string;
  readonly nets: readonly string[];
}
