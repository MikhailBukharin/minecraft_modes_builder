"""Atomic file writes for saved projects, exports, and generation state."""

import json
import os
import tempfile
from pathlib import Path


def write_bytes(path, data):
    """Replace a complete file, keeping the previous version if writing fails."""
    path = Path(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix="." + path.name, suffix=".tmp", delete=False
        ) as stream:
            temporary = Path(stream.name)
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_json(path, value):
    write_bytes(path, json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8"))
