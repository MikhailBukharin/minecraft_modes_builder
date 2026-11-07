import json
import unittest

from bedrock import assets, default_project, geometry, validate_geometry
from stories import validate_stories


def example():
    nodes = [
        {"id": k, "type": t, "x": 10, "y": 10, "data": d}
        for k, t, d in [
            ("s", "start", {}),
            ("r", "repeat", {"times": 3}),
            ("b", "say", {"text": "Привет", "seconds": 1}),
            ("ret", "return", {}),
            (
                "q",
                "dialogue",
                {
                    "text": "Пойдём?",
                    "choices": [{"id": "yes", "text": "Да"}, {"id": "no", "text": "Нет"}],
                },
            ),
            ("f", "follow", {"seconds": 2}),
            ("w", "wait", {"seconds": 1}),
            ("e", "end", {}),
        ]
    ]
    edges = [
        dict(zip(["from", "port", "to"], v))
        for v in [
            ("s", "next", "r"),
            ("r", "body", "b"),
            ("b", "next", "ret"),
            ("r", "next", "q"),
            ("q", "choice:yes", "f"),
            ("q", "choice:no", "w"),
            ("f", "next", "e"),
            ("w", "next", "e"),
        ]
    ]
    return {"id": "test", "name": "Приключение", "nodes": nodes, "edges": edges}


