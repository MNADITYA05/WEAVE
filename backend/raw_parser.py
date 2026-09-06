from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class SimVector:
    name:       str
    unit:       str
    data:       list = field(default_factory=list)
    is_complex: bool = False


@dataclass
class SimResult:
    ok:       bool
    sim_type: str
    x_var:    str
    vectors:  list = field(default_factory=list)
    log:      str = ""
    error:    str = ""


def _detect_sim_type(plot_name: str) -> str:
    p = plot_name.lower()
    if "transient" in p:
        return "tran"
    if "ac" in p:
        return "ac"
    if "operating point" in p or "op" == p.strip():
        return "op"
    if "noise" in p:
        return "noise"
    if "transfer" in p or "tf" in p:
        return "tf"
    if "dc" in p:
        return "dc"
    return "tran"


def _parse_value(token: str) -> float | complex:
    """
    Parse a single ngspice ASCII raw value token.
    Real analyses emit plain floats: '1.23e-03'
    AC analysis emits complex pairs:  '1.23e-03,4.56e-07'
    Returns complex when a comma is present, float otherwise.
    """
    parts = token.split(",")
    if len(parts) == 2:
        try:
            return complex(float(parts[0]), float(parts[1]))
        except ValueError:
            pass
    try:
        return float(parts[0])
    except ValueError:
        return 0.0


def _parse_single_section(section: str) -> tuple[str, list[SimVector]]:
    """Parse one Plotname block from a raw file. Returns (sim_type, vectors)."""
    plot_match = re.search(r"^Plotname:\s*(.+)", section, re.MULTILINE | re.IGNORECASE)
    plot_name  = plot_match.group(1).strip() if plot_match else "transient"
    sim_type   = _detect_sim_type(plot_name)

    var_match = re.search(r"^Variables:\s*\n(.*?)^Values:", section,
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

    val_match = re.search(r"^Values:\s*\n(.*)", section,
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
                current_row.append(_parse_value(p))
        except ValueError:
            for p in parts:
                try:
                    current_row.append(_parse_value(p))
                except Exception:
                    pass
    if current_row:
        rows.append(current_row)

    vectors = []
    for i, (name, unit) in enumerate(zip(names, units)):
        data = [row[i] for row in rows if i < len(row)]
        is_cpx = any(isinstance(v, complex) for v in data)
        vectors.append(SimVector(name=name, unit=unit, data=data, is_complex=is_cpx))
    return sim_type, vectors


def _parse_tf_log(log: str) -> list[SimVector]:
    """Extract .tf scalar results from ngspice stdout/log."""
    vectors: list[SimVector] = []
    for line in log.splitlines():
        m = re.match(
            r"^\s*([A-Za-z][\w()\s/]+?)\s*=\s*([0-9eE+\-.]+)\s*$", line
        )
        if m:
            name = m.group(1).strip()
            try:
                val = float(m.group(2))
                vectors.append(SimVector(name=name, unit="", data=[val], is_complex=False))
            except ValueError:
                pass
    return vectors


def _parse_raw(raw_path: str, log: str = "", sim_type_hint: str = "") -> tuple[str, list[SimVector]]:
    """
    Parse an ngspice ASCII raw file.
    - For .step: raw file has multiple Plotname blocks; merge y-traces with [1],[2]... suffixes.
    - For .op / .noise: single block, detected from Plotname.
    - For .tf: raw file may be empty or absent; caller should handle via _parse_tf_log.
    """
    text = Path(raw_path).read_text(errors="replace")

    sections = re.split(r"(?=^Plotname:)", text, flags=re.MULTILINE | re.IGNORECASE)
    sections = [s for s in sections if re.search(r"^Plotname:", s, re.MULTILINE | re.IGNORECASE)]

    if not sections:
        return sim_type_hint or "tran", []

    if len(sections) == 1:
        sim_type, vectors = _parse_single_section(sections[0])
        return sim_type_hint or sim_type, vectors

    # Multiple plots → .step sweep
    all_parsed = [_parse_single_section(s) for s in sections]
    sim_type = sim_type_hint or all_parsed[0][0]

    first_vectors = all_parsed[0][1]
    if not first_vectors:
        return sim_type, []
    x_var_name = first_vectors[0].name
    x_vec = first_vectors[0]

    merged: list[SimVector] = [x_vec]
    for step_idx, (_, vecs) in enumerate(all_parsed, start=1):
        for v in vecs:
            if v.name == x_var_name:
                continue
            merged.append(SimVector(
                name=f"{v.name}[{step_idx}]",
                unit=v.unit,
                data=v.data,
                is_complex=v.is_complex,
            ))

    return "step", merged
