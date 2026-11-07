import json
import unittest

from bedrock import assets, default_project, geometry
from population import guardrail_report
from stories import upgrade


class PopulationTest(unittest.TestCase):
    def test_native_parameters_export(self):
        p = default_project()
        p["spawn"] = "natural"
        p["population"].update(weight=3, herd_min=1, herd_max=3, native_density=5)
        files = assets(p)
        rules = json.loads(files["Monster_BP/spawn_rules/monster.spawn_rules.json"])[
            "minecraft:spawn_rules"
        ]
        s = rules["conditions"][0]
        self.assertEqual(s["minecraft:weight"]["default"], 3)
        self.assertEqual(s["minecraft:herd"]["max_size"], 3)
        self.assertEqual(s["minecraft:density_limit"], {"surface": 5, "underground": 0})
        self.assertEqual(rules["description"]["population_control"], "animal")
        p["behavior"] = "hostile"
        self.assertEqual(
            json.loads(assets(p)["Monster_BP/spawn_rules/monster.spawn_rules.json"])[
                "minecraft:spawn_rules"
            ]["description"]["population_control"],
            "monster",
        )

    def test_guard_without_stories_enables_script(self):
        p = default_project()
        p["population"]["guard"] = True
        files = assets(p)
        self.assertIn("Monster_BP/scripts/population-runtime.js", files)
        self.assertIn("Monster_BP/scripts/population-guard.js", files)
        config = json.loads(
            files["Monster_BP/scripts/config.js"]
            .decode()
            .removeprefix("export const config = ")
            .strip()
            .removesuffix(";")
        )
        self.assertEqual(config["population"], p["population"])
        self.assertNotIn("Monster_BP/spawn_rules/monster.spawn_rules.json", files)

    def test_legacy_natural_projects_gain_guard_and_manual_do_not(self):
        for spawn, enabled in [("manual", False), ("natural", True)]:
            p = default_project()
            p["spawn"] = spawn
            del p["population"]
            upgrade(p)
            self.assertEqual(p["population"]["guard"], enabled)
            self.assertEqual(p["population"]["loaded_max"], 20)

    def test_invalid_population_settings(self):
        for change in [
            {"area_size": 65},
            {"loaded_max": True},
            {"weight": 0},
            {"herd_min": 3},
            {"herd_max": 5},
            {"area_max": 30},
            {"period_max": 17},
            {"guard": "true"},
        ]:
            p = default_project()
            p["population"].update(change)
            with self.assertRaises(ValueError):
                assets(p)

    def test_report_counts_model_and_reward_pressure(self):
        p = default_project()
        g = geometry(p)
        p["rewards"]["timed"] = [
            dict(id="t", item="minecraft:egg", min=1, max=2, chance=50, seconds=1)
        ]
        report = guardrail_report(p, g)
        self.assertEqual(
            report["cubes"], sum(len(b["cubes"]) for b in g["minecraft:geometry"][0]["bones"])
        )
        self.assertEqual(report["projected_cubes"], report["cubes"] * 20)
        self.assertEqual(report["timed_items_per_minute"], 120)
        self.assertTrue(any("добыча" in v for v in report["warnings"]))

    def test_defaults_do_not_share_state(self):
        a = default_project()
        b = default_project()
        a["population"]["area_max"] = 1
        self.assertEqual(b["population"]["area_max"], 4)

    def test_report_does_not_imply_manual_spawn_is_capped(self):
        p = default_project()
        report = guardrail_report(p, geometry(p))
        self.assertTrue(any("яйца и команды" in v for v in report["warnings"]))


if __name__ == "__main__":
    unittest.main()
