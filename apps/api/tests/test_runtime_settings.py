from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from app.runtime_settings import load_learning_enabled, save_learning_enabled


class RuntimeSettingsTest(unittest.TestCase):
    def test_learning_setting_persists_and_invalid_files_use_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            self.assertTrue(load_learning_enabled(path))
            save_learning_enabled(False, path)
            self.assertFalse(load_learning_enabled(path))
            save_learning_enabled(True, path)
            self.assertTrue(load_learning_enabled(path))
            path.write_text("not json", encoding="utf-8")
            self.assertTrue(load_learning_enabled(path))


if __name__ == "__main__":
    unittest.main()
