/**
 * wire-merge.ts — Wire bend reduction and junction detection
 *
 * Two post-processing passes on a raw ASC text string:
 *
 *   mergeWires()     — Collapses collinear, touching wire segments into
 *                      single longer segments. Deduplicates exact duplicates.
 *                      Preserves T-junctions: if the shared touch point is used
 *                      by a third segment, the merge is skipped.
 *
 *   detectJunctions() — Inserts JUNCTION directives at every point where three
 *                       or more wire segments meet (T-branch or crossroads).
 *                       Must run AFTER mergeWires so merged segments are the
 *                       canonical source of truth.
 *
 * Both functions are pure text transforms: string in, string out.
 */

/** A wire segment as [x1, y1, x2, y2] integer coords. */
type Seg = [number, number, number, number];

// ─── mergeWires ──────────────────────────────────────────────────────────────

/**
 * Merge collinear touching wire segments in an ASC text string.
 *
 * @param ascText - Raw ASC text (may contain WIRE lines to merge)
 * @returns ASC text with collinear segments collapsed and duplicates removed
 */
export function mergeWires(ascText: string): string {
  const lines = ascText.split('\n');
  const wireLines: Seg[] = [];
  const otherLines: string[] = [];

  for (const l of lines) {
    if (l.trim().toUpperCase().startsWith('WIRE ')) {
      const p = l.trim().split(/\s+/);
      if (p.length >= 5) {
        wireLines.push([
          parseInt(p[1]!, 10),
          parseInt(p[2]!, 10),
          parseInt(p[3]!, 10),
          parseInt(p[4]!, 10),
        ]);
      } else {
        otherLines.push(l);
      }
    } else {
      otherLines.push(l);
    }
  }

  // Deduplicate exact segments (same endpoints, any direction)
  let segs: Seg[] = [...new Map(
    wireLines.map(w => {
      const [x1, y1, x2, y2] = w;
      const key = x1 < x2 || (x1 === x2 && y1 < y2)
        ? `${x1},${y1},${x2},${y2}`
        : `${x2},${y2},${x1},${y1}`;
      return [key, w] as [string, Seg];
    })
  ).values()];

  // Iteratively merge collinear touching pairs (T-junction safe)
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i]!;
        const b = segs[j]!;
        const merged = tryMerge(a, b);
        if (!merged) continue;

        const tp = touchPoint(a, b);
        if (tp) {
          const [tx, ty] = tp;
          let tJunction = false;
          for (let k = 0; k < segs.length; k++) {
            if (k === i || k === j) continue;
            const s = segs[k]!;
            if (
              (s[0] === tx && s[1] === ty) ||
              (s[2] === tx && s[3] === ty) ||
              onInterior(tx, ty, s)
            ) {
              tJunction = true;
              break;
            }
          }
          if (tJunction) continue;
        }

        segs.splice(j, 1);
        segs.splice(i, 1);
        segs.push(merged);
        changed = true;
        break outer;
      }
    }
  }

  const wireOut = segs.map(w => `WIRE ${w[0]} ${w[1]} ${w[2]} ${w[3]}`);

  // Rebuild: replace the first batch of WIRE lines with merged set
  const result: string[] = [];
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

/** Returns true when point (px, py) lies strictly inside wire s (not at endpoints). */
function onInterior(px: number, py: number, s: Seg): boolean {
  if (s[0] === s[2]) {
    return s[0] === px && py > Math.min(s[1], s[3]) && py < Math.max(s[1], s[3]);
  }
  if (s[1] === s[3]) {
    return s[1] === py && px > Math.min(s[0], s[2]) && px < Math.max(s[0], s[2]);
  }
  return false;
}

/** Returns the single shared endpoint where two collinear segments touch, or null. */
function touchPoint(a: Seg, b: Seg): [number, number] | null {
  // Horizontal
  if (a[1] === a[3] && b[1] === b[3] && a[1] === b[1]) {
    const aMin = Math.min(a[0], a[2]), aMax = Math.max(a[0], a[2]);
    const bMin = Math.min(b[0], b[2]), bMax = Math.max(b[0], b[2]);
    if (aMax === bMin) return [aMax, a[1]];
    if (bMax === aMin) return [bMax, a[1]];
  }
  // Vertical
  if (a[0] === a[2] && b[0] === b[2] && a[0] === b[0]) {
    const aMin = Math.min(a[1], a[3]), aMax = Math.max(a[1], a[3]);
    const bMin = Math.min(b[1], b[3]), bMax = Math.max(b[1], b[3]);
    if (aMax === bMin) return [a[0], aMax];
    if (bMax === aMin) return [a[0], bMax];
  }
  return null;
}

