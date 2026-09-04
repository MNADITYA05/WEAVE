"""
main.py — Weave simulation backend
FastAPI app exposing /simulate, /ping, and /validate endpoints.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from runner import run_simulation, SimResult

app = FastAPI(title="Weave Simulation Backend", version="1.0.0")

# Allow the Vite dev server and any localhost origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request / Response models ────────────────────────────────────────────────

class SimRequest(BaseModel):
    netlist:  str
    sim_type: str = "tran"          # "tran" | "ac" | "dc"
    params:   dict[str, str] = {}   # sim-specific params (tstep, tstop, etc.)


class VectorOut(BaseModel):
    name: str
    unit: str
    data: list[float]


class SimResponse(BaseModel):
    ok:       bool
    sim_type: str
    x_var:    str
    vectors:  list[VectorOut] = []
    log:      str = ""
    error:    str = ""


class ValidateResponse(BaseModel):
    ok:     bool
    errors: list[str] = []


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/ping")
def ping() -> dict[str, str]:
    """Health check — Tab 3 polls this to know if backend is up."""
    return {"status": "ok", "backend": "weave-sim"}


@app.post("/simulate", response_model=SimResponse)
def simulate(req: SimRequest) -> SimResponse:
    if not req.netlist.strip():
        raise HTTPException(status_code=400, detail="Netlist is empty")

    result: SimResult = run_simulation(
        netlist=req.netlist,
        sim_type=req.sim_type,
        params=req.params,
    )

    return SimResponse(
        ok=result.ok,
        sim_type=result.sim_type,
        x_var=result.x_var,
        vectors=[VectorOut(name=v.name, unit=v.unit, data=v.data) for v in result.vectors],
        log=result.log,
        error=result.error,
    )


@app.post("/validate", response_model=ValidateResponse)
def validate(req: SimRequest) -> ValidateResponse:
    """
    Dry-run ngspice with just syntax checking — no simulation.
    Returns any errors ngspice reports before running.
    """
    import re
    import subprocess
    import tempfile
    import os
    from pathlib import Path
    from runner import NGSPICE_BIN, TIMEOUT_SEC

    errors: list[str] = []
    with tempfile.TemporaryDirectory() as tmpdir:
        cir_path = os.path.join(tmpdir, "circuit.cir")
        # Minimal netlist — just check parse
        Path(cir_path).write_text(req.netlist)
        try:
            proc = subprocess.run(
                [NGSPICE_BIN, "-b", cir_path],
                capture_output=True, text=True,
                timeout=TIMEOUT_SEC, cwd=tmpdir,
            )
            combined = proc.stdout + proc.stderr
            for line in combined.splitlines():
                low = line.lower()
                if "error" in low or "fatal" in low or "unknown" in low:
                    errors.append(line.strip())
        except FileNotFoundError:
            errors.append(f"ngspice not found at '{NGSPICE_BIN}'")
        except subprocess.TimeoutExpired:
            errors.append("Validation timed out")

    return ValidateResponse(ok=len(errors) == 0, errors=errors)
