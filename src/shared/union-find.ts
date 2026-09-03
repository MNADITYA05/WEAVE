/**
 * union-find.ts — Generic path-compressed union-find
 *
 * Single canonical implementation used by asc2net, verifier, and schematic-editor.
 * All three previously kept private copies; this replaces them all.
 */

export class UF {
  private p = new Map<string, string>();

  find(k: string): string {
    if (!this.p.has(k)) this.p.set(k, k);
    let r = k;
    while (this.p.get(r) !== r) r = this.p.get(r)!;
    while (this.p.get(k) !== r) { const n = this.p.get(k)!; this.p.set(k, r); k = n; }
    return r;
  }

  union(a: string, b: string): void {
    this.p.set(this.find(a), this.find(b));
  }
}