/** Merge two collinear, overlapping or touching segments into one. Returns null if not mergeable. */
function tryMerge(a: Seg, b: Seg): Seg | null {
  // Both horizontal
  if (a[1] === a[3] && b[1] === b[3] && a[1] === b[1]) {
    const aMin = Math.min(a[0], a[2]), aMax = Math.max(a[0], a[2]);
    const bMin = Math.min(b[0], b[2]), bMax = Math.max(b[0], b[2]);
    if (aMin <= bMax && bMin <= aMax) {
      return [Math.min(aMin, bMin), a[1], Math.max(aMax, bMax), a[1]];
    }
  }
  // Both vertical
  if (a[0] === a[2] && b[0] === b[2] && a[0] === b[0]) {
    const aMin = Math.min(a[1], a[3]), aMax = Math.max(a[1], a[3]);
    const bMin = Math.min(b[1], b[3]), bMax = Math.max(b[1], b[3]);
    if (aMin <= bMax && bMin <= aMax) {
      return [a[0], Math.min(aMin, bMin), a[0], Math.max(aMax, bMax)];
    }
  }
  return null;
}

// ─── detectJunctions ─────────────────────────────────────────────────────────

/**
 * Insert JUNCTION directives at T-branch and crossroads points.
 *
 * A point is a junction when its branch score is ≥3:
 *   +1  for each wire that has this point as an endpoint
 *   +2  for each wire that passes through this point internally
 *
 * @param ascText - ASC text, ideally already merged by mergeWires()
 * @returns ASC text with JUNCTION lines inserted after the last WIRE line
 */
export function detectJunctions(ascText: string): string {
  const lines = ascText.split('\n');
  const segs: Seg[] = [];

  for (const l of lines) {
    const t = l.trim().split(/\s+/);
    if (t[0] === 'WIRE' && t.length >= 5) {
      const [x1, y1, x2, y2] = t.slice(1, 5).map(Number) as [number, number, number, number];
      if (x1 !== x2 || y1 !== y2) segs.push([x1, y1, x2, y2]);
    }
  }

  const ptInside = (px: number, py: number, w: Seg): boolean => {
    if (w[0] === w[2]) return px === w[0] && py > Math.min(w[1], w[3]) && py < Math.max(w[1], w[3]);
    if (w[1] === w[3]) return py === w[1] && px > Math.min(w[0], w[2]) && px < Math.max(w[0], w[2]);
    return false;
  };

  const pts = new Set<string>();
  for (const w of segs) {
    pts.add(`${w[0]},${w[1]}`);
    pts.add(`${w[2]},${w[3]}`);
  }

  const junctions: [number, number][] = [];
  for (const key of pts) {
    const [px, py] = key.split(',').map(Number) as [number, number];
    let count = 0;
    for (const w of segs) {
      if ((w[0] === px && w[1] === py) || (w[2] === px && w[3] === py)) count += 1;
      if (ptInside(px, py, w)) count += 2;
    }
    if (count >= 3) junctions.push([px, py]);
  }

  if (!junctions.length) return ascText;

  // Insert JUNCTION lines immediately after the last WIRE line
  let lastWireIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim().toUpperCase().startsWith('WIRE ')) lastWireIdx = i;
  }

  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]!);
    if (i === lastWireIdx) {
      for (const j of junctions) result.push(`JUNCTION ${j[0]} ${j[1]}`);
    }
  }
  return result.join('\n');
}

// ─── Deprecated aliases ───────────────────────────────────────────────────────

/** @deprecated Use mergeWires() */
export const _mergeWires = mergeWires;

/** @deprecated Use detectJunctions() */
export const _detectJunctions = detectJunctions;
