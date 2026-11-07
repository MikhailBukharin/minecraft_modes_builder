import io
import json
import unittest
import zipfile

from bedrock import archive, assets, default_project, geometry, validate


class AddonTest(unittest.TestCase):
    def test_archive_references_and_versions(self):
        p = default_project()
        with zipfile.ZipFile(io.BytesIO(archive(p))) as z:
            self.assertIsNone(z.testzip())
            self.assertEqual(set(z.namelist()), {"Monster_BP.mcpack", "Monster_RP.mcpack"})
            for name in z.namelist():
                with zipfile.ZipFile(io.BytesIO(z.read(name))) as pack:
                    self.assertIsNone(pack.testzip())
                    self.assertIn("manifest.json", pack.namelist())
            files = assets(p)
            docs = {n: json.loads(data) for n, data in files.items() if n.endswith(".json")}
            bp = docs["Monster_BP/manifest.json"]
            rp = docs["Monster_RP/manifest.json"]
            self.assertEqual(bp["dependencies"][0]["uuid"], rp["header"]["uuid"])
            self.assertEqual(bp["dependencies"][0]["version"], rp["header"]["version"])
            self.assertEqual(rp["header"]["min_engine_version"], [1, 26, 60])
            uuids = [m["header"]["uuid"] for m in [bp, rp]] + [
                m["modules"][0]["uuid"] for m in [bp, rp]
            ]
            self.assertEqual(len(set(uuids)), 4)
            client = next(
                v["minecraft:client_entity"]["description"]
                for v in docs.values()
                if "minecraft:client_entity" in v
            )
            self.assertIn("Monster_RP/" + client["textures"]["default"] + ".png", files)
            g = next(v["minecraft:geometry"][0] for v in docs.values() if "minecraft:geometry" in v)
            self.assertEqual(client["geometry"]["default"], g["description"]["identifier"])

    def test_behavior_modes(self):
        for behavior in ["peaceful", "neutral", "hostile"]:
            p = default_project()
            p["behavior"] = behavior
            bp = next(
                json.loads(v)["minecraft:entity"] for k, v in assets(p).items() if "/entities/" in k
            )
            self.assertEqual("minecraft:attack" in bp["components"], behavior != "peaceful")
            self.assertEqual(
                "minecraft:behavior.nearest_attackable_target" in bp["components"],
                behavior == "hostile",
            )

    def test_bad_inputs_and_cyclic_geometry(self):
        for value in ["../bad", "minecraft:bad", "Xss"]:
            p = default_project()
            p["slug"] = value
            with self.assertRaises(ValueError):
                validate(p)
        p = default_project()
        p["health"] = float("nan")
        with self.assertRaises(ValueError):
            validate(p)
        p = default_project()
        p["geometry"] = geometry(p)
        p["geometry"]["minecraft:geometry"][0]["bones"][0]["parent"] = "head"
        with self.assertRaises(ValueError):
            validate(p)

    def test_distinct_resources(self):
        a = default_project()
        b = default_project()
        b["slug"] = "other_monster"

        def paths(project):
            return {key for key in assets(project) if key.endswith(".png")}

        self.assertFalse(paths(a) & paths(b))

    def test_model_and_spawn_variants(self):
        p = default_project()
        p["shape"] = "quadruped"
        p["spawn"] = "natural"
        self.assertTrue(any("/spawn_rules/" in k for k in assets(p)))
        g = geometry(p)["minecraft:geometry"][0]
        self.assertEqual(len([b for b in g["bones"] if b["name"].startswith("leg_")]), 4)


if __name__ == "__main__":
    unittest.main()
