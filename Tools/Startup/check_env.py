"""Startup check (US-1, stage 1).

Usage (from the repository root):
    python Tools/Startup/check_env.py > /dev/null 2>&1; cat Temp/tango-drill_startup_check.txt

Writes the report to Temp/ in UTF-8 (UV-4). Exit code 1 if any FAIL; WARN does not affect it.
The repository root is derived from this file's location (UD-8). Keep this file ASCII-only (UE-1).
"""
from __future__ import annotations

import datetime
import os
import re
import shutil
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "Temp" / "tango-drill_startup_check.txt"
NODE_MIN_MAJOR = 20

results: list[tuple[str, str, str]] = []  # (level, name, detail)


def add(level: str, name: str, detail: str) -> None:
    results.append((level, name, detail))


def check_node() -> None:
    node = shutil.which("node")
    if not node:
        add("FAIL", "node", "node not found on PATH")
        return
    out = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
    m = re.match(r"v(\d+)\.", out)
    if not m or int(m.group(1)) < NODE_MIN_MAJOR:
        add("FAIL", "node", f"{out or 'unknown'} (need v{NODE_MIN_MAJOR}+ for node --test)")
    else:
        add("PASS", "node", f"{out} at {node}")


def check_tsc() -> None:
    name = "tsc.cmd" if os.name == "nt" else "tsc"
    tsc = ROOT / "node_modules" / ".bin" / name
    if not tsc.exists():
        add("FAIL", "tsc", "node_modules/.bin/tsc missing (run: npm install)")
        return
    out = subprocess.run(str(tsc) + " --version", capture_output=True, text=True, shell=True).stdout.strip()
    add("PASS", "tsc", out or "present")


def check_playwright() -> None:
    """Screen tests (npm run e2e) need @playwright/test and the browser named by PW_CHANNEL (default: msedge)."""
    if not (ROOT / "node_modules" / "@playwright" / "test").exists():
        add("WARN", "playwright", "@playwright/test not installed (run npm install; needed for npm run e2e)")
        return
    channel = os.environ.get("PW_CHANNEL", "msedge")
    if channel != "msedge":
        add("PASS", "playwright", f"@playwright/test installed, PW_CHANNEL={channel} (not checked here)")
        return
    candidates = [
        Path(os.environ.get(v, "")) / "Microsoft" / "Edge" / "Application" / "msedge.exe"
        for v in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA") if os.environ.get(v)
    ]
    found = next((str(p) for p in candidates if p.exists()), None) or shutil.which("msedge") or shutil.which("microsoft-edge")
    if found:
        add("PASS", "playwright", f"@playwright/test installed, Edge at {found}")
    else:
        add("WARN", "playwright", "Edge not found: install it, or set PW_CHANNEL (e.g. chrome) for npm run e2e")


def check_claude_local() -> None:
    """CLAUDE.local.md must exist and import the common rules from a path that exists on this machine."""
    local = ROOT / "CLAUDE.local.md"
    if not local.exists():
        add("FAIL", "CLAUDE.local.md", "missing. Create it with one line: @<absolute path to the common rules note>")
        return
    imports = [ln.strip()[1:].strip() for ln in local.read_text(encoding="utf-8").splitlines()
               if ln.strip().startswith("@")]
    if not imports:
        add("FAIL", "CLAUDE.local.md", "no @import line found")
        return
    missing = [p for p in imports if not Path(os.path.expanduser(p)).exists()]
    if missing:
        add("FAIL", "CLAUDE.local.md", "import target not found: " + ", ".join(missing))
    else:
        add("PASS", "CLAUDE.local.md", f"{len(imports)} import(s), all targets exist")


def check_git_lock() -> None:
    locks = sorted((ROOT / ".git").glob("*.lock")) if (ROOT / ".git").is_dir() else []
    if locks:
        # Never delete: a human may be operating git right now.
        add("FAIL", "git lock", "lock file present, ask the user: " + ", ".join(p.name for p in locks))
    else:
        add("PASS", "git lock", "no .git/*.lock")


def main() -> int:
    check_node()
    check_tsc()
    check_playwright()
    check_claude_local()
    check_git_lock()

    fails = sum(1 for lv, _, _ in results if lv == "FAIL")
    lines = [
        "tango-drill startup check",
        f"generated: {datetime.datetime.now().isoformat(timespec='seconds')}",
        f"machine: KNOWLEDGE_MACHINE={os.environ.get('KNOWLEDGE_MACHINE', 'unset')} host={socket.gethostname()}",
        f"root: {ROOT}",
        f"result: {'FAIL' if fails else 'PASS'} (fail={fails})",
        "",
    ]
    lines += [f"[{lv}] {name}: {detail}" for lv, name, detail in results]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
