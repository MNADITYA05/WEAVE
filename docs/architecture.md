# Weave — System Architecture

This document is the single-page map of the entire Weave system. Read this first. Every other doc in the `/docs` folder is a deep-dive into one piece; this doc explains how the pieces fit together.

---

## What Weave Is

Weave is a browser-based Electronic Design Automation (EDA) suite. You give it a plain-text circuit description (called a SPICE netlist), and it does three things:

1. **Tab 1** — Converts the netlist into a visual schematic that LTspice can open.
2. **Tab 2** — Lets you draw and edit schematics interactively in the browser.
3. **Tab 3** — Runs circuit simulations and plots the results.

Think of it as: **describe → draw → simulate**.

The three tabs are not fully independent. They share data with each other in specific, deliberate ways documented in this file.

---

## The Two Halves: Frontend and Backend

Weave is split into two programs that run at the same time:

```
┌─────────────────────────────────────────────────┐
│               BROWSER (Frontend)                │
│                                                 │
│  Tab 1       Tab 2         Tab 3                │
│  Netlist     Schematic     Simulation           │
│  → .asc      Editor        Results              │
│                                                 │
│  Built with: TypeScript + Vite                  │
└────────────────────┬────────────────────────────┘
                     │  HTTP (port 8000)
                     │  /simulate, /validate, /ping
┌────────────────────▼────────────────────────────┐
│               SERVER (Backend)                  │
│                                                 │
│  FastAPI (Python)                               │
│  Calls ngspice to run simulations               │
│  Returns raw output files and logs              │
│                                                 │
│  Built with: FastAPI + uvicorn + ngspice        │
└─────────────────────────────────────────────────┘
```

**The frontend** (everything in `src/`) runs entirely inside the user's browser. It handles all UI, all drawing, all file conversion, and all data formatting. It is built with TypeScript and bundled by Vite. The browser itself does the heavy lifting for conversion and layout.

**The backend** (everything in `backend/`) is a small Python server whose only job is to invoke the `ngspice` simulator — a program that cannot run inside a browser — and return the results. It does not store any state. Every request is self-contained.

**The key distinction:** everything except running ngspice happens in the browser. The backend is thin on purpose.

---

## The Three Tabs in Detail

### Tab 1 — Netlist Converter

**Input:** A SPICE netlist (plain text, typically `.sp` or `.net`)
**Output:** An LTspice schematic file (`.asc`)

Tab 1 takes a text description of a circuit and turns it into a visual diagram. This is the automated drawing step — the user does not have to place components by hand.

The conversion runs entirely in the browser through a multi-stage pipeline:

```
Stage 0:  Resolve component libraries (stdlib_db.json)
Stage 1:  Parse the netlist text into data structures
Stage 2:  Build a graph of components and nets
Stage 3:  Classify each net (GND, power rail, signal)
Stage 4:  BFS depth assignment (drives component rotation)
Stage 5:  ELK layout (positions every component)
Stage 6:  Orientation assignment (which pin goes on which side)
Stage 7:  Port placement (exact pin coordinates)
Stage 8:  Wire routing (connects pins with wires)
Stage 9:  Feedback element placement (op-amp loops, dividers)
Stage 10: .asc file serialisation
```

The most complex stage is ELK layout (Stage 5), which uses a separate Web Worker thread so the UI does not freeze during computation. ELK is a graph layout library from the Eclipse project — it treats components as boxes and nets as edges, and figures out where to place everything. See `elk.md` for a full explanation.

The output `.asc` file is offered as a download. It can also be passed directly to Tab 2 for editing.

**Data dependencies:** Tab 1 reads `stdlib_db.json` at startup (~370 KB, loaded once) to resolve component names that are part of the LTspice standard library.

---

### Tab 2 — Schematic Editor

**Input:** A user-drawn schematic (or a `.asc` file loaded from disk or from Tab 1)
**Output:** A `.asc` file for download, or a netlist for Tab 3

Tab 2 is an interactive drawing tool built directly on the browser's Canvas API. The user places components, draws wires, adds labels, and runs Electrical Rules Checks (ERC).

The editor maintains a complete undo/redo history. Every change (wire drawn, component moved, label added) is recorded as a snapshot that can be stepped backward and forward.

When the user clicks **Send to Simulator**, Tab 2 exports the current schematic as a SPICE netlist and writes it to browser `localStorage`. Tab 3 listens for this event and picks up the netlist automatically.

**Key internal concepts:**

- **R0 coordinate space:** All internal coordinates are in "R0 space" — multiples of 16. The canvas pixel coordinates you see on screen are R0 × zoom. All `.asc` coordinates are also R0.
- **Union-Find for nets:** When Tab 2 exports a netlist, it figures out which pins are connected by using a Union-Find data structure. Think of it like stapling name badges together — any two pins joined by a wire get the same label, and the whole connected group is one electrical net.
- **ERC checks five things:** floating pins, missing GND, duplicate net labels, components with no connections, and overlapping pins.

**Data dependencies:** Tab 2 reads `symbols_db.json` (~82 KB, static) to know what component symbols are available and where their pins are. It also uses `symbols.json` (~5.5 MB, generated) for the actual SVG geometry of each symbol.

---

### Tab 3 — Simulator

**Input:** A SPICE netlist (from Tab 2 via localStorage, or pasted directly)
**Output:** Waveform plots and/or data tables

Tab 3 sends the netlist to the backend, which runs ngspice and returns the results. The frontend then plots the waveforms.

The communication flow is:

