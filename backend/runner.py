"""
runner.py — ngspice subprocess wrapper
Writes a .cir temp file, runs ngspice -b, parses the ASCII .raw output.
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
import textwrap
from dataclasses import dataclass, field
from pathlib import Path

NGSPICE_BIN = os.environ.get("NGSPICE_BIN", "ngspice")
TIMEOUT_SEC  = int(os.environ.get("NGSPICE_TIMEOUT", "30"))


@dataclass
class SimVector:
    name:   str
    unit:   str
    data:   list = field(default_factory=list)


@dataclass
class SimResult:
    ok:       bool
    sim_type: str
    x_var:    str
    vectors:  list = field(default_factory=list)
    log:      str = ""
    error:    str = ""


def _ensure_control(netlist: str, sim_type: str, params: dict) -> str:
    lower = netlist.lower()
    has_cmd = f".{sim_type}" in lower
    if has_cmd:
        return netlist
    if sim_type == "tran":
        cmd = f".tran {params.get('tstep','1u')} {params.get('tstop','1m')}"
    elif sim_type == "ac":
        cmd = f".ac {params.get('ftype','dec')} {params.get('pts','10')} {params.get('fstart','1')} {params.get('fstop','1meg')}"
    else:
        cmd = f".dc {params.get('src','V1')} {params.get('start','0')} {params.get('stop','5')} {params.get('step','0.1')}"
    control = f"\n{cmd}\n.control\nrun\n.endc\n"
    return netlist.rstrip() + control


def _inject_save_raw(netlist: str, raw_path: str) -> str:
    cleaned = re.sub(r"(?im)^\s*write\s+\S+\s*$", "", netlist)
    if ".endc" in cleaned.lower():
        cleaned = re.sub(r"(?im)(\.endc)", f"write {raw_path}\n\\1", cleaned, count=1)
    else:
        cleaned = cleaned.rstrip() + f"\nwrite {raw_path}\n"
    return cleaned


def _parse_raw(raw_path: str):
    text = Path(raw_path).read_text(errors="replace")
    plot_match = re.search(r"^Plotname:\s*(.+)", text, re.MULTILINE | re.IGNORECASE)
    plot_name  = plot_match.group(1).strip().lower() if plot_match else "transient"
    if "transient" in plot_name:
        sim_type = "tran"
    elif "ac" in plot_name:
        sim_type = "ac"
    else:
        sim_type = "dc"

    var_match = re.search(r"^Variables:\s*\n(.*?)^Values:", text,
                          re.MULTILINE | re.DOTALL | re.IGNORECASE)
    if not var_match:
        return sim_type, []

    var_lines = [l.strip() for l in var_match.group(1).strip().splitlines() if l.strip()]
    names, units = [], []
    for vl in var_lines:
        parts = vl.split()
        if len(parts) >= 3:
            names.append(parts[1])
            units.append(parts[2])

    val_match = re.search(r"^Values:\s*\n(.*)", text,
                          re.MULTILINE | re.DOTALL | re.IGNORECASE)
    if not val_match:
        return sim_type, []

    rows, current_row = [], []
    for line in val_match.group(1).splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        try:
            int(parts[0])
            if current_row:
                rows.append(current_row)
                current_row = []
            for p in parts[1:]:
                current_row.append(float(p.split(",")[0]))
        except ValueError:
            for p in parts:
                try:
                    current_row.append(float(p.split(",")[0]))
                except ValueError:
                    pass
    if current_row:
        rows.append(current_row)

    vectors = []
    for i, (name, unit) in enumerate(zip(names, units)):
        data = [row[i] for row in rows if i < len(row)]
        vectors.append(SimVector(name=name, unit=unit, data=data))
    return sim_type, vectors


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
