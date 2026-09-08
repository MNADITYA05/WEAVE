# Contributing to Weave

This document is for anyone who wants to run Weave locally, understand the folder structure, or make changes to the code. Read `architecture.md` first to understand what each part of the system does before diving into setup.

---

## Prerequisites

You need four things installed on your Mac before you can run Weave:

| Tool | Minimum version | What it's for |
|---|---|---|
| Node.js | 18.x | Running the frontend dev server |
| npm | 9.x (comes with Node) | Installing JavaScript packages |
| Python | 3.10+ | Running the backend server |
| ngspice | Any recent version | Running circuit simulations |

**LTspice** is also needed if you want to regenerate the data files (`stdlib_db.json`, `symbols.json`). It is not needed just to run the app.

### Installing ngspice on a Mac

```bash
brew install ngspice
```

Verify it works:

```bash
ngspice --version
```

If this prints a version number, you are good. If you see "command not found", ngspice is not on your PATH — check `brew doctor` or add `/usr/local/bin` to your PATH.

---

## Running Weave Locally (Without Docker)

This is the recommended approach for development because you get hot reload — the browser updates automatically when you save a file.

### Step 1 — Clone the repository

```bash
git clone <repo-url>
cd weave
```

### Step 2 — Install frontend dependencies

```bash
npm install
```

This reads `package.json` and downloads all JavaScript packages into `node_modules/`. It takes about 30 seconds on first run.

### Step 3 — Start the backend

Open a terminal and run:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

`--reload` means the backend restarts automatically when you save a Python file. Leave this terminal running.

Verify the backend is up:

```bash
curl http://localhost:8000/ping
```

You should see `{"status":"ok"}`.

### Step 4 — Start the frontend

Open a second terminal and run:

```bash
npm run dev
```

Vite starts a dev server on port 5173. Open `http://localhost:5173` in your browser.

You now have both services running. Any change you make to a `.ts` file in `src/` will hot-reload in the browser within a second or two. Changes to Python files in `backend/` will restart the backend automatically.

### Stopping

`Ctrl+C` in each terminal stops the respective service.

---

## Running Weave With Docker

If you do not want to install Python and ngspice locally, Docker Compose runs everything in containers.

### Prerequisites for Docker

- Docker Desktop installed and running

### Start everything

```bash
docker-compose up --build
```

`--build` forces a rebuild of the container images. On first run this takes 2–3 minutes (it installs ngspice inside the container). Subsequent runs are faster.

Open `http://localhost:5173`.

### Stopping

```bash
docker-compose down
```

### When to use Docker vs local

Use **local** when you are actively developing — hot reload makes iteration much faster.

Use **Docker** when you want to verify the production build works, or when you are onboarding and do not want to install dependencies.

---

## Folder Structure

```
weave/
├── src/                    All frontend TypeScript
│   ├── tab1/               Netlist → .asc conversion pipeline
│   │   ├── app.ts          Tab 1 entry point
│   │   ├── lib-resolver.ts Stage 0: stdlib resolution
│   │   ├── parser.ts       Stage 1: netlist parsing
│   │   ├── graph.ts        Stage 2–3: graph and net classification
│   │   ├── bfs.ts          Stage 4: BFS depth assignment
│   │   ├── elk-worker.ts   Stage 5: ELK layout (Web Worker)
│   │   ├── orientation.ts  Stage 6: pin-side assignment
│   │   ├── router.ts       Stage 8–9: wire routing
│   │   └── serialiser.ts   Stage 10: .asc file output
│   │
│   ├── tab2/               Interactive schematic editor
│   │   ├── schematic-editor.ts   Main editor class
│   │   ├── history.ts            Undo/redo state management
│   │   ├── erc.ts                Electrical Rules Check
│   │   ├── export.ts             Netlist export (Union-Find)
│   │   └── symbols.ts            Symbol loading and rendering
│   │
│   ├── tab3/               Simulation UI
│   │   ├── app.ts          Tab 3 entry point
│   │   ├── client.ts       HTTP calls to backend
│   │   ├── parser.ts       .raw file parsing
│   │   └── waveform.ts     Canvas waveform viewer
│   │
│   └── main.ts             App entry — tab switching
│
├── backend/                Python FastAPI server
│   ├── main.py             Routes: /ping, /simulate, /validate
│   ├── simulator.py        ngspice invocation, .raw parsing
│   └── validator.py        Netlist syntax check
│
├── data/                   Data files served to browser
│   ├── stdlib_db.json      LTspice standard library (generated, ~370 KB)
│   ├── symbols_db.json     Component catalogue (static, ~82 KB)
│   └── symbols.json        SVG geometry (generated, ~5.5 MB)
│
├── docs/                   Documentation (you are here)
├── public/                 Static assets (favicon, etc.)
├── build_stdlib.py         Developer script: regenerates stdlib_db.json
├── build_symbols.py        Developer script: regenerates symbols.json
├── docker-compose.yml      Two-service Docker configuration
├── Dockerfile.backend      Backend container definition
├── Dockerfile.frontend     Frontend container definition
├── vite.config.ts          Vite build configuration
├── tsconfig.json           TypeScript compiler options
└── package.json            Node.js dependencies
```

---

## The Data Files

Three files in `data/` are loaded by the browser at runtime. Two of them are **generated** from a local LTspice installation — they are not hand-written, and they are committed to the repo so other developers do not need LTspice just to run the app.