```
Browser (Tab 3)                    Backend (FastAPI)
      │                                   │
      │── POST /simulate ────────────────►│
      │   { netlist, type, params }       │
      │                                   │── ngspice -b ──► ngspice process
      │                                   │◄── .raw output + log ──
      │◄── { traces, log, tf_table } ─────│
      │                                   │
      │  plots waveforms on canvas        │
```

For AC simulations, ngspice returns complex number pairs `[real, imaginary]` for each frequency point. The browser converts these to magnitude (in decibels) or phase (in degrees) for the Bode plot — this computation happens client-side, not on the server.

**Timeout safety:** There are two independent timeout layers. The backend kills ngspice after 30 seconds. The browser cancels its own HTTP request after 35 seconds. The 5-second gap ensures the backend has time to clean up before the browser gives up.

**Data dependencies:** Tab 3 does not use `stdlib_db.json` or `symbols_db.json`. The only data it sends to the backend is the netlist text, and the only data it receives back is the simulation output.

---

## How the Tabs Share Data

There are three data-sharing paths between tabs:

### Path 1: Tab 1 → Tab 2 (file download / load)
Tab 1 produces a `.asc` file. The user downloads it and then loads it into Tab 2 manually. There is no automatic handoff — the user controls when to move from conversion to editing.

### Path 2: Tab 2 → Tab 3 (localStorage + storage event)
When the user clicks **Send to Simulator** in Tab 2, the netlist is written to `localStorage` under a known key. Tab 3 watches for the `storage` event and reads the new netlist immediately. On window focus (in case the storage event was missed), Tab 3 also polls localStorage. This means Tab 2 and Tab 3 must be open in the same browser window — different browsers or different devices will not see each other's localStorage.

### Path 3: Tab 3 → Backend (HTTP POST)
Tab 3 sends the netlist to the backend via a POST request to `/simulate`. The backend has no memory of previous requests — each call is independent.

```
Tab 1  ──(download .asc / user re-loads)──►  Tab 2
Tab 2  ──(localStorage storage event)──────►  Tab 3
Tab 3  ──(HTTP POST /simulate)─────────────►  Backend
```

---

## The Data Files

Three static/generated data files are loaded by the frontend:

| File | Size | Who uses it | What it contains |
|---|---|---|---|
| `stdlib_db.json` | ~370 KB | Tab 1 | Component names from LTspice standard library (slim — type and pin names only) |
| `symbols_db.json` | ~82 KB | Tab 2 | Component catalogue — what symbols exist and where their pins are |
| `symbols.json` | ~5.5 MB | Tab 2 | SVG geometry for rendering each symbol on the canvas |

`stdlib_db.json` and `symbols.json` are **generated** from a local LTspice installation by running developer scripts on a Mac. They are committed to the repo. `symbols_db.json` is a hand-curated static file.

If the LTspice component library changes in a future LTspice release, these generated files must be rebuilt. See `data-pipeline.md` for how.

---

## The Backend in More Detail

The backend is a FastAPI application in `backend/`. It exposes three endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/ping` | GET | Health check — returns `{"status": "ok"}` |
| `/simulate` | POST | Run ngspice on the submitted netlist |
| `/validate` | POST | Syntax-check a netlist without running it |

The backend has **no database** and **no session state**. Each HTTP request is completely independent.

**ngspice** is the actual simulation engine. It is an open-source SPICE simulator that reads a netlist, solves the circuit equations, and writes a binary `.raw` output file. The backend reads that file, parses it into JSON, and returns it to the browser.

**CORS** is set to wildcard (`*`) — any origin can call the backend. This is fine for local development but should be restricted in production.

---

## The Build System

**Frontend:** Vite 5 + TypeScript 5. The entry point is `src/main.ts`. Each tab is a TypeScript module. ELK runs in a Web Worker (`src/tab1/elk-worker.ts`). Running `npm run dev` starts a local dev server on port 5173 with hot module reload.

**Backend:** Python 3 + FastAPI + uvicorn. Running `uvicorn main:app --reload` starts the backend on port 8000.

**Docker Compose:** `docker-compose.yml` runs both services together. The frontend container builds the static files and serves them via Vite's preview mode. The backend container runs uvicorn. Both are on the same Docker network so the frontend can reach the backend at `http://backend:8000`.

---

## File Structure (Top Level)

```
weave/
├── src/                    Frontend TypeScript source
│   ├── tab1/               Netlist → .asc pipeline
│   ├── tab2/               Schematic editor
│   ├── tab3/               Simulator UI
│   └── main.ts             Entry point — tab switching logic
│
├── backend/                Python FastAPI server
│   ├── main.py             Entry point — route definitions
│   ├── simulator.py        ngspice invocation and .raw parsing
│   └── validator.py        Netlist syntax checker
│
├── data/                   Static and generated data files
│   ├── stdlib_db.json      LTspice standard library (slim)
│   ├── symbols_db.json     Component catalogue (static)
│   └── symbols.json        SVG geometry (generated)
│
├── docs/                   This documentation folder
├── public/                 Static assets served by Vite
├── docker-compose.yml      Two-service Docker setup
├── vite.config.ts          Vite build configuration
└── package.json            Node dependencies
```

---

## Where to Go Next

| If you want to understand... | Read... |
|---|---|
| The full Tab 1 conversion pipeline | `tab1-pipeline.md` |
| The Tab 2 schematic editor internals | `tab2-editor.md` |
| The Tab 3 simulation flow and waveform viewer | `tab3-simulator.md` |
| How ELK lays out components | `elk.md` |
| How the data files are generated | `data-pipeline.md` |
| How stdlib resolution works | `stdlib.md` |
| How to run Weave with Docker | `docker.md` |
| How to set up a local dev environment | `contributing.md` |
