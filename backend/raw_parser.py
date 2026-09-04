from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


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
