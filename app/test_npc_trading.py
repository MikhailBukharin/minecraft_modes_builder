import copy
import json
import unittest

from bedrock import assets, default_project, validate
from npc_trading import CATALOG
from stories import upgrade


class NpcTradingTest(unittest.TestCase):
    def project(self):
        p = default_project()
        p["rewards"]["trade_mode"] = "npc"
        return p

    def test_npc_exports_native_potion_book_and_choice_catalog(self):
        p = self.project()
        files = assets(p)
        manifest = json.loads(files["Monster_BP/manifest.json"])
        self.assertEqual(
            next(
                d["version"]
                for d in manifest["dependencies"]
                if d.get("module_name") == "@minecraft/server"
            ),
            "2.4.0",
        )
        config = json.loads(
            files["Monster_BP/scripts/config.js"]
            .decode()
            .removeprefix("export const config = ")
            .strip()
            .removesuffix(";")
        )
        self.assertEqual(len(config["npc_rewards"]), len(p["rewards"]["npc_trade"]["rewards"]))
        for reward in config["npc_rewards"]:
            table = json.loads(files["Monster_BP/loot_tables/" + reward["loot_table"] + ".json"])
            entry = table["pools"][0]["entries"][0]
            self.assertEqual(entry["name"], reward["item"])
            if reward.get("potion"):
                self.assertIn({"function": "set_potion", "id": "healing"}, entry["functions"])
            if reward.get("enchantment"):
                self.assertIn(
                    {"function": "specific_enchants", "enchants": [{"id": "mending", "level": 1}]},
                    entry["functions"],
                )
        self.assertIn("Monster_BP/scripts/npc-trade.js", files)
        self.assertIn("Monster_BP/scripts/npc-trade-runtime.js", files)

    def test_food_export_stays_compatible_and_keeps_npc_lists(self):
        p = default_project()
        p["rewards"]["trades"] = [
            dict(
                id="food",
                food="minecraft:bread",
                food_count=2,
                item="minecraft:emerald",
                count=1,
                cooldown=10,
            )
        ]
        files = assets(p)
        manifest = json.loads(files["Monster_BP/manifest.json"])
        self.assertEqual(
            next(
                d["version"]
                for d in manifest["dependencies"]
                if d.get("module_name") == "@minecraft/server"
            ),
            "2.0.0",
        )
        self.assertFalse(any("/loot_tables/npc/" in k for k in files))
        p["rewards"]["trade_mode"] = "npc"
        assets(p)
        p["rewards"]["trade_mode"] = "food"
        self.assertEqual(p["rewards"]["trades"][0]["food_count"], 2)

    def test_old_projects_migrate_with_food_mode_and_independent_defaults(self):
        p = default_project()
        p["rewards"] = {"experience": 0, "death": [], "timed": [], "trades": []}
        upgrade(p)
        self.assertEqual(p["rewards"]["trade_mode"], "food")
        other = default_project()
        p["rewards"]["npc_trade"]["requests"][0]["min"] = 1
        self.assertEqual(other["rewards"]["npc_trade"]["requests"][0]["min"], 24)

    def test_invalid_npc_rules_are_rejected(self):
        for change in [
            lambda n: n.update(refresh_seconds=1),
            lambda n: n.update(max_uses=0),
            lambda n: n["requests"][0].update(max=1),
            lambda n: n["requests"][0].update(id="../escape"),
            lambda n: n["requests"].append(copy.deepcopy(n["requests"][0])),
            lambda n: n["rewards"][0].update(choice="unlisted_reward"),
            lambda n: n["rewards"][3].update(count=2),
            lambda n: n["rewards"].append(dict(n["rewards"][0], id="different")),
        ]:
            p = self.project()
            change(p["rewards"]["npc_trade"])
            with self.assertRaises(ValueError):
                assets(p)

    def test_empty_draft_can_save_but_cannot_export_as_npc(self):
        p = self.project()
        p["rewards"]["npc_trade"]["requests"] = []
        validate(p)
        with self.assertRaisesRegex(ValueError, "хотя бы один"):
            assets(p)
        p["rewards"]["trade_mode"] = "food"
        assets(p)

    def test_catalog_does_not_allow_overstacking_potions_and_books(self):
        for spec in CATALOG["rewards"]:
            if spec.get("potion") or spec.get("enchantment"):
                self.assertEqual(spec["max_count"], 1)


if __name__ == "__main__":
    unittest.main()
