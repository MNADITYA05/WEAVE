/**
 * state.ts — Shared editor state, constants, and dirty-flag helpers
 */
import type { EditorState, Snapshot, Comp } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const GRID = 16;
export const snap = (v: number): number => Math.round(v / GRID) * GRID;
export const STORAGE_KEY = 'weave-sc-v1';
export const PIN_SNAP_THRESHOLD = GRID * 1.5; // 24 world-px

// ─── History arrays (managed by history.ts, shared across modules) ────────────

export const _hist: Snapshot[] = [];
export let _histIdx = -1;
export function setHistIdx(v: number): void { _histIdx = v; }

// ─── Editor singleton ─────────────────────────────────────────────────────────

export const S: EditorState = {
  comps: [], wires: [], junctions: [], labels: [], directives: [], annots: [],
  sel: null, selWire: null, selLabel: null, selDir: null, selAnnot: null,
  selMulti: new Set(), selWireMulti: new Set(),
  titleBlock: { title: 'Untitled', doc: '', rev: 'A', author: '', date: new Date().toISOString().slice(0, 10), visible: false },
  mode: 'select',
  placing: null, placingRot: 'R0',
  wireStart: null,
  mouse: { x: 0, y: 0 },
  pan: { x: 200, y: 200 }, zoom: 1,
  counters: {},
  lastNet: '',
};

// ─── ID counter ───────────────────────────────────────────────────────────────

export let _nid = 1;
export function setNid(v: number): void { _nid = v; }
export const uid = (): string => 'c' + (_nid++);

// ─── Junction dirty flag ──────────────────────────────────────────────────────

export let _junctionsDirty = true;
export function markJunctionsDirty(): void { _junctionsDirty = true; }
export function clearJunctionsDirty(): void { _junctionsDirty = false; }

// ─── Unused export placeholder (satisfies Comp import used by clipboard callers) ──

export type { Comp };
