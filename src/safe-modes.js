'use strict';
// ── ELK layout safe-mode escalation table ────────────────────────────────
// Each entry is a set of feature flags passed to convert() / buildElkGraph()
// when the previous attempt produced overlapping or invalid output.
// Escalate from index 0 (full features) toward higher indexes (more constraints).

export const SAFE_MODES = [
  {},
  {bridge:1},
  {noLPass:1},
  {noFar:1, noHang:1, noLPass:1},
  {noFar:1, noHang:1, noLPass:1, bridge:1},
  {noFb:1, noFar:1, noLeg:1, noHang:1, noLPass:1},
  {noFb:1, noFar:1, noLeg:1, noHang:1, noLPass:1, bridge:1},
  {noFb:1, noFar:1, noLeg:1, noHang:1, noLPass:1, spacingX:1.5},
  {noFb:1, noFar:1, noLeg:1, noHang:1, noLPass:1, spacingX:1.5, bridge:1},
  {noFb:1, noFar:1, noLeg:1, noHang:1, noLPass:1, spacingX:2.25, bridge:1},
];
