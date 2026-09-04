export type RotCode = 'R0' | 'R90' | 'R180' | 'R270' | 'MR0' | 'MR90' | 'MR180' | 'MR270';

export interface CompExtra {
  model?:    string;
  csrc?:     string;
  L1?:       string;
  L2?:       string;
  bulk?:     string;
  pinCount?: string;
  Lp?:       string;
  Ls?:       string;
  k?:        string;
  spiceLine?:  string;
  spiceLine2?: string;
}

export interface Comp {
  id:    string;
  type:  string;
  name:  string;
  value: string;
  x:     number;
  y:     number;
  rot:   RotCode;
  extra: CompExtra;
}

export interface Wire {
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
  bus?: boolean;
}

export interface Junction { x: number; y: number }

export interface NetLabel { id: string; x: number; y: number; name: string; }

export interface Directive { id: string; x: number; y: number; text: string; }

export interface TextAnnot { id: string; x: number; y: number; text: string; fontSize: number; }

export interface TitleBlock {
  title:  string;
  doc:    string;
  rev:    string;
  author: string;
  date:   string;
  visible: boolean;
}

export interface Snapshot { comps: Comp[]; wires: Wire[]; labels: NetLabel[]; directives: Directive[]; annots: TextAnnot[] }

export interface EditorState {
  comps:      Comp[];
  wires:      Wire[];
  junctions:  Junction[];
  sel:        string | null;
  selWire:    string | null;
  mode:       'select' | 'place' | 'wire' | 'label' | 'annot' | 'bus';
  placing:    string | null;
  placingRot: RotCode;
  wireStart:  { x: number; y: number } | null;
  mouse:      { x: number; y: number };
  pan:        { x: number; y: number };
  zoom:       number;
  counters:   Record<string, number>;
  lastNet:    string;
  labels:      NetLabel[];
  selLabel:    string | null;
  selMulti:    Set<string>;
  directives:  Directive[];
  selDir:      string | null;
  annots:      TextAnnot[];
  selAnnot:    string | null;
  selWireMulti: Set<string>;
  titleBlock:  TitleBlock;
}
