from __future__ import annotations

import re


def _ensure_control(netlist: str, sim_type: str, params: dict) -> str:
    lower = netlist.lower()

    if sim_type == "step":
        return _ensure_step(netlist, lower, params)

    has_cmd = f".{sim_type}" in lower
    if has_cmd:
        return netlist

    if sim_type == "tran":
        cmd = f".tran {params.get('tstep','1u')} {params.get('tstop','1m')}"
    elif sim_type == "ac":
        cmd = f".ac {params.get('ftype','dec')} {params.get('pts','20')} {params.get('fstart','1')} {params.get('fstop','1meg')}"
    elif sim_type == "op":
        cmd = ".op"
    elif sim_type == "noise":
        cmd = (f".noise {params.get('out','V(out)')} {params.get('src','Vin')} "
               f"{params.get('ftype','dec')} {params.get('pts','20')} "
               f"{params.get('fstart','1')} {params.get('fstop','1meg')}")
    elif sim_type == "tf":
        cmd = f".tf {params.get('out','V(out)')} {params.get('src','Vin')}"
    else:  # dc
        cmd = f".dc {params.get('src','V1')} {params.get('start','0')} {params.get('stop','5')} {params.get('step','0.1')}"

    return netlist.rstrip() + f"\n{cmd}\n.control\nrun\n.endc\n"


def _ensure_step(netlist: str, lower: str, params: dict) -> str:
    lines: list[str] = []

    if ".step" not in lower:
        lines.append(
            f".step param {params.get('name','R')} "
            f"{params.get('start','1k')} {params.get('stop','10k')} {params.get('inc','1k')}"
        )

    underlying = params.get("underlying", "tran")
    if f".{underlying}" not in lower:
        if underlying == "tran":
            lines.append(f".tran {params.get('tstep','1u')} {params.get('tstop','1m')}")
        elif underlying == "ac":
            lines.append(
                f".ac {params.get('ftype','dec')} {params.get('pts','20')} "
                f"{params.get('fstart','1')} {params.get('fstop','1meg')}"
            )
        else:
            lines.append(
                f".dc {params.get('src2','V1')} {params.get('dcstart','0')} "
                f"{params.get('dcstop','5')} {params.get('dcstep','0.1')}"
            )

    if not lines:
        return netlist

    return netlist.rstrip() + "\n" + "\n".join(lines) + "\n.control\nrun\n.endc\n"


def _inject_save_raw(netlist: str, raw_path: str) -> str:
    cleaned = re.sub(r"(?im)^\s*write\s+\S+\s*$", "", netlist)
    ctrl_block = f".control\nrun\nset filetype=ascii\nwrite {raw_path}\n.endc"
    if ".endc" in cleaned.lower():
        cleaned = re.sub(
            r"(?im)(\.endc)",
            f"set filetype=ascii\nwrite {raw_path}\n\\1",
            cleaned, count=1,
        )
    elif re.search(r"(?im)^\.end\s*$", cleaned):
        cleaned = re.sub(r"(?im)(^\.end\s*$)", f"{ctrl_block}\n\\1", cleaned, count=1)
    else:
        cleaned = cleaned.rstrip() + f"\n{ctrl_block}\n"
    return cleaned


def _resolve_spicelib(netlist: str, spicelib_dir: str = "/spicelib") -> str:
    """Rewrite bare .lib filename references to absolute /spicelib/ paths."""
    import re
    from pathlib import Path
    def _replace(m: re.Match) -> str:
        fname = m.group(1).strip()
        full = Path(spicelib_dir) / fname
        if full.exists():
            return f".include {full}"
        return m.group(0)
    return re.sub(r"^\.lib\s+(\S+)", _replace, netlist, flags=re.MULTILINE | re.IGNORECASE)
