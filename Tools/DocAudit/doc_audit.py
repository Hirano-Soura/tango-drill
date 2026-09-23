"""Document audit (UD-n) and core purity (INV-6).

Usage (from the repository root):
    python Tools/DocAudit/doc_audit.py > /dev/null 2>&1; cat Temp/tango-drill_doc_audit.txt
    python Tools/DocAudit/doc_audit.py --self-test > /dev/null 2>&1; cat Temp/tango-drill_doc_audit_selftest.txt

--self-test builds a throwaway repository in which every check has one planted violation,
and confirms that each check fires (positive control, UV-1). It also confirms a clean
throwaway repository gives zero findings.

Exit code 1 if any FAIL; WARN does not affect it (UV-4).
Keep this file ASCII-only: non-ASCII characters are written as escapes (UE-1).
"""
from __future__ import annotations

import datetime
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "Temp" / "tango-drill_doc_audit.txt"
SELFTEST_REPORT = ROOT / "Temp" / "tango-drill_doc_audit_selftest.txt"

SKIP_DIRS = {".git", "node_modules", "Temp", "test-results", "playwright-report", "__pycache__"}

# Progress / owner symbols allowed only in Docs/50_Tasks.md (UD-3).
PROGRESS = ["\u2705", "\u2b1c", "\u23f8", "\U0001f195", "\U0001f9d1", "\U0001f916", "\U0001f527", "\U0001f3a8"]
# "kanryou houkoku" (completion report) in Japanese (UD-4).
COMPLETION_WORD = "\u5b8c\u4e86\u5831\u544a"
BOX_CHARS = re.compile("[\u2500-\u257f]")  # box drawing (UD-12)
ABS_PATH = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:\\|(?<![\w.])/[a-z]/[A-Za-z]")  # D:\  or  /c/Users (UD-8)
DATED = re.compile(r"(19|20)\d{2}-?\d{2}-?\d{2}")
MD_LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
# Invisible characters that a tool may write in place of a backslash-u escape (Docs/52_Pitfalls.md P-3).
# Built with chr() so this file never holds them literally.
INVISIBLE = {chr(c) for c in (0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x2028, 0x2029)}
TEXT_SUFFIXES = {".js", ".mjs", ".ts", ".md", ".json", ".txt", ".py", ".yml", ".yaml", ".html", ".css"}
BROWSER_API = re.compile(
    r"\b(window|document|indexedDB|localStorage|sessionStorage|navigator|fetch|XMLHttpRequest|sendBeacon)\b"
)


