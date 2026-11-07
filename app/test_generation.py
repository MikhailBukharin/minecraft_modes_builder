import base64
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import generation
from bedrock import assets, default_project, png
from stories import upgrade, validate_stories


def recipe():
    return {
        "summary": "Тестовый кубический персонаж",
        "palette": [
            "#112233",
            "#445566",
            "#778899",
            "#abcdef",
            "#ffffff",
            "#000000",
            "#ff6600",
            "#990000",
        ],
        "bones": [
            {"name": "root", "parent": "", "pivot": [0, 0, 0], "rotation": [0, 0, 0], "cubes": []},
            {
                "name": "body",
                "parent": "root",
                "pivot": [0, 8, 0],
                "rotation": [0, 0, 0],
                "cubes": [
                    {
                        "origin": [-4, 0, -4],
                        "size": [8, 16, 8],
                        "pivot": [0, 8, 0],
                        "rotation": [0, 0, 0],
                        "inflate": 0,
                        "color": 0,
                    }
                ],
            },
        ],
    }


class GenerationTest(unittest.TestCase):
    def test_palette_recipe_exports_as_bedrock(self):
        candidate = generation.recipe_to_candidate(recipe())
        p = default_project()
        p.update(geometry=candidate["geometry"], texture=candidate["texture"])
        files = assets(p)
        self.assertEqual(candidate["cubes"], 1)
        self.assertEqual(candidate["bones"], 2)
        self.assertTrue(any(k.endswith(".geo.json") for k in files))
        self.assertEqual(recipe()["bones"][1]["cubes"][0]["color"], 0)

    def test_bad_model_is_never_accepted(self):
        for mutate in [
            lambda r: r["palette"].append("#112233"),
            lambda r: r["bones"][1]["cubes"][0].update(color=9),
            lambda r: r["bones"][1]["cubes"][0].update(size=[-2, 2, 2]),
            lambda r: r["bones"][0].update(parent="body"),
        ]:
            r = recipe()
            mutate(r)
            with self.assertRaises(ValueError):
                generation.recipe_to_candidate(r)

    def test_consent_and_drawing_required(self):
        p = default_project()
        with self.assertRaisesRegex(ValueError, "Подтвердите"):
            generation.start_job(p)
        with self.assertRaisesRegex(ValueError, "рисунок"):
            generation.start_job(p, consent=True)

    def test_prompt_contains_project_not_other_data(self):
        p = default_project()
        p["stories"] = [
            {
                "name": "Секрет персонажа",
                "nodes": [{"type": "say", "data": {"text": "Охраняю лес"}}],
            }
        ]
        prompt = generation.prompt_for(p, "Два глаза")
        self.assertIn("Охраняю лес", prompt)
        self.assertIn("Два глаза", prompt)
        self.assertNotIn("pack_ids", prompt)

    def test_command_has_no_shell_or_inherited_plugins(self):
        cmd = generation.command("codex.exe", Path("C:/job"))
        self.assertIn("--ignore-user-config", cmd)
        self.assertIn("read-only", cmd)
        self.assertIn("shell_tool", cmd)
        self.assertIn("plugins", cmd)
        self.assertIn("--output-schema", cmd)
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", cmd)

    def test_job_pipeline_with_fake_cli(self):
        class FakeProcess:
            returncode = 0

            def __init__(self, args, **kwargs):
                Path(args[args.index("-o") + 1]).write_text(json.dumps(recipe()), encoding="utf-8")

            def communicate(self, *args, **kwargs):
                return (None, None)

            def terminate(self):
                pass

        p = default_project()
        p["drawing"] = (
            "data:image/png;base64," + base64.b64encode(png(p["color"], p["accent"])).decode()
        )
        test_root = Path(__file__).resolve().parents[1] / "tmp/generation-tests"
        test_root.mkdir(parents=True, exist_ok=True)
        with (
            tempfile.TemporaryDirectory(dir=test_root) as folder,
            patch.object(generation, "JOBS", Path(folder)),
            patch.object(generation, "codex_path", return_value="codex.exe"),
            patch.object(generation.subprocess, "Popen", FakeProcess),
            patch.object(generation.threading, "Thread"),
        ):
            assert Path(folder).resolve().is_relative_to(test_root.resolve())
            job = generation.start_job(p, consent=True)
            generation._run(job["id"], "codex.exe", "prompt")
            result = generation.get_job(job["id"], True)
            self.assertEqual(result["status"], "ready")
            self.assertEqual(result["candidate"]["cubes"], 1)
            generation._jobs.pop(job["id"], None)


class NewEditorTest(unittest.TestCase):
    def test_multi_biome_any_of(self):
        p = default_project()
        p.update(spawn="natural", biomes=["forest", "desert", "taiga"])
        spawn = next(json.loads(v) for k, v in assets(p).items() if "/spawn_rules/" in k)
        filters = spawn["minecraft:spawn_rules"]["conditions"][0]["minecraft:biome_filter"][
            "any_of"
        ]
        self.assertEqual([f["value"] for f in filters], p["biomes"])

    def test_legacy_biome_migration(self):
        p = default_project()
        del p["biomes"]
        p["biome"] = "desert"
        upgrade(p)
        self.assertEqual(p["biomes"], ["desert"])

    def test_natural_spawn_requires_nonempty_biomes(self):
        p = default_project()
        p.update(spawn="natural", biomes=[])
        with self.assertRaisesRegex(ValueError, "биом"):
            assets(p)

    def test_start_can_be_added_back_to_draft(self):
        s = {
            "id": "s",
            "name": "Черновик",
            "nodes": [{"id": "end", "type": "end", "data": {}}],
            "edges": [],
        }
        validate_stories([s])
        with self.assertRaisesRegex(ValueError, "Начать"):
            validate_stories([s], strict=True)
        s["nodes"].insert(0, {"id": "start", "type": "start", "data": {}})
        s["edges"].append({"from": "start", "to": "end", "port": "next"})
        validate_stories([s], strict=True)
        s["nodes"].append({"id": "start2", "type": "start", "data": {}})
        with self.assertRaisesRegex(ValueError, "Начать"):
            validate_stories([s])


if __name__ == "__main__":
    unittest.main()
