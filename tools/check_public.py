"""Offline publication checks. Report locations, never matched private values."""

import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_FOLDERS = (
    "projects",
    "exports",
    "imports",
    "bundles",
    "generations",
    "backups",
    "research",
    "output",
)
SKIP_FOLDERS = {".git", "node_modules", ".venv", "__pycache__", ".ruff_cache", "tmp", "test-tmp"}
PROFILE = re.compile(r"[A-Za-z]:[\\/]Users[\\/](?!Public\b)[^\\/\s<>\"']+")
LINK = re.compile(r"!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)")


def check():
    failures = []
    for name in PRIVATE_FOLDERS:
        folder = ROOT / name
        if folder.exists() and any(p.is_file() for p in folder.rglob("*")):
            failures.append(f"Runtime/private content in {name}/")
    for path in ROOT.rglob("*"):
        if not path.is_file() or SKIP_FOLDERS.intersection(path.relative_to(ROOT).parts):
            continue
        if path.suffix in {".key", ".pem", ".p12", ".pfx", ".mcaddon", ".mcpack"}:
            failures.append(f"Private or generated file: {path.relative_to(ROOT)}")
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeError:
            continue
        for line, value in enumerate(text.splitlines(), 1):
            if PROFILE.search(value):
                failures.append(f"Local user profile: {path.relative_to(ROOT)}:{line}")
        if path.suffix != ".md":
            continue
        for match in LINK.finditer(text):
            target = match[1] or match[2]
            if urlparse(target).scheme or target.startswith("#"):
                continue
            linked = (path.parent / unquote(target.split("#", 1)[0])).resolve()
            if not linked.is_relative_to(ROOT) or not linked.exists():
                failures.append(f"Broken/outside link in {path.relative_to(ROOT)}")
    return failures


if __name__ == "__main__":
    errors = check()
    for error in sorted(set(errors)):
        print(error)
    print("Publication structure: " + ("FAILED" if errors else "OK"))
    sys.exit(bool(errors))
