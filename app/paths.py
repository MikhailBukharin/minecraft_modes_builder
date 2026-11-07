"""Keep mutable user data outside the source checkout, without writing on import."""

import os
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
DATA_FOLDERS = ("projects", "exports", "imports", "bundles", "generations", "backups")


def data_directory(override=None):
    """Resolve an explicit path, environment override, or platform user-data folder."""
    configured = override or os.environ.get("MONSTER_WORKSHOP_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return (base / "MinecraftMonsterWorkshop").resolve()


def initialize_data_directory(root):
    """Create only the application's known runtime folders."""
    root = Path(root).expanduser().resolve()
    for folder in DATA_FOLDERS:
        (root / folder).mkdir(parents=True, exist_ok=True)
    return root
