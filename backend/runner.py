"""
runner.py — ngspice subprocess wrapper
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from raw_parser import SimVector, SimResult, _parse_raw, _parse_tf_log
from netlist import _ensure_control, _inject_save_raw, _resolve_spicelib

NGSPICE_BIN     = os.environ.get("NGSPICE_BIN", "ngspice")
TIMEOUT_SEC     = int(os.environ.get("NGSPICE_TIMEOUT", "30"))
SPICELIB_DIR    = os.environ.get("NGSPICE_SPICELIB", "/spicelib")


def _copy_spicelib(tmpdir: str) -> None:
    """Copy all bundled .lib/.mod files into tmpdir so ngspice finds them."""
    lib_path = Path(SPICELIB_DIR)
    if not lib_path.is_dir():
        return
    for f in lib_path.iterdir():
        if f.suffix.lower() in ('.lib', '.mod', '.sub', '.sp'):
            shutil.copy2(f, os.path.join(tmpdir, f.name))


def run_simulation(netlist: str, sim_type: str = "tran", params: dict = None) -> SimResult:
    params = params or {}
    with tempfile.TemporaryDirectory() as tmpdir:
        _copy_spicelib(tmpdir)

        cir_path = os.path.join(tmpdir, "circuit.cir")
        raw_path = os.path.join(tmpdir, "circuit.raw")
        prepared = _inject_save_raw(_ensure_control(_resolve_spicelib(netlist), sim_type, params), raw_path)
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

        if sim_type == "tf":
            vectors = _parse_tf_log(log)
            if vectors:
                return SimResult(ok=True, sim_type="tf", x_var=vectors[0].name,
                                 vectors=vectors, log=log)

        if not Path(raw_path).exists():
            err = "ngspice produced no output.\n" + log
            if sim_type == "tf":
                err = "No .tf results found in log.\n" + log
            return SimResult(ok=False, sim_type=sim_type, x_var="time", error=err)

        try:
            detected_type, vectors = _parse_raw(raw_path, log=log, sim_type_hint=sim_type)
        except Exception as exc:
            return SimResult(ok=False, sim_type=sim_type, x_var="time",
                             error=f"Raw parse error: {exc}\n{log}")

        x_var = vectors[0].name if vectors else "time"
        return SimResult(ok=True, sim_type=detected_type, x_var=x_var,
                         vectors=vectors, log=log)
