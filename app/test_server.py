"""HTTP boundary and storage tests; no real Codex or Minecraft process is used."""

import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import generation
import server
from bedrock import default_project, validate
from bundle import read_addon
from paths import APP_ROOT, data_directory
from storage import write_bytes


class ServerTest(unittest.TestCase):
    def setUp(self):
        parent = Path(__file__).parent / "test-tmp"
        parent.mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(dir=parent)
        self.root = Path(temporary.name).resolve()
        assert self.root.is_relative_to(parent.resolve())
        self.addCleanup(temporary.cleanup)
        old_root, old_jobs = server.ROOT, generation.JOBS
        self.addCleanup(setattr, server, "ROOT", old_root)
        self.addCleanup(setattr, generation, "JOBS", old_jobs)
        logger = patch.object(server.Handler, "log_message")
        logger.start()
        self.addCleanup(logger.stop)
        self.http = server.create_server(0, self.root)
        worker = threading.Thread(target=self.http.serve_forever, daemon=True)
        worker.start()

        def close():
            self.http.shutdown()
            self.http.server_close()
            worker.join()

        self.addCleanup(close)
        self.origin = f"http://127.0.0.1:{self.http.server_port}"

    def request(self, method, path, value=None, headers=None):
        defaults = {}
        body = None
        if value is not None:
            body = json.dumps(value)
            defaults = {"Content-Type": "application/json", "Origin": self.origin}
        defaults.update(headers or {})
        connection = http.client.HTTPConnection("127.0.0.1", self.http.server_port, timeout=5)
        try:
            connection.request(method, path, body, defaults)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_source_and_user_storage_are_separate(self):
        project = default_project()
        status, _, _ = self.request("POST", "/api/save", project)
        self.assertEqual(status, 200)
        self.assertTrue((self.root / "projects" / f"{project['id']}.json").is_file())
        self.assertFalse((APP_ROOT / "projects" / f"{project['id']}.json").exists())
        self.assertEqual(generation.JOBS, self.root / "generations")

    def test_export_uses_user_directory(self):
        status, _, raw = self.request("POST", "/api/export", default_project())
        self.assertEqual(status, 200)
        result = json.loads(raw)
        self.assertEqual(result["project"]["version"], 1)
        files = read_addon((self.root / result["url"].lstrip("/")).read_bytes())
        self.assertIn("Monster_BP/manifest.json", files)

    def test_other_origins_and_hosts_are_rejected(self):
        status, _, _ = self.request("GET", "/api/projects", headers={"Host": "untrusted.invalid"})
        self.assertEqual(status, 403)
        for origin in ["https://untrusted.invalid", "null", ""]:
            status, _, _ = self.request("POST", "/api/save", default_project(), {"Origin": origin})
            self.assertEqual(status, 403)
        self.assertEqual(list((self.root / "projects").iterdir()), [])

    def test_private_and_outside_files_are_not_served(self):
        for path in ["/../server.py", "/exports/../../app/server.py", "/projects/example.json"]:
            status, _, _ = self.request("GET", path)
            self.assertEqual(status, 404)

    def test_security_headers_and_html(self):
        status, headers, raw = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertEqual(headers["X-Frame-Options"], "DENY")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertIn("bundlePanel", raw.decode())

    def test_invalid_draft_does_not_break_project_list(self):
        project = default_project()
        self.request("POST", "/api/save", project)
        (self.root / "projects" / "broken.json").write_text("{", encoding="utf-8")
        status, _, raw = self.request("GET", "/api/projects")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), [{"id": project["id"], "name": project["name"]}])

    def test_malformed_payload_and_unknown_route(self):
        self.assertEqual(self.request("POST", "/api/save", [1])[0], 400)
        self.assertEqual(self.request("POST", "/api/missing", {})[0], 404)


class StorageTest(unittest.TestCase):
    def test_override_does_not_create_directories(self):
        target = Path(__file__).parent / "test-tmp" / "not-created"
        with patch.dict("os.environ", {"MONSTER_WORKSHOP_DATA_DIR": str(target)}):
            self.assertEqual(data_directory(), target.resolve())
            self.assertFalse(target.exists())

    def test_failed_replace_preserves_previous_file(self):
        parent = Path(__file__).parent / "test-tmp"
        parent.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as folder:
            root = Path(folder).resolve()
            assert root.is_relative_to(parent.resolve())
            saved = root / "record.json"
            saved.write_bytes(b"previous")
            with patch("storage.os.replace", side_effect=OSError("replace failed")):
                with self.assertRaises(OSError):
                    write_bytes(saved, b"new")
            self.assertEqual(saved.read_bytes(), b"previous")
            self.assertEqual(list(root.iterdir()), [saved])

    def test_uuid_normalization_and_semantic_duplicates(self):
        project = default_project()
        project["id"] = project["id"].upper()
        validate(project)
        self.assertEqual(project["id"], project["id"].lower())
        value = "12345678-abcd-4321-abcd-123456789abc"
        project["pack_ids"][:2] = [value, value.upper()]
        with self.assertRaisesRegex(ValueError, "UUID"):
            validate(project)
