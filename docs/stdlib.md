# Standard Library Resolver

The standard library resolver (`src/tab1/lib-resolver.ts`) is Stage 0 of the Tab 1 pipeline. It automatically injects component definitions from the pre-built LTspice standard library so that netlists referencing built-in parts can be converted without the user needing to supply `.lib` files.

---

## The Two Situations

### Situation 1 — Inline definitions

The netlist already contains all `.model` and `.subckt` definitions inline:

```spice
.model MyDiode D(Is=1e-14 N=1)
D1 anode cathode MyDiode
```

Stage 0 does nothing — the parser sees the definition immediately. This is the simple case.

### Situation 2 — External library references

The netlist references parts by name without providing definitions:

```spice
D1 anode cathode 1N4148
```

or via a `.lib` directive:

```spice
.lib standard.lib
D1 anode cathode 1N4148
```

Stage 0 must resolve `1N4148` — look it up in `stdlib_db.json` and inject the definition before the parser runs. If it cannot be resolved (not in stdlib, not pasted inline), it adds `1N4148` to the `missingLibs[]` array.

---

## `stdlib_db.json`

### What it is

A pre-parsed snapshot of the LTspice standard component library, stored in `data/stdlib_db.json`. The file is fetched by the browser at startup (≈370 KB, gzip-compressed to ~80 KB over the network).

### Structure

```json
{
  "models": {
    "1n4148": { "type": "d" },
    "2n3904": { "type": "npn" },
    "lm741":  { "type": "npn" },
    ...
  },
  "subckts": {
    "lm358": { "pins": ["in+", "in-", "v+", "v-", "out"] },
    "ad8232": { "pins": ["inp", "inn", "ref", "vs+", "vs-", "out"] },
    ...
  }
}
```

**Models** — simple `.model` components (diodes, BJTs, MOSFETs, etc.). Each entry records only the type code (`d`, `npn`, `pnp`, `nmos`, `pmos`, `njf`, `pjf`). The full model parameter string is not included (slim version).

**Subckts** — subcircuit components (op-amps, ICs, etc.). Each entry records only the pin names — the body text (actual `.subckt ... .ends` block) is not included.

### Why slim?

The slim version (no body text) is all that Stage 0 needs: to know whether a name resolves, what type it is, and what pins it has. Sending the full 6.5 MB body file to the browser would waste bandwidth and memory for no benefit — the browser's SPICE parser only needs the pin interface, not the internal implementation.

The full version (`data/stdlib_db_full.json`, 6.5 MB) is available for backend use, where the actual subckt body is needed for simulation.

### Stats

| File | Models | Subckts | Size |
|---|---|---|---|
| `stdlib_db.json` (slim) | ~3,523 | ~5,280 | ~370 KB |
| `stdlib_db_full.json` (full) | ~3,523 | ~5,280 | ~6.5 MB |

---

## `lib-resolver.ts` API

```typescript
// Resolves on startup — fetches stdlib_db.json once
export const stdlibReady: Promise<void>;

// Result of resolving a netlist
interface ResolveResult {
  text: string;           // enriched netlist (with injected definitions)
  missingLibs: string[];  // names that could not be resolved
}

// Stage 0: resolve stdlib references in a netlist
export function resolveStdlib(netlistText: string): ResolveResult;

// Inject user-uploaded .lib file contents into a netlist
export function injectUserLibs(netlistText: string, libTexts: string[]): string;
```

### `resolveStdlib(text)` — how it works

1. Split text into lines; join continuation lines (those starting with `+`)
2. Scan for `.lib <filename>` and `.inc <filename>` directives — mark those filenames as "referenced libs"
3. Scan for component lines (`R`, `C`, `D`, `Q`, `M`, `X`, etc.) — extract the model/subckt name from the last token
4. For each referenced name, look it up in the in-memory stdlib index (populated from `stdlib_db.json`):
   - **Found as a model:** inject `.model <name> <type>(...)` inline at the top of the text
   - **Found as a subckt:** inject `.subckt <name> <pins>\n* [stdlib reference]\n.ends <name>` as a stub (the actual parameters come from ngspice's own library at simulation time)
   - **Not found:** add to `missingLibs[]`
5. Strip `.lib` directives for filenames that were fully resolved (to avoid ngspice looking for files that don't exist in the temp dir)
6. Return the enriched text and the `missingLibs` array

### `injectUserLibs(text, libTexts)` — user upload path

When the user uploads `.lib` / `.sub` files to resolve missing parts (via the yellow bar in Tab 1):

1. Each uploaded file's text is prepended to the netlist as inline definitions
2. `resolveStdlib` is called again on the combined text
3. The pipeline re-runs automatically

---

## Missing-libs UI

After `convert()` returns, `app.ts` checks the `missingLibs` array:

```typescript
const { asc, missingLibs } = await convert(netlistText);

if (missingLibs.length > 0) {
  showMissingLibsBar(missingLibs);   // yellow bar at top of Tab 1
} else {
  hideMissingLibsBar();
}
```

The yellow bar:
- Lists the unresolved part names
- Shows a file-upload button (`Browse…` accepting `.lib`, `.sub`, `.mod`)
- On upload, calls `injectUserLibs` and re-runs `convert()`

---

## Building `stdlib_db.json` (`build_stdlib.py`)

`build_stdlib.py` is a Mac-side developer script that rebuilds `stdlib_db.json` from the LTspice installation. Run it in your Mac terminal (not the Linux VM):

```bash
python3 ~/Desktop/weave/build_stdlib.py
```

### What it scans

- `~/Library/Application Support/LTspice/lib/cmp/*.cmp` — component model files (`.model` lines)
- `~/Library/Application Support/LTspice/lib/sub/*.sub` — subcircuit files (`.subckt` blocks and embedded `.model` lines)

### How it extracts data

```python
def extract_models_from_lines(lines):
    """Extract .model lines — called on both .cmp files and inside .sub file parsers."""
    for ln in lines:
        m = re.match(r"^\s*\.model\s+(\S+)\s+(\S+)", ln, re.IGNORECASE)
        if m:
            name = m.group(1).lower()
            typ  = m.group(2).lower().rstrip("(")
            if name not in models:
                models[name] = {"type": typ}

def parse_sub_file(path):
    """Parse a .sub file: extract embedded .model lines AND .subckt blocks."""
    text = open(path).read()
    lines = join_continuations(text)
    extract_models_from_lines(lines)   # <-- picks up .model lines inside .sub files
    # then parse .subckt ... .ends blocks
    ...
```

> **Note:** The key fix that restored ~958 missing models (from 2565 to 3523) was adding `extract_models_from_lines()` inside `parse_sub_file()`. Many LTspice `.sub` files embed `.model` lines alongside their `.subckt` blocks.

### Output

```bash
✅ Wrote data/stdlib_db.json      — 3523 models, 5280 subckts (slim, 367 KB)
✅ Wrote data/stdlib_db_full.json — 3523 models, 5280 subckts (full, 6573 KB)
```

The slim file is committed to the repo and served to the browser. The full file is gitignored by default (too large for routine commits) but can be used locally for backend development.

---

## Updating the Library

When LTspice releases a new version with updated component libraries:

1. Install the new LTspice on your Mac
2. Run `python3 ~/Desktop/weave/build_stdlib.py`
3. Verify the new counts look reasonable (should be ≥ 3523 models)
4. Commit the updated `data/stdlib_db.json`
