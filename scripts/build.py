#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Site build entry: sync sketch config, optional article generation, then Jekyll."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="LvDobby blog build helpers")
    parser.add_argument("--article", action="store_true", help="Regenerate claude-code article HTML")
    parser.add_argument("--jekyll", action="store_true", help="Run jekyll build after sync")
    parser.add_argument("--grunt", action="store_true", help="Run grunt (hux-blog theme assets)")
    args = parser.parse_args()

    run([sys.executable, str(ROOT / "scripts" / "sketch_sync.py")])

    if args.article:
        run([sys.executable, str(ROOT / "scripts" / "articles" / "build_claude_code_article.py")])

    if args.grunt:
        run(["npx", "grunt", "default"])

    if args.jekyll:
        run(["jekyll", "build"])

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
