import base64
import copy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from bedrock import archive, assets, default_project
from bundle import build, consistency, import_addon, inspect_source, new_bundle, prepare, read_addon


class BundleTest(unittest.TestCase):
    def setUp(self):
        parent = Path(__file__).resolve().parent / "test-tmp"
        parent.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.root = Path(self.temp.name).resolve()
        assert self.root.is_relative_to(parent.resolve())
        self.addCleanup(self.temp.cleanup)
        (self.root / "projects").mkdir()
        (self.root / "bundles").mkdir()
        self.a = default_project()
        self.a.update(name="Первый", slug="first", spawn="natural")
        self.a["population"]["guard"] = True
        self.b = default_project()
        self.b.update(name="Второй", slug="second", spawn="natural")
        self.b["population"]["guard"] = True
        self.save(self.a)
        self.save(self.b)

    def save(self, p):
        (self.root / "projects" / f"{p['id']}.json").write_text(json.dumps(p), encoding="utf-8")

    def settings(self):
        b = new_bundle()
        b["selection"] = [
            dict(kind="project", id=p["id"], identifier=p["namespace"] + ":" + p["slug"])
            for p in [self.a, self.b]
        ]
        return b

    def unpack(self, data):
        return read_addon(data)

    def test_real_merge_paths_languages_manifest_and_scripts(self):
        s = self.settings()
        _, r = prepare(self.root, s)
        self.assertTrue(r["ok"], r["errors"])
        data, saved, r = build(self.root, s, r["snapshot"])
        files = self.unpack(data)
        self.assertEqual(len([k for k in files if "/entities/" in k]), 2)
        self.assertEqual(len([k for k in files if "/spawn_rules/" in k]), 2)
        lang = files["Monster_RP/texts/ru_RU.lang"].decode()
        self.assertIn("my_monsters:first", lang)
        self.assertIn("my_monsters:second", lang)
        bp = json.loads(files["Monster_BP/manifest.json"])
        rp = json.loads(files["Monster_RP/manifest.json"])
        self.assertEqual(bp["dependencies"][0]["uuid"], rp["header"]["uuid"])
        self.assertEqual(bp["dependencies"][0]["version"], rp["header"]["version"])
        self.assertEqual(len([m for m in bp["modules"] if m["type"] == "script"]), 1)
        startup = files["Monster_BP/scripts/main.js"].decode()
        self.assertIn("creatures/my_monsters/first/main.js", startup)
        self.assertIn("creatures/my_monsters/second/main.js", startup)
        configs = [
            json.loads(v.decode().removeprefix("export const config = ").strip().removesuffix(";"))
            for k, v in files.items()
            if k.endswith("/config.js")
        ]
        self.assertEqual(len({c["population_key"] for c in configs}), 2)
        self.assertEqual(consistency(files), [])
        self.assertNotIn(bp["header"]["uuid"], self.a["pack_ids"] + self.b["pack_ids"])

    def test_conflicting_entity_id_and_explicit_rename(self):
        self.b["slug"] = "first"
        self.save(self.b)
        s = self.settings()
        _, r = prepare(self.root, s)
        self.assertFalse(r["ok"])
        self.assertIn("Повторяющийся ID", " ".join(r["errors"]))
        s["selection"][1]["identifier"] = "friends:merchant"
        files, r = prepare(self.root, s)
        self.assertTrue(r["ok"], r["errors"])
        self.assertIn("Monster_RP/textures/entity/friends/merchant.png", files)
        self.assertEqual(consistency(files), [])
        self.assertEqual(
            json.loads((self.root / "projects" / f"{self.b['id']}.json").read_text())["slug"],
            "first",
        )

    def test_npc_native_rewards_follow_renamed_id(self):
        n = self.b["rewards"]["npc_trade"]
        self.b["rewards"]["trade_mode"] = "npc"
        n["requests"] = [dict(id="request", item="minecraft:wheat", min=4, max=8)]
        n["rewards"] = [dict(id="potion", choice="healing_potion", count=1)]
        # Use a real choice from the installed catalog.
        from npc_trading import CHOICES

        n["rewards"][0]["choice"] = next(k for k, v in CHOICES.items() if v.get("potion"))
        self.save(self.b)
        s = self.settings()
        s["selection"][1]["identifier"] = "friends:merchant"
        files, r = prepare(self.root, s)
        self.assertTrue(r["ok"], r["errors"])
        self.assertEqual(r["script_api"], "2.4.0")
        config = json.loads(
            files["Monster_BP/scripts/creatures/friends/merchant/config.js"]
            .decode()
            .removeprefix("export const config = ")
            .strip()
            .removesuffix(";")
        )
        self.assertTrue(config["npc_rewards"][0]["loot_table"].startswith("npc/friends/merchant/"))
        self.assertEqual(consistency(files), [])

    def test_stable_collection_identity_and_version(self):
        s = self.settings()
        _, r = prepare(self.root, s)
        data, saved, _ = build(self.root, s, r["snapshot"])
        (self.root / "bundles" / f"{saved['id']}.json").write_text(json.dumps(saved))
        data2, saved2, _ = build(self.root, saved, r["snapshot"])
        a = json.loads(self.unpack(data)["Monster_BP/manifest.json"])
        b = json.loads(self.unpack(data2)["Monster_BP/manifest.json"])
        self.assertEqual(a["header"]["uuid"], b["header"]["uuid"])
        self.assertEqual(b["header"]["version"], [1, 0, 2])
        self.assertEqual(saved2["version"], 2)
        self.assertEqual(
            json.loads((self.root / "projects" / f"{self.a['id']}.json").read_text())["version"], 0
        )

    def test_source_change_invalidates_checked_snapshot(self):
        s = self.settings()
        _, r = prepare(self.root, s)
        self.a["health"] = 99
        self.save(self.a)
        with self.assertRaisesRegex(ValueError, "изменился после проверки"):
            build(self.root, s, r["snapshot"])

    def test_import_existing_individual_file_and_regenerate_code(self):
        raw = archive(self.b)
        entry = import_addon(self.root, "second.mcaddon", base64.b64encode(raw).decode())
        s = self.settings()
        s["selection"][1] = {"kind": "import", "id": entry["id"], "identifier": "imported:second"}
        files, r = prepare(self.root, s)
        self.assertTrue(r["ok"], r["errors"])
        self.assertIn("Monster_BP/scripts/creatures/imported/second/main.js", files)
        self.assertEqual(
            files["Monster_BP/scripts/creatures/imported/second/main.js"],
            (Path(__file__).parent / "runtime.js").read_bytes(),
        )

    def test_basic_sources_still_have_shared_admission_guard(self):
        for p in [self.a, self.b]:
            p["spawn"] = "manual"
            p["population"]["guard"] = False
            self.save(p)
        s = self.settings()
        data, _, _ = build(self.root, s, prepare(self.root, s)[1]["snapshot"])
        files = self.unpack(data)
        self.assertIn("Monster_BP/scripts/bundle-guard.js", files)
        self.assertNotIn("creatures/", files["Monster_BP/scripts/main.js"].decode())

    def test_broken_reference_and_external_item_block_export(self):
        files = assets(copy.deepcopy(self.a))
        files.pop("Monster_RP/textures/entity/my_monsters/first.png")
        self.assertTrue(any("текстура" in e for e in consistency(files)))
        self.a["rewards"]["death"] = [dict(id="x", item="missing:gem", min=1, max=1, chance=100)]
        self.save(self.a)
        _, r = prepare(self.root, self.settings())
        self.assertFalse(r["ok"])
        self.assertIn("missing:gem", " ".join(r["errors"]))

    def test_zip_traversal_duplicates_and_corruption_rejected(self):
        for names in [
            ["../bad.mcpack"],
            ["A.mcpack", "a.mcpack"],
            ["folder" + chr(92) + "bad.mcpack"],
            ["folder/./bad.mcpack"],
            ["folder//bad.mcpack"],
        ]:
            out = io.BytesIO()
            with zipfile.ZipFile(out, "w") as z:
                for name in names:
                    z.writestr(name, b"bad")
            with self.assertRaises(ValueError):
                read_addon(out.getvalue())
        with self.assertRaises(ValueError):
            read_addon(b"not zip")

    def test_unrecognized_script_and_native_modification_rejected(self):
        files = assets(copy.deepcopy(self.a))
        files["Monster_BP/scripts/custom.js"] = b"custom"
        with self.assertRaisesRegex(ValueError, "Пользовательские"):
            inspect_source(files, "x")
        files = assets(copy.deepcopy(self.a))
        key = next(k for k in files if "/entities/" in k)
        e = json.loads(files[key])
        e["minecraft:entity"]["events"]["custom:event"] = {}
        files[key] = json.dumps(e).encode()
        with self.assertRaisesRegex(ValueError, "Нестандартные"):
            inspect_source(files, "x")


if __name__ == "__main__":
    unittest.main()
