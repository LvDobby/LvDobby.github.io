"""Shared paths for Python build scripts."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC_SKETCH = ROOT / "src" / "sketch"
ASSETS_SKETCH = ROOT / "assets" / "sketch"
DATA_DIR = ROOT / "_data"
INCLUDES_DIR = ROOT / "_includes"
WORKER_GENERATED = ROOT / "workers" / "sketch-annotate-api" / "src" / "generated"
