"""
runner.py — ngspice subprocess wrapper
Writes a .cir temp file, runs ngspice -b, parses the ASCII .raw output.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

from .raw_parser import SimVector, SimResult, _parse_raw
from .netlist import _ensure_control, _inject_save_raw

NGSPICE_BIN = os.environ.get("NGSPICE_BIN", "ngspice")
TIMEOUT_SEC  = int(os.environ.get("NGSPICE_TIMEOUT", "30"))


def run_simulation(netlist: str, sim_type: str = "tran", params: dict = None) -> SimResult:
    params = params or {}
    with tempfile.TemporaryDirectory() as tmpdir:
        cir_path = os.path.join(tmpdir, "circuit.cir")
        raw_path = os.path.join(tmpdir, "circuit.raw")
        prepared = _inject_save_raw(_ensure_control(netlist, sim_type, params), raw_path)
        Path(cir_path).write_text(prepared)
        try:
            proc = subprocess.run(
                [NGSPICE_BIN, "-b", "-o", os.path.join(tmpdir, "ng.log"), cir_path],
                capture_output=True, text=True, timeout=TIMEOUT_SEC, cwd=tmpdir,
            )
            log = proc.stdout + proc.stderr
            try:
                log += Path(os.path.join(tmpdir, "ng.log")).read_text()
            except FileNotFoundError:
                pass
        except subprocess.TimeoutExpired:
            return SimResult(ok=False, sim_type=sim_type, x_var="time",
                             error=f"ngspice timed out after {TIMEOUT_SEC}s")
        except FileNotFoundError:
            return SimResult(ok=False, sim_type=sim_type, x_var="time",
                             error=f"ngspice not found at '{NGSPICE_BIN}'")

        if not Path(raw_path).exists():
            return SimResult(ok=False, sim_type=sim_type, x_var="time",
                             error="ngspice produced no output.\n" + log)
        try:
            detected_type, vectors = _parse_raw(raw_path)
        except Exception as exc:
            return SimResult(ok=False, sim_type=sim_type, x_var="time",
                             error=f"Raw parse error: {exc}\n{log}")

        x_var = vectors[0].name if vectors else "time"
        return SimResult(ok=True, sim_type=detected_type, x_var=x_var,
                         vectors=vectors, log=log)
