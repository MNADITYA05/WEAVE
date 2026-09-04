from __future__ import annotations

import re
import textwrap


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
    ctrl_block = f".control\nrun\nset filetype=ascii\nwrite {raw_path}\n.endc"
    if ".endc" in cleaned.lower():
        cleaned = re.sub(r"(?im)(\.endc)", f"write {raw_path}\n\\1", cleaned, count=1)
    elif re.search(r"(?im)^\.end\s*$", cleaned):
        cleaned = re.sub(r"(?im)(^\.end\s*$)", f"{ctrl_block}\n\\1", cleaned, count=1)
    else:
        cleaned = cleaned.rstrip() + f"\n{ctrl_block}\n"
    return cleaned
