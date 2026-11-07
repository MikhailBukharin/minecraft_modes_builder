"""Regression checks for generated caches and publication documentation links."""

import importlib.util
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def load_tool(name):
    path = Path(__file__).resolve().parents[1] / "tools" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SecretScanScopeTest(unittest.TestCase):
    def test_ruff_cache_is_excluded_on_both_platforms(self):
        pattern = load_tool("check_secrets").EXCLUDED
        for path in [
            ".ruff_cache/CACHEDIR.TAG",
            "checkout/.ruff_cache/CACHEDIR.TAG",
            "checkout" + chr(92) + ".ruff_cache" + chr(92) + "CACHEDIR.TAG",
        ]:
            with self.subTest(path=path):
                self.assertIsNotNone(re.search(pattern, path))

    def test_real_source_and_configuration_remain_in_scope(self):
        pattern = load_tool("check_secrets").EXCLUDED
        for path in [
            "app/server.py",
            ".github/workflows/checks.yml",
            "app/ruff_cache_policy.py",
            ".ruff_cache_backup/credentials.txt",
            ".env",
        ]:
            with self.subTest(path=path):
                self.assertIsNone(re.search(pattern, path))


class PublicationLinksTest(unittest.TestCase):
    def setUp(self):
        parent = Path(__file__).resolve().parent / "test-tmp"
        parent.mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(dir=parent)
        self.root = Path(temporary.name).resolve()
        assert self.root.is_relative_to(parent)
        self.addCleanup(temporary.cleanup)
        self.tool = load_tool("check_public")

    def test_missing_document_fails(self):
        (self.root / "README.md").write_text("[Report](docs/missing.md)", encoding="utf-8")
        with patch.object(self.tool, "ROOT", self.root):
            self.assertTrue(any("Broken/outside link" in item for item in self.tool.check()))

    def test_existing_document_passes(self):
        (self.root / "docs").mkdir()
        (self.root / "docs" / "guide.md").write_text("# Guide", encoding="utf-8")
        (self.root / "README.md").write_text("[Guide](docs/guide.md)", encoding="utf-8")
        with patch.object(self.tool, "ROOT", self.root):
            self.assertEqual(self.tool.check(), [])