class StoryTest(unittest.TestCase):
    def action_story(self, t, data):
        branch = t in ["move", "trade", "has_item", "chance"]
        return {
            "id": "action",
            "name": "Действие",
            "nodes": [
                {"id": "s", "type": "start", "data": {}},
                {"id": "a", "type": t, "data": data},
                {"id": "e", "type": "end", "data": {}},
            ],
            "edges": [{"from": "s", "to": "a", "port": "next"}]
            + [
                {"from": "a", "to": "e", "port": port}
                for port in (["yes", "no"] if branch else ["next"])
            ],
        }

    def test_landmark_native_goal_export_and_arrival(self):
        p = default_project()
        p["stories"] = [
            self.action_story("move", {"landmark": "campfire", "range": 12, "seconds": 10})
        ]
        files = assets(p)
        entity = next(
            json.loads(v)["minecraft:entity"] for k, v in files.items() if "/entities/" in k
        )
        self.assertEqual(entity["description"]["properties"]["workshop:arrived"]["default"], False)
        group = "workshop:move_campfire_12"
        goal = entity["component_groups"][group]["minecraft:behavior.move_to_block"]
        self.assertEqual(goal["target_blocks"], ["minecraft:campfire"])
        self.assertEqual(goal["search_range"], 12)
        self.assertEqual(goal["on_reach"][0]["event"], "workshop:arrived")
        self.assertIn(group, entity["events"]["workshop:wait"]["remove"]["component_groups"])
        self.assertIn("Monster_BP/scripts/story-actions.js", files)

    def test_branch_outputs_required(self):
        s = self.action_story("has_item", {"item": "minecraft:bread", "count": 1})
        s["edges"].pop()
        validate_stories([s])
        with self.assertRaisesRegex(ValueError, "соедините"):
            validate_stories([s], True)

    def test_action_limits(self):
        for t, d in [
            ("move", {"landmark": "campfire", "range": 25, "seconds": 10}),
            ("move", {"landmark": "lava", "range": 12, "seconds": 10}),
            ("chance", {"percent": 101}),
            ("effect", {"target": "player", "effect": "speed", "seconds": 61, "amplifier": 0}),
            ("effect", {"target": "player", "effect": "wither", "seconds": 5, "amplifier": 0}),
            ("has_item", {"item": "minecraft:bread", "count": 1.5}),
            ("heal", {"target": "all_players", "amount": 4}),
            ("sound", {"sound": "random.levelup", "volume": 2, "pitch": 1}),
            ("title", {"text": "A" * 161, "subtitle": ""}),
        ]:
            with self.subTest(t=t, d=d), self.assertRaises(ValueError):
                validate_stories([self.action_story(t, d)], True)

    def test_legacy_layout_preserved(self):
        p = default_project()
        p["parameter_layout"] = {"health": {"x": 100, "y": 20}}
        p.update(
            knockback=0.5,
            detection=24,
            attack_cooldown=2,
            gravity=False,
            pushable=False,
            can_jump=False,
            interactions=True,
        )
        assets(p)
        self.assertEqual(p["parameter_layout"]["health"]["x"], 100)
        self.assertEqual(p["knockback"], 0.5)

    def test_repeat_dialogue_script_export(self):
        p = default_project()
        p["stories"] = [example()]
        validate_stories(p["stories"], strict=True)
        files = assets(p)
        manifest = json.loads(files["Monster_BP/manifest.json"])
        script = next(m for m in manifest["modules"] if m["type"] == "script")
        self.assertIn("Monster_BP/" + script["entry"], files)
        self.assertEqual(
            {d.get("module_name") for d in manifest["dependencies"] if "module_name" in d},
            {"@minecraft/server", "@minecraft/server-ui"},
        )
        config = files["Monster_BP/scripts/config.js"].decode()
        self.assertIn("Приключение", config)
        entity = next(
            json.loads(v)["minecraft:entity"] for k, v in files.items() if "/entities/" in k
        )
        for mode in ["default", "follow", "wait", "wander"]:
            self.assertIn("workshop:" + mode, entity["events"])
        self.assertIn("minecraft:tameable", entity["components"])

    def test_incomplete_can_save_not_export(self):
        s = example()
        s["edges"].pop()
        validate_stories([s])
        with self.assertRaisesRegex(ValueError, "соедините"):
            validate_stories([s], strict=True)

    def test_invalid_graphs(self):
        for mutate in [
            lambda s: s["edges"].append({"from": "w", "to": "r", "port": "next"}),
            lambda s: s["edges"].append({"from": "s", "to": "e", "port": "next"}),
            lambda s: s["edges"].append({"from": "b", "to": "missing", "port": "next"}),
            lambda s: s["nodes"][1]["data"].update(times=100),
        ]:
            s = example()
            mutate(s)
            with self.assertRaises(ValueError):
                validate_stories([s], strict=True)

    def test_repeat_body_must_return(self):
        s = example()
        s["nodes"][3]["type"] = "end"
        with self.assertRaisesRegex(ValueError, "Тело повтора"):
            validate_stories([s], strict=True)

    def test_model_edits_preserved(self):
        p = default_project()
        p["geometry"] = geometry(p)
        b = p["geometry"]["minecraft:geometry"][0]["bones"][1]
        c = b["cubes"][0]
        c.update(rotation=[10, 20, 30], pivot=[1, 2, 3], inflate=0.5, mirror=True)
        b["rotation"] = [0, 15, 0]
        out = next(json.loads(v) for k, v in assets(p).items() if k.endswith(".geo.json"))
        self.assertEqual(out["minecraft:geometry"][0]["bones"][1]["cubes"][0], c)
        c["inflate"] = -20
        with self.assertRaises(ValueError):
            validate_geometry(p["geometry"])

    def test_new_parameter_components(self):
        p = default_project()
        p.update(
            fire_immune=True,
            knockback=0.7,
            gravity=False,
            can_jump=False,
            material="entity_alphablend",
        )
        files = assets(p)
        e = next(
            json.loads(v)["minecraft:entity"]["components"]
            for k, v in files.items()
            if "/entities/" in k
        )
        self.assertIn("minecraft:fire_immune", e)
        self.assertEqual(e["minecraft:knockback_resistance"]["value"], 0.7)
        self.assertFalse(e["minecraft:physics"]["has_gravity"])
        self.assertNotIn("minecraft:jump.static", e)

    def test_no_script_dependency_for_basic_monster(self):
        p = default_project()
        m = json.loads(assets(p)["Monster_BP/manifest.json"])
        self.assertEqual(len(m["modules"]), 1)


if __name__ == "__main__":
    unittest.main()
