import copy
import json
import struct
import unittest
import zlib

from bedrock import assets, default_project, validate
from generation import recipe_to_candidate
from stories import upgrade
from test_generation import recipe


class PaletteTest(unittest.TestCase):
    def project(self):
        r = recipe()
        leg = copy.deepcopy(r["bones"][1])
        leg.update(name="leg_left", parent="body")
        leg["cubes"][0]["color"] = 3
        r["bones"].append(leg)
        c = recipe_to_candidate(r)
        p = default_project()
        p.update(geometry=c["geometry"], texture=c["texture"], generation={"id": "old-project"})
        return p

    def test_old_codex_palette_migrates_without_repainting(self):
        p = self.project()
        old = p["texture"]
        upgrade(p)
        self.assertEqual(p["palette_roles"], {"body": 0, "accent": 3})
        self.assertEqual(p["color"], "#112233")
        self.assertEqual(p["accent"], "#abcdef")
        self.assertEqual(p["texture"], old)

    def test_colors_change_exported_png_and_survive_reopening(self):
        p = self.project()
        upgrade(p)
        p.update(color="#ff0011", accent="#00aaff")
        p = json.loads(json.dumps(p))
        upgrade(p)
        texture = next(v for k, v in assets(p).items() if k.endswith(".png"))
        offset = 8
        data = b""
        while offset < len(texture):
            n = struct.unpack(">I", texture[offset : offset + 4])[0]
            if texture[offset + 4 : offset + 8] == b"IDAT":
                data += texture[offset + 8 : offset + 8 + n]
            offset += n + 12
        raw = zlib.decompress(data)
        self.assertEqual(raw[1:4], bytes.fromhex("ff0011"))
        self.assertEqual(raw[1 + 3 * 48 : 4 + 3 * 48], bytes.fromhex("00aaff"))
        self.assertEqual(raw[1 + 7 * 48 : 4 + 7 * 48], bytes.fromhex("990000"))
        self.assertEqual(p["color"], "#ff0011")

    def test_invalid_palette_and_roles_are_rejected(self):
        for change in [{"model_palette": ["#ffffff"]}, {"palette_roles": {"body": 0, "accent": 0}}]:
            p = self.project()
            upgrade(p)
            p.update(change)
            with self.assertRaises(ValueError):
                validate(p)


class RewardsTest(unittest.TestCase):
    def test_death_loot_and_player_experience_without_scripts(self):
        p = default_project()
        p["rewards"].update(
            experience=17,
            death=[dict(id="loot", item="minecraft:blaze_rod", min=1, max=3, chance=25)],
        )
        files = assets(p)
        entity = next(
            json.loads(v)["minecraft:entity"] for k, v in files.items() if "/entities/" in k
        )
        self.assertEqual(
            entity["components"]["minecraft:experience_reward"]["on_death"],
            "query.last_hit_by_player ? 17 : 0",
        )
        path = "Monster_BP/" + entity["components"]["minecraft:loot"]["table"]
        pool = json.loads(files[path])["pools"][0]
        self.assertEqual(pool["conditions"][0]["chance"], 0.25)
        self.assertEqual(pool["entries"][0]["functions"][0]["count"], {"min": 1, "max": 3})
        self.assertFalse(any(k.endswith("/main.js") for k in files))

    def test_timer_and_trade_independently_enable_runtime(self):
        for kind, row in [
            ("timed", dict(id="t", item="minecraft:egg", min=1, max=2, chance=100, seconds=60)),
            (
                "trades",
                dict(
                    id="t",
                    food="minecraft:apple",
                    food_count=2,
                    item="minecraft:emerald",
                    count=1,
                    cooldown=10,
                ),
            ),
        ]:
            p = default_project()
            p["rewards"][kind] = [row]
            files = assets(p)
            self.assertIn("Monster_BP/scripts/economy.js", files)
            config = json.loads(
                files["Monster_BP/scripts/config.js"]
                .decode()
                .removeprefix("export const config = ")
                .strip()
                .removesuffix(";")
            )
            self.assertEqual(config["rewards"][kind], [row])

    def test_invalid_rewards_are_rejected(self):
        good = dict(id="a", item="minecraft:egg", min=1, max=2, chance=100, seconds=60)
        for change in [
            {"seconds": 0},
            {"min": 4},
            {"chance": 101},
            {"item": "minecraft:egg; say hello"},
            {"max": True},
        ]:
            p = default_project()
            p["rewards"]["timed"] = [dict(good, **change)]
            with self.assertRaises(ValueError):
                assets(p)
        p = default_project()
        p["rewards"]["trades"] = [
            dict(
                id="t",
                food="minecraft:stone",
                food_count=1,
                item="minecraft:diamond",
                count=1,
                cooldown=0,
            )
        ]
        with self.assertRaises(ValueError):
            assets(p)

    def test_legacy_rewards_are_empty_and_independent(self):
        a = default_project()
        b = default_project()
        a["rewards"]["death"].append({})
        self.assertEqual(
            {k: b["rewards"][k] for k in ["experience", "death", "timed", "trades"]},
            {"experience": 0, "death": [], "timed": [], "trades": []},
        )
        self.assertEqual(b["rewards"]["trade_mode"], "food")


if __name__ == "__main__":
    unittest.main()