class Audit:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.findings: list[tuple[str, str, str]] = []  # (level, check, detail)
        self.seen: dict[str, int] = {}

    def add(self, level: str, check: str, detail: str) -> None:
        self.findings.append((level, check, detail))

    def rel(self, p: Path) -> str:
        return p.relative_to(self.root).as_posix()

    def files(self) -> list[Path]:
        out = []
        for p in self.root.rglob("*"):
            if p.is_file() and not any(part in SKIP_DIRS for part in p.relative_to(self.root).parts):
                out.append(p)
        return sorted(out)

    def rule_docs(self) -> list[Path]:
        """Docs whose text binds work: CLAUDE.md, README.md, Docs/, .claude/agents/."""
        docs = [p for p in (self.root / "CLAUDE.md", self.root / "README.md") if p.exists()]
        for sub in ("Docs", ".claude/agents"):
            d = self.root / sub
            if d.is_dir():
                docs += sorted(d.rglob("*.md"))
        return docs

    # --- checks -------------------------------------------------------------

    def check_index_orphans(self) -> None:  # UD-1
        docs_dir = self.root / "Docs"
        index = docs_dir / "00_Index.md"
        if not index.exists():
            self.add("FAIL", "UD-1 index", "Docs/00_Index.md missing")
            return
        text = index.read_text(encoding="utf-8")
        targets = {t.split("#")[0] for t in MD_LINK.findall(text)}
        docs = [p for p in sorted(docs_dir.rglob("*.md")) if p != index and "_Archive" not in p.parts]
        self.seen["UD-1 index"] = len(docs)
        for p in docs:
            if p.relative_to(docs_dir).as_posix() not in targets:
                self.add("FAIL", "UD-1 index", f"{self.rel(p)} is not linked from Docs/00_Index.md")

    def check_links(self) -> None:
        docs = self.rule_docs()
        n = 0
        for p in docs:
            for target in MD_LINK.findall(p.read_text(encoding="utf-8")):
                if re.match(r"^[a-z]+:", target) or target.startswith("#"):
                    continue
                n += 1
                path = target.split("#")[0]
                if path and not (p.parent / path).exists():
                    self.add("FAIL", "links", f"{self.rel(p)}: broken link -> {target}")
        self.seen["links"] = n

    def check_dated_names(self) -> None:  # UD-2
        files = self.files()
        self.seen["UD-2 dated names"] = len(files)
        for p in files:
            if "_Archive" in p.parts:
                continue
            if DATED.search(p.name):
                self.add("FAIL", "UD-2 dated names", self.rel(p))

    def check_progress_symbols(self) -> None:  # UD-3
        docs = [p for p in self.rule_docs() if self.rel(p) != "Docs/50_Tasks.md"]
        self.seen["UD-3 progress symbols"] = len(docs)
        for p in docs:
            for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
                if any(s in line for s in PROGRESS):
                    self.add("FAIL", "UD-3 progress symbols", f"{self.rel(p)}:{i}")

    def check_completion_reports(self) -> None:  # UD-4
        files = self.files()
        self.seen["UD-4 completion reports"] = len(files)
        for p in files:
            if p.suffix == ".md" and (re.search(r"_?Complete(d)?\b", p.stem, re.I) or COMPLETION_WORD in p.stem):
                self.add("FAIL", "UD-4 completion reports", self.rel(p))

    def check_strikethrough(self) -> None:  # UD-6
        docs = self.rule_docs()
        self.seen["UD-6 strikethrough"] = len(docs)
        for p in docs:
            for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
                if re.search(r"~~[^~]+~~", line):
                    self.add("FAIL", "UD-6 strikethrough", f"{self.rel(p)}:{i}")

    def check_abs_paths(self) -> None:  # UD-8
        docs = self.rule_docs()
        self.seen["UD-8 absolute paths"] = len(docs)
        for p in docs:
            for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
                if ABS_PATH.search(line):
                    self.add("FAIL", "UD-8 absolute paths", f"{self.rel(p)}:{i}")

    def check_competing_rules(self) -> None:  # UD-9
        for rel in (".cursorrules", ".github/instructions", ".github/copilot-instructions.md", "AGENTS.md"):
            if (self.root / rel).exists():
                self.add("WARN", "UD-9 competing rules", rel)
        self.seen["UD-9 competing rules"] = 4

    def check_pseudo_diagrams(self) -> None:  # UD-12
        docs = self.rule_docs()
        self.seen["UD-12 pseudo diagrams"] = len(docs)
        for p in docs:
            in_fence, lang, start = False, "", 0
            for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
                m = re.match(r"^\s*(```+|~~~+)\s*(\S*)", line)
                if m:
                    if not in_fence:
                        in_fence, lang, start = True, m.group(2), i
                    else:
                        in_fence = False
                    continue
                if in_fence and lang in ("", "text") and BOX_CHARS.search(line):
                    self.add("WARN", "UD-12 pseudo diagrams", f"{self.rel(p)}:{i} (fence from line {start})")

    def check_core_purity(self) -> None:  # INV-6
        core = self.root / "core"
        files = sorted(core.rglob("*.js")) if core.is_dir() else []
        self.seen["INV-6 core purity"] = len(files)
        for p in files:
            text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), p.read_text(encoding="utf-8"), flags=re.S)
            for i, line in enumerate(text.splitlines(), 1):
                code = re.sub(r"//.*$", "", line)
                m = BROWSER_API.search(code)
                if m:
                    self.add("FAIL", "INV-6 core purity", f"{self.rel(p)}:{i} uses '{m.group(1)}'")

    def check_invisible_chars(self) -> None:  # P-3
        files = [p for p in self.files() if p.suffix in TEXT_SUFFIXES]
        self.seen["P-3 invisible chars"] = len(files)
        for p in files:
            try:
                text = p.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                self.add("FAIL", "P-3 invisible chars", f"{self.rel(p)}: not UTF-8")
                continue
            for i, line in enumerate(text.split("\n"), 1):
                bad = [ch for ch in line if ch in INVISIBLE or (ord(ch) < 32 and ch not in "\t\r")]
                if bad:
                    self.add("FAIL", "P-3 invisible chars", f"{self.rel(p)}:{i} U+{ord(bad[0]):04X}")

    CHECKS = [
        "check_index_orphans", "check_links", "check_dated_names", "check_progress_symbols",
        "check_completion_reports", "check_strikethrough", "check_abs_paths", "check_competing_rules",
        "check_pseudo_diagrams", "check_core_purity", "check_invisible_chars",
    ]

    def run(self) -> "Audit":
        for name in self.CHECKS:
            getattr(self, name)()
        return self

    def fails(self) -> int:
        return sum(1 for lv, _, _ in self.findings if lv == "FAIL")


