'use strict';
// ── Stage 2: Wire bend reduction ──────────────────────────────────
export function _mergeWires(ascText) {
  // Parse WIRE lines, merge collinear segments, emit cleaned ASC
  const lines = ascText.split('\n');
  const wireLines = [];
  const otherLines = [];

  for (const l of lines) {
    if (l.trim().toUpperCase().startsWith('WIRE ')) {
      const p = l.trim().split(/\s+/);
      if (p.length >= 5) {
        wireLines.push([parseInt(p[1]),parseInt(p[2]),parseInt(p[3]),parseInt(p[4])]);
      } else { otherLines.push(l); }
    } else {
      otherLines.push(l);
    }
  }

  // Build adjacency: for each wire endpoint, collect connected wire indices
  // Merge pass: repeatedly find two collinear, touching wires and merge them
  let changed = true;
  let segs = wireLines.slice();
  // Deduplicate exact wire segments (same endpoints, any direction)
  segs = [...new Map(segs.map(w => {
    const [x1,y1,x2,y2] = w;
    const key = x1<x2||(x1===x2&&y1<y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
    return [key, w];
  })).values()];
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < segs.length; i++) {
      for (let j = i+1; j < segs.length; j++) {
        const a = segs[i], b = segs[j];
        const merged = _tryMerge(a, b);
        if (merged) {
          // Guard: don't merge if the shared touching point is a T-junction
          // endpoint used by another segment -- merging would destroy connectivity.
          const tp = _touchPoint(a, b);
          if (tp) {
            const [tx, ty] = tp;
            const onInterior = (tx,ty,s) => {
              if (s[0]===s[2]) return s[0]===tx && ty>Math.min(s[1],s[3]) && ty<Math.max(s[1],s[3]);
              if (s[1]===s[3]) return s[1]===ty && tx>Math.min(s[0],s[2]) && tx<Math.max(s[0],s[2]);
              return false;
            };
            let tJunction = false;
            for (let k = 0; k < segs.length; k++) {
              if (k === i || k === j) continue;
              const s = segs[k];
              if ((s[0]===tx&&s[1]===ty)||(s[2]===tx&&s[3]===ty)||onInterior(tx,ty,s)) {
                tJunction = true; break;
              }
            }
            if (tJunction) continue; // preserve T-junction, skip this merge
          }
          segs.splice(j, 1);
          segs.splice(i, 1);
          segs.push(merged);
          changed = true;
          break outer;
        }
      }
    }
  }

  // Reconstruct
  const wireOut = segs.map(w => `WIRE ${w[0]} ${w[1]} ${w[2]} ${w[3]}`);
  // Rebuild preserving original structure
  let result = [];
  let wireInserted = false;
  for (const l of lines) {
    if (l.trim().toUpperCase().startsWith('WIRE ')) {
      if (!wireInserted) {
        wireOut.forEach(w => result.push(w));
        wireInserted = true;
      }
    } else {
      result.push(l);
    }
  }
  if (!wireInserted) wireOut.forEach(w => result.push(w));
  return result.join('\n');
}

function _touchPoint(a, b) {
  // Returns the single shared endpoint where two collinear segments touch, or null.
  // Horizontal
  if (a[1]===a[3] && b[1]===b[3] && a[1]===b[1]) {
    const aMin=Math.min(a[0],a[2]), aMax=Math.max(a[0],a[2]);
    const bMin=Math.min(b[0],b[2]), bMax=Math.max(b[0],b[2]);
    if (aMax===bMin) return [aMax, a[1]];
    if (bMax===aMin) return [bMax, a[1]];
  }
  // Vertical
  if (a[0]===a[2] && b[0]===b[2] && a[0]===b[0]) {
    const aMin=Math.min(a[1],a[3]), aMax=Math.max(a[1],a[3]);
    const bMin=Math.min(b[1],b[3]), bMax=Math.max(b[1],b[3]);
    if (aMax===bMin) return [a[0], aMax];
    if (bMax===aMin) return [a[0], bMax];
  }
  return null;
}

function _tryMerge(a, b) {
  // Both horizontal
  if (a[1] === a[3] && b[1] === b[3] && a[1] === b[1]) {
    const aMin = Math.min(a[0],a[2]), aMax = Math.max(a[0],a[2]);
    const bMin = Math.min(b[0],b[2]), bMax = Math.max(b[0],b[2]);
    if (aMin <= bMax && bMin <= aMax) { // overlap or touching
      return [Math.min(aMin,bMin), a[1], Math.max(aMax,bMax), a[1]];
    }
  }
  // Both vertical
  if (a[0] === a[2] && b[0] === b[2] && a[0] === b[0]) {
    const aMin = Math.min(a[1],a[3]), aMax = Math.max(a[1],a[3]);
    const bMin = Math.min(b[1],b[3]), bMax = Math.max(b[1],b[3]);
    if (aMin <= bMax && bMin <= aMax) {
      return [a[0], Math.min(aMin,bMin), a[0], Math.max(aMax,bMax)];
    }
  }
  return null;
}
// ── End Stage 2 ────────────────────────────────────────────────────

// ── Stage 4: Junction detection (runs on final merged ASC) ────────────────
// Must run AFTER _mergeWires so merged segments are the source of truth.
// Parses WIRE lines from the ASC text, scores each endpoint for branch count,
// and inserts JUNCTION directives for genuine T-branch points (score >= 3).
export function _detectJunctions(ascText) {
  const lines = ascText.split('\n');
  const segs = [];
  for (const l of lines) {
    const t = l.trim().split(/\s+/);
    if (t[0] === 'WIRE' && t.length >= 5) {
      const [x1,y1,x2,y2] = t.slice(1,5).map(Number);
      if (x1!==x2||y1!==y2) segs.push([x1,y1,x2,y2]);
    }
  }
  const ptInside = (px,py,w) => {
    if (w[0]===w[2]) return px===w[0] && py>Math.min(w[1],w[3]) && py<Math.max(w[1],w[3]);
    if (w[1]===w[3]) return py===w[1] && px>Math.min(w[0],w[2]) && px<Math.max(w[0],w[2]);
    return false;
  };
  const pts = new Set();
  for (const w of segs) { pts.add(w[0]+','+w[1]); pts.add(w[2]+','+w[3]); }
  const junctions = [];
  for (const key of pts) {
    const [px,py] = key.split(',').map(Number);
    let count = 0;
    for (const w of segs) {
      const atEnd = (w[0]===px&&w[1]===py)||(w[2]===px&&w[3]===py);
      const inside = ptInside(px,py,w);
      if (atEnd)  count += 1;
      if (inside) count += 2;
    }
    if (count >= 3) junctions.push([px,py]);
  }
  if (!junctions.length) return ascText;
  // Insert JUNCTION lines immediately after the last WIRE line
  const result = [];
  let lastWireIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toUpperCase().startsWith('WIRE ')) lastWireIdx = i;
  }
  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);
    if (i === lastWireIdx) {
      for (const j of junctions) result.push(`JUNCTION ${j[0]} ${j[1]}`);
    }
  }
  return result.join('\n');
}
// ── End Stage 4 ────────────────────────────────────────────────────────────