| File | Source | How to regenerate |
|---|---|---|
| `stdlib_db.json` | LTspice component library | `python3 build_stdlib.py` on Mac with LTspice installed |
| `symbols.json` | LTspice symbol files | `python3 build_symbols.py` on Mac with LTspice installed |
| `symbols_db.json` | Hand-written | Edit directly; no regeneration needed |

**Important:** The build scripts are Mac-only and read from `~/Library/Application Support/LTspice/`. They cannot run on Linux or Windows. If you are on Linux and need to regenerate these files, you must run the scripts on a Mac (or a Mac VM) and commit the results.

If LTspice updates its component library, the committed `stdlib_db.json` and `symbols.json` will become stale. Regenerate them by running both build scripts after installing the new LTspice version.

---

## Making Changes

### Frontend changes (TypeScript in `src/`)

The Vite dev server hot-reloads on save. No restart needed. TypeScript type errors are reported in the terminal running `npm run dev` and in your editor.

To run the TypeScript type checker manually without starting the dev server:

```bash
npx tsc --noEmit
```

This checks all types and exits. It does not build any files.

### Backend changes (Python in `backend/`)

`uvicorn --reload` restarts the server automatically on save. No manual restart needed.

### Adding a new component to the symbol library

1. Verify the component exists in your local LTspice installation (look in `~/Library/Application Support/LTspice/lib/sym/`).
2. Run `python3 build_symbols.py` to regenerate `symbols.json`.
3. If the component has models or subcircuits, run `python3 build_stdlib.py` to regenerate `stdlib_db.json`.
4. Add an entry to `symbols_db.json` (the static catalogue) so Tab 2 knows the component exists and where its pins are.
5. Verify the component appears in Tab 2's component picker and renders correctly.

### Changing the ELK layout algorithm

The ELK configuration lives in `src/tab1/elk-worker.ts`. Changes there affect how all components are positioned. After any change to the ELK configuration, test with at least:
- A simple voltage divider (two resistors, one source)
- An op-amp circuit with feedback
- A circuit with a differential pair

ELK runs in a Web Worker, so console logs inside `elk-worker.ts` appear in the browser's DevTools under the "Worker" thread, not the main thread.

### Changing the wire router

The router is in `src/tab1/router.ts`. It has 12 sub-stages (A through L). Changes to the router can easily break wire routing for circuits that were previously working — test broadly after any router change.

---

## Common Development Issues

### "ngspice: command not found" in the backend

The backend calls ngspice by name. If ngspice is not on the system PATH, every `/simulate` request will fail with a 500 error.

Fix: Install ngspice (`brew install ngspice`) and verify `which ngspice` returns a path.

### Frontend cannot reach the backend

The frontend expects the backend on `http://localhost:8000`. If the backend is not running or is on a different port, Tab 3 will show a network error.

Fix: Start the backend with `uvicorn main:app --port 8000` and verify `/ping` returns `{"status":"ok"}`.

### Hot reload is not working

If file changes are not appearing in the browser, check:
1. Is the Vite dev server still running (`npm run dev` in terminal)?
2. Did a TypeScript error prevent compilation? Check the terminal for red error output.
3. Hard-refresh the browser (`Cmd+Shift+R` on Mac) to clear any stale cached modules.

### `stdlib_db.json` is missing or empty

The browser fetches this file at startup. If it is missing from `data/`, Tab 1 will fail to resolve any standard library components.

Fix: Run `python3 build_stdlib.py` on a Mac with LTspice installed, or copy the file from another developer's machine.

### ELK layout produces a blank or jumbled result

This usually means ELK timed out (default timeout: 30 seconds for complex circuits). Check the browser console for "ELK timeout" messages. The fallback is a grid layout which is rarely readable for complex circuits.

If ELK is consistently timing out on a specific circuit, the circuit may have a topology that confuses ELK — check the feedback classifier output and whether any components are being excluded from ELK layout when they should not be.

---

## Code Style

The project does not have a strict linter configuration, but follow these conventions:

- TypeScript: use explicit types, no `any` unless truly unavoidable.
- Python: PEP 8 formatting; functions that call ngspice should be clearly separated from functions that parse its output.
- Comments: explain *why*, not *what*. The code shows what it does; the comment should explain why that choice was made.
- No console.log left in committed code unless it is behind a `DEBUG` flag.

---

## Pull Request Guidelines

Before opening a pull request:

1. Run `npx tsc --noEmit` — zero type errors required.
2. Manually test Tab 1, Tab 2, and Tab 3 with a non-trivial circuit.
3. If you changed ELK configuration or the wire router, test with at least three different circuit topologies.
4. Update the relevant doc in `docs/` if your change affects documented behaviour.
5. Do not commit generated files (`stdlib_db.json`, `symbols.json`) unless you intentionally regenerated them for a reason stated in the PR description.

**No git commits or pushes from automated scripts.** All commits must be made manually by a human after reviewing the changes.

---

## Getting Help

If you are stuck on something not covered here:

- Read the deep-dive doc for the relevant component (`tab1-pipeline.md`, `tab2-editor.md`, `tab3-simulator.md`, `elk.md`).
- Search the source file for the function name mentioned in the error — the code is the ground truth.
- Check the browser DevTools console (F12) — most runtime errors in the frontend appear there with a stack trace.
- Check the uvicorn terminal — backend errors print there with a full Python traceback.