def write(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    a = Audit(ROOT).run()
    warns = sum(1 for lv, _, _ in a.findings if lv == "WARN")
    lines = [
        "tango-drill doc audit",
        f"generated: {datetime.datetime.now().isoformat(timespec='seconds')}",
        f"result: {'FAIL' if a.fails() else 'PASS'} (fail={a.fails()} warn={warns})",
        "positive control: python Tools/DocAudit/doc_audit.py --self-test",
        "",
        "items examined per check:",
    ]
    lines += [f"  {k}: {v}" for k, v in a.seen.items()]
    lines += ["", "findings:"] + ([f"  [{lv}] {c}: {d}" for lv, c, d in a.findings] or ["  (none)"])
    write(REPORT, lines)
    return 1 if a.fails() else 0


# --- positive control -----------------------------------------------------------


def build_fixture(root: Path, broken: bool) -> None:
    (root / "Docs").mkdir(parents=True)
    (root / "core").mkdir()
    (root / "Docs" / "00_Index.md").write_text("[a](10_A.md)\n[t](50_Tasks.md)\n", encoding="utf-8")
    (root / "Docs" / "10_A.md").write_text("ok\n", encoding="utf-8")
    (root / "Docs" / "50_Tasks.md").write_text("| T-0 | \u2705 |\n", encoding="utf-8")
    (root / "CLAUDE.md").write_text("rules\n", encoding="utf-8")
    (root / "core" / "a.js").write_text("// window in a comment is fine\nexport const x = 1;\n", encoding="utf-8")
    if not broken:
        return
    (root / "Docs" / "20_Orphan.md").write_text("orphan\n", encoding="utf-8")                  # UD-1
    (root / "Docs" / "10_A.md").write_text("[x](missing.md)\n", encoding="utf-8")               # links
    (root / "Docs" / "Status_20260923.md").write_text("x\n", encoding="utf-8")                  # UD-2 (+UD-1)
    (root / "CLAUDE.md").write_text(
        "\u2705 done\n~~old~~\nsee D:\\Knowledge\\x.md\n```\n\u250c\u2500\u2510\n```\n", encoding="utf-8"
    )                                                                                            # UD-3, UD-6, UD-8, UD-12
    (root / "Docs" / "Phase1_Complete.md").write_text("x\n", encoding="utf-8")                  # UD-4 (+UD-1)
    (root / ".cursorrules").write_text("x\n", encoding="utf-8")                                 # UD-9
    (root / "core" / "b.js").write_text("export const y = localStorage;\n", encoding="utf-8")   # INV-6
    (root / "core" / "c.js").write_text("export const z = /^" + chr(0xFEFF) + "/;\n", encoding="utf-8")  # P-3


def self_test() -> int:
    lines = ["tango-drill doc audit self-test (positive control)",
             f"generated: {datetime.datetime.now().isoformat(timespec='seconds')}", ""]
    bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        clean_root, broken_root = Path(tmp) / "clean", Path(tmp) / "broken"
        build_fixture(clean_root, broken=False)
        build_fixture(broken_root, broken=True)
        clean = Audit(clean_root).run()
        broken = Audit(broken_root).run()
    if clean.findings:
        bad += 1
        lines.append(f"[FAIL] clean fixture produced findings: {clean.findings}")
    else:
        lines.append("[PASS] clean fixture: 0 findings")
    fired = {c for _, c, _ in broken.findings}
    expected = sorted({"UD-1 index", "links", "UD-2 dated names", "UD-3 progress symbols",
                       "UD-4 completion reports", "UD-6 strikethrough", "UD-8 absolute paths",
                       "UD-9 competing rules", "UD-12 pseudo diagrams", "INV-6 core purity",
                       "P-3 invisible chars"})
    for c in expected:
        if c in fired:
            lines.append(f"[PASS] detects {c}")
        else:
            bad += 1
            lines.append(f"[FAIL] did NOT detect planted {c}")
    lines.insert(2, f"result: {'FAIL' if bad else 'PASS'} (fail={bad}, checks={len(expected)})")
    write(SELFTEST_REPORT, lines)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main())
