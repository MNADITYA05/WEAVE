# ⚡ Weave

![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Status](https://img.shields.io/badge/status-active-brightgreen?style=flat-square)
![Client-Side](https://img.shields.io/badge/fully-client--side-orange?style=flat-square)
![No Build](https://img.shields.io/badge/build%20step-none-lightgrey?style=flat-square)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)

> **One-liner:** A fully client-side, zero-dependency browser tool that converts SPICE netlists to interactive LTspice schematics — and draws schematics that generate netlists back.

---

## 📌 Table of Contents

- [The Problem](#-the-problem)
- [Our Solution & Purpose](#-our-solution--purpose)
- [Why This Over Others](#-why-this-over-others)
- [Tech Stack](#-tech-stack)
- [System Flow](#-system-flow)
- [File Structure](#-file-structure)
- [Prerequisites](#-prerequisites)
- [Installation & Setup](#-installation--setup)
- [Usage](#-usage)
- [Configuration](#-configuration)
- [Screenshots](#-screenshots)
- [Contribution Guidelines](#-contribution-guidelines)
- [Known Limitations & Roadmap](#-known-limitations--roadmap)
- [License](#-license)

---

## 🚨 The Problem

SPICE netlists are text — powerful, but completely opaque to anyone who isn't already familiar with the exact topology. Visualising them requires either expensive EDA software or manual re-drawing. Going the other direction — sketching a schematic and getting a simulation-ready netlist back — is even harder without a full EDA suite installed.

**Key pain points:**
- ⚠️ Existing SPICE-to-schematic converters require desktop installs or proprietary licences
- ⚠️ No browser-native tool lets you draw a schematic and instantly get a valid SPICE netlist
- ⚠️ LTspice `.asc` files are opaque XML-like formats with no readable round-trip path from a plain netlist
- ⚠️ Students and hobbyists have no lightweight, offline-capable tool for quick schematic work

---

## 🎯 Our Solution & Purpose

**Weave** is a browser-based EDA utility that provides a complete, bidirectional SPICE ↔ LTspice schematic workflow — with zero installation, zero server calls, and zero build step.

It solves the above by:
1. **Netlist → Schematic (Tab 1)** — Paste any SPICE netlist; Weave parses it, classifies topology, runs an elkjs auto-layout, and renders a downloadable LTspice `.asc` schematic.
2. **Schematic → Netlist (Tab 2)** — Use the interactive SVG canvas to place components, draw wires, and click Convert to get a simulation-ready SPICE netlist instantly.
3. **Fully client-side** — Everything runs in the browser. No backend, no accounts, no data leaves your machine.

---

## ⚡ Why This Over Others

| Feature | Weave | KiCad | LTspice | CircuitLab |
|---|:---:|:---:|:---:|:---:|
| Works in the browser | ✅ | ❌ | ❌ | ✅ |
| Zero install / no account | ✅ | ❌ | ❌ | ❌ |
| SPICE netlist → schematic | ✅ | ❌ | ❌ | ❌ |
| Schematic → SPICE netlist | ✅ | ✅ | ✅ | ✅ |
| LTspice `.asc` export | ✅ | ❌ | ✅ | ❌ |
| No build step required | ✅ | ❌ | ❌ | ❌ |
| Open source | ✅ | ✅ | ❌ | ❌ |
| Offline capable | ✅ | ✅ | ✅ | ❌ |

> 💡 **The bottom line:** Weave is the only open-source, browser-native tool that handles the full round-trip — from raw SPICE text to a rendered, downloadable schematic and back.

---

## 🛠 Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| Vanilla JavaScript (ES Modules) | ES2022 | All application logic — zero framework overhead |
| SVG | — | Interactive schematic canvas with pan, zoom, and grid |
| HTML5 / CSS3 | — | UI layout, tabs, dark theme |

### Layout Engine
| Technology | Version | Purpose |
|---|---|---|
| [elkjs](https://github.com/kieler/elkjs) | bundled | Automatic hierarchical graph layout for Tab 1 schematics |

### Parsing & Netlist Generation
| Technology | Version | Purpose |
|---|---|---|
| Custom SPICE parser (`netlist-parser.js`) | — | Tokenises and models SPICE netlist elements |
| Union-Find (DSU) | — | Wire connectivity → net name assignment in Tab 2 |
| Custom `.asc` emitter (`flag-emit.js`, `renderer.js`) | — | Produces valid LTspice schematic files |

### Dev Server
| Technology | Version | Purpose |
|---|---|---|
| Any static HTTP server | — | Serve `index.html` locally (e.g. `python3 -m http.server 8080`) |

---

## 🔄 System Flow

### Tab 1 — Netlist → Schematic

```mermaid
flowchart TD
    A([User pastes SPICE netlist]) --> B[netlist-parser.js\nTokenise & build component graph]
    B --> C[classifier.js\nDetect topology & component roles]
    C --> D[router.js + layout.js\nRun elkjs auto-layout]
    D --> E[renderer.js\nEmit LTspice .asc symbol blocks]
    E --> F[flag-emit.js\nAdd net labels & GND flags]
    F --> G([.asc file ready for download\nor SVG preview in browser])

    style A fill:#4F46E5,color:#fff,stroke:none
    style G fill:#059669,color:#fff,stroke:none
```

### Tab 2 — Schematic → Netlist

```mermaid
flowchart TD
    A([User places components\non SVG canvas]) --> B[schematic-editor.js\nTrack S.comps + S.wires state]
    B --> C[User clicks Convert]
    C --> D[generateNetlist\nCollect all pin world-coords]
    D --> E[Union-Find over wire segments\nMerge connected pins into nets]
    E --> F[Assign net names\nGND/VDD labels + N001 auto-names]
    F --> G([SPICE netlist displayed\nin panel + .net download])

    style A fill:#4F46E5,color:#fff,stroke:none
    style G fill:#059669,color:#fff,stroke:none
```

### Flow Explanation

| Step | Description |
|---|---|
| **Parse** | Raw SPICE text → structured component objects with node connections |
| **Classify** | Identify subcircuits, power rails, ground flags, and topology hints |
| **Layout** | elkjs assigns x/y positions and routing for each component |
| **Render** | Positions → LTspice `.asc` coordinate space with symbol references |
| **Canvas** | User clicks palette buttons, places components at snapped grid positions (16 px) |
| **Union-Find** | Each wire segment is scanned; all pin world-coordinates it passes through are unioned into a single net |
| **Emit** | Net map → SPICE element lines (R/C/L/V/I/D/Q/M/J/B/E/G/F/H/S/W/T/X) |

---

## 📁 File Structure

```
weave/
│
├── index.html                  # Single-page app shell; two-tab layout
├── landing.html                # Marketing landing page
│
├── css/
│   └── style.css               # Global dark-theme styles
│
├── lib/                        # Third-party libraries (elkjs bundle)
│
├── data/                       # Static reference data (symbol definitions, etc.)
│
├── src/                        # All application source — plain ES modules
│   ├── app.js                  # Entry point; mounts Tab 1 and Tab 2
│   │
│   ├── schematic-editor.js     # Tab 2: full interactive SVG editor
│   ├── schematic-symbols.js    # Component SVG shapes + pin coordinate definitions
│   │
│   ├── netlist-parser.js       # SPICE netlist tokeniser and AST builder
│   ├── asc2net.js              # .asc → netlist converter (reverse direction)
│   ├── classifier.js           # Topology classification (series/parallel/bridge etc.)
│   ├── convert.js              # Top-level Tab 1 conversion orchestrator
│   │
│   ├── layout.js               # elkjs layout wrapper
│   ├── router.js               # Wire routing logic
│   ├── route-helpers.js        # Geometry helpers for routing
│   ├── geometry.js             # General 2D geometry utilities
│   │
│   ├── renderer.js             # LTspice .asc symbol emitter
│   ├── flag-emit.js            # Net flag and GND symbol emitter
│   ├── symbols.js              # LTspice symbol name mapping
│   ├── orientation.js          # Component rotation logic
│   │
│   ├── topology.js             # Graph connectivity analysis
│   ├── wire-merge.js           # Wire segment simplification
│   ├── net-repair.js           # Net connectivity repair passes
│   ├── place-isolated.js       # Layout for isolated (unconnected) components
│   ├── place-repair.js         # Post-layout position repair
│   ├── safe-modes.js           # Fallback rendering strategies
│   └── verifier.js             # Output netlist sanity checks
│
└── tests/                      # Test fixtures and scripts
```

---

## 🧰 Prerequisites

No build tools, no package manager, no runtime dependencies to install.

| Requirement | Minimum Version | Check Command | Notes |
|---|---|---|---|
| Any modern browser | Chrome 90+ / Firefox 90+ / Safari 15+ | — | ES Modules + SVG required |
| Any static HTTP server | — | — | Needed to serve ES modules (can't use `file://`) |
| Git | v2.x | `git --version` | For cloning only |

> ⚠️ **`file://` won't work** — browsers block ES module imports from `file://` origins. Use any local HTTP server (examples below).

---

## 🚀 Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/weave.git
cd weave
```

### 2. Start a Local Server

Pick whichever is already on your machine:

```bash
# Python (built into macOS/Linux)
python3 -m http.server 8080

# Node.js (npx, no install needed)
npx serve .

# PHP
php -S localhost:8080
```

### 3. Open in Browser

```
http://localhost:8080
```

That's it. No `npm install`, no build step, no environment variables.

---

## 💡 Usage

### Tab 1 — Netlist → Schematic

1. Paste a SPICE netlist into the left panel (or pick one of the built-in examples from the dropdown).
2. Click **Convert**.
3. The schematic renders as an SVG on the right.
4. Click **Download .asc** to save a valid LTspice schematic file.

**Example input:**
```spice
* RC Low-pass filter
V1 in 0 AC 1
R1 in out 1k
C1 out 0 1n
.ac dec 100 1k 1Meg
.end
```

**Expected output:** A routed schematic SVG + downloadable `schematic.asc`.

### Tab 2 — Schematic → Netlist

1. Click a component in the **left palette** (Resistor, Capacitor, NPN BJT, etc.).
2. Click on the canvas to place it. Press **R** to rotate before placing.
3. Click **Wire** then click two points to draw a wire segment.
4. Click **Convert** to generate the SPICE netlist.
5. Click **.net** to download it.

### Keyboard Shortcuts (Tab 2)

| Key | Action |
|---|---|
| `R` | Rotate component while placing |
| `Escape` | Cancel current action / return to Select mode |
| `Delete` | Delete selected component |

### Common Workflows

| Task | Steps |
|---|---|
| Convert LTspice netlist to schematic | Tab 1 → paste netlist → Convert → Download .asc |
| Draw a circuit and simulate in LTspice | Tab 2 → draw → Convert → Download .net → open in LTspice |
| Inspect a SPICE file visually | Tab 1 → paste → view SVG preview in browser |

---

## ⚙️ Configuration

Weave is fully static — there are no environment variables or server configuration. The only tunables are inside the source files:

| Constant | File | Default | Description |
|---|---|---|---|
| `GRID` | `schematic-editor.js` | `16` | Canvas grid snap size in pixels |
| `?v=N` query strings | `app.js`, `index.html` | incremented manually | Cache-busting version for ES module imports |
| `elkjs` layout options | `layout.js` | see file | elk algorithm and spacing parameters |

---

## 🖼 Screenshots

| View | Description |
|---|---|
| **Tab 1 — Netlist → Schematic** | Paste a SPICE netlist; routed schematic appears with download button |
| **Tab 2 — Schematic → Netlist** | Interactive canvas: place components, draw wires, click Convert |

**Tab 2 verified circuits (all generating correct SPICE netlists):**

| Circuit | Netlist output |
|---|---|
| RC Series | `V1 N001 0 5 / R1 N002 N001 1k / C1 0 N002 1n` |
| RL Series | `V1 N001 0 12 / R1 N002 N001 100 / L1 0 N002 1m` |
| RLC Series | `V1 N001 0 10 / R1 N002 N001 50 / L1 N003 N002 10m / C1 0 N003 100n` |
| Voltage Divider | `V1 N001 0 10 / R1 N001 N002 10k / R2 N002 0 10k` |
| Diode Rectifier | `V1 N001 0 5 / D1 N002 N001 1N4148 / R1 0 N002 1k` |
| NPN Switch | `Rc VDD N001 1k / Q1 N001 N002 0 2N3904 / Rb N002 N003 100k / Vin N003 0 3` |
| RC Parallel | `V1 N001 0 5 / R1 N001 0 1k / C1 N001 0 1u` |
| Current Source + R | `I1 N001 0 1m / R1 N001 0 10k` |
| LED Driver | `V1 N001 0 3.3 / R1 N002 N001 330 / D1 0 N002 LED` |
| Wheatstone Bridge | `Vs N001 0 5 / Ra N001 N002 1k / Rb N001 N003 1k / Rc N002 0 1k / Rd N003 0 2k` |

---

## 🤝 Contribution Guidelines

We welcome contributions of all kinds — bug fixes, new component symbols, layout improvements, and documentation.

### Getting Started

1. **Fork** the repository
2. **Create** a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/your-bug-description
   ```
3. **Make** your changes — no build step required, just edit and refresh
4. **Push** to your fork and open a Pull Request

### Branch Naming Convention

| Type | Pattern | Example |
|---|---|---|
| New feature | `feat/[short-description]` | `feat/pmos-symbol` |
| Bug fix | `fix/[short-description]` | `fix/wire-connectivity` |
| Documentation | `docs/[short-description]` | `docs/update-usage` |
| Refactor | `refactor/[short-description]` | `refactor/netlist-parser` |
| New symbol | `symbol/[component-name]` | `symbol/opamp` |

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(scope): short description
```

**Examples:**
```
feat(editor): add MOSFET symbol with drain/gate/source pins
fix(netlist): correct union-find merge for T-junction wires
docs(readme): add 10-circuit verification table
symbol(opamp): add VCVS-based op-amp symbol
```

### Pull Request Checklist

- [ ] No breaking changes to existing netlists
- [ ] New symbols include correct pin coordinate definitions in `schematic-symbols.js`
- [ ] Wire connectivity verified (place + draw wire + Convert and check net names)
- [ ] No external dependencies added (keep it zero-dep)
- [ ] PR description explains *what* changed and *why*

> 💬 For major changes (new layout engine, new parser), open an issue first to discuss before investing time.

---

## 🛤 Known Limitations & Roadmap

### Current Limitations

- ⚠️ **Component rotation in Tab 2** — R0/R90 supported; R180/R270 render correctly but pin coords use consistent offsets regardless
- ⚠️ **No diagonal wires** — Only axis-aligned (horizontal/vertical) wire segments are supported; `ptOnSeg` enforces this
- ⚠️ **No undo/redo** — Component placement and wire drawing cannot be undone; use Clear to restart
- ⚠️ **Single schematic sheet** — No hierarchical or multi-page schematics
- ⚠️ **No simulation** — Weave generates netlists for use in LTspice/ngspice; it does not simulate

### Roadmap

| Status | Milestone | Target |
|:---:|---|---|
| ✅ Done | SPICE netlist → LTspice `.asc` via elkjs layout | v1.0 |
| ✅ Done | Interactive SVG canvas with component placement and wire drawing | v1.0 |
| ✅ Done | SPICE netlist generation from canvas (Union-Find connectivity) | v1.0 |
| ✅ Done | 10+ component types: R, C, L, V, I, D, Q, M, J, B, E, G, F, H, GND, VDD | v1.0 |
| 🔄 In Progress | R180/R270 pin coordinate correctness | v1.1 |
| 🔄 In Progress | Undo / redo stack | v1.1 |
| 📋 Planned | Op-amp symbol (VCVS-based) | v1.1 |
| 📋 Planned | Wire labels and named nets | v1.2 |
| 📋 Planned | Export schematic as PNG/SVG image | v1.2 |
| 📋 Planned | Import `.asc` file back into Tab 2 canvas | v2.0 |
| 💡 Exploring | SPICE `.op` / `.ac` directive support | Future |
| 💡 Exploring | PWA / offline mode with service worker | Future |

---

## 📄 License

This project is licensed under the **MIT License**.
See the [LICENSE](./LICENSE) file for full details.

---

<div align="center">

Built with ❤️ for the electronics community

[⭐ Star this repo](https://github.com/your-username/weave) · [🐛 Report a Bug](https://github.com/your-username/weave/issues) · [💡 Request a Feature](https://github.com/your-username/weave/issues)

</div>
