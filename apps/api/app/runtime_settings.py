from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile


RUNTIME_DIR = Path(os.environ.get("EYECAN_RUNTIME_DIR", Path(__file__).resolve().parents[1] / ".runtime"))
SETTINGS_PATH = RUNTIME_DIR / "settings.json"


def load_learning_enabled(path: Path = SETTINGS_PATH) -> bool:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return True
    return payload.get("learning_enabled") is not False


def save_learning_enabled(enabled: bool, path: Path = SETTINGS_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"learning_enabled": enabled}, ensure_ascii=True, indent=2)
    temp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temp_path = handle.name
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
