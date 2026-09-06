"""
main.py — Weave simulation backend
FastAPI app exposing /simulate, /ping, and /validate endpoints.
"""

from __future__ import annotations

from typing import Union
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from runner import run_simulation, SimResult

app = FastAPI(title="Weave Simulation Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request / Response models ────────────────────────────────────────────────

class SimRequest(BaseModel):
    netlist:  str
    sim_type: str = "tran"
    params:   dict[str, str] = {}


class VectorOut(BaseModel):
    name:       str
    unit:       str
    data:       list[Union[float, list[float]]]   # float for real, [re, im] for complex
    is_complex: bool = False


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


def _serialize_vector_data(data: list, is_complex: bool) -> list[Union[float, list[float]]]:
    """
    Serialize vector data for JSON transport.
    Real values  → list[float]
    Complex values → list[[re, im]]  (JSON has no complex type)
    """
    if not is_complex:
        return [float(v) for v in data]
    out = []
    for v in data:
        if isinstance(v, complex):
            out.append([v.real, v.imag])
        else:
            out.append([float(v), 0.0])
    return out


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

    vectors_out = []
    for v in result.vectors:
        vectors_out.append(VectorOut(
            name=v.name,
            unit=v.unit,
            is_complex=v.is_complex,
            data=_serialize_vector_data(v.data, v.is_complex),
        ))

    return SimResponse(
        ok=result.ok,
        sim_type=result.sim_type,
        x_var=result.x_var,
        vectors=vectors_out,
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
    from runner import NGSPICE_BIN, TIMEOUT_SEC, _copy_spicelib
    from netlist import _resolve_spicelib

    errors: list[str] = []
    with tempfile.TemporaryDirectory() as tmpdir:
        _copy_spicelib(tmpdir)
        cir_path = os.path.join(tmpdir, "circuit.cir")
        Path(cir_path).write_text(_resolve_spicelib(req.netlist))
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
