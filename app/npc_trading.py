"""Author-controlled NPC requests and native loot-backed reward choices."""

import copy
import json
import re
from pathlib import Path

from rewards import integer, item

CATALOG = json.loads((Path(__file__).parent / "web/npc-catalog.json").read_text(encoding="utf-8"))
CHOICES = {v["key"]: v for v in CATALOG["rewards"]}


def upgrade_npc(r):
    if isinstance(r, dict):
        r.setdefault("trade_mode", "food")
        r.setdefault("npc_trade", copy.deepcopy(CATALOG["defaults"]))


def validate_npc(r, strict=False):
    if r["trade_mode"] not in ["food", "npc"]:
        raise ValueError("Неизвестный режим обмена")
    n = r["npc_trade"]
    if not isinstance(n, dict) or set(n) != {"refresh_seconds", "max_uses", "requests", "rewards"}:
        raise ValueError("Неверные настройки торговли NPC")
    integer(n["refresh_seconds"], 30, 86400, "Обновление запроса NPC")
    integer(n["max_uses"], 1, 64, "Число сделок NPC")
    for key in ["requests", "rewards"]:
        rows = n[key]
        if not isinstance(rows, list) or len(rows) > 16:
            raise ValueError("NPC: не более 16 запросов и 16 наград")
        if strict and r["trade_mode"] == "npc" and not rows:
            raise ValueError("NPC: добавьте хотя бы один запрос и одну награду")
        ids = set()
        values = set()
        for row in rows:
            if (
                not isinstance(row, dict)
                or not re.fullmatch(r"[a-z0-9_]{1,40}", row.get("id", ""))
                or row["id"] in ids
            ):
                raise ValueError("NPC: неверный ID строки")
            ids.add(row["id"])
            if key == "requests":
                if set(row) != {"id", "item", "min", "max"}:
                    raise ValueError("NPC: неверная строка запроса")
                item(row["item"])
                integer(row["min"], 1, 64, "NPC: минимум предметов")
                integer(row["max"], row["min"], 64, "NPC: максимум предметов")
                value = row["item"]
            else:
                if set(row) != {"id", "choice", "count"} or row["choice"] not in CHOICES:
                    raise ValueError("NPC: выберите награду из каталога")
                integer(
                    row["count"], 1, CHOICES[row["choice"]]["max_count"], "Количество награды NPC"
                )
                value = row["choice"]
            if value in values:
                raise ValueError(
                    "NPC: одинаковые предметы или награды не должны повторяться в списке"
                )
            values.add(value)


def add_npc_loot(p, files, resource):
    r = p["rewards"]
    if r["trade_mode"] != "npc":
        return []
    validate_npc(r, strict=True)
    definitions = []
    for reward in r["npc_trade"]["rewards"]:
        spec = copy.deepcopy(CHOICES[reward["choice"]])
        path = "npc/" + resource + "/" + reward["id"]
        functions = [{"function": "set_count", "count": reward["count"]}] + spec.get(
            "functions", []
        )
        files["Monster_BP/loot_tables/" + path + ".json"] = {
            "pools": [
                {
                    "rolls": 1,
                    "entries": [
                        {"type": "item", "name": spec["item"], "weight": 1, "functions": functions}
                    ],
                }
            ]
        }
        definitions.append(
            dict(
                id=reward["id"],
                label=spec["label"],
                item=spec["item"],
                count=reward["count"],
                loot_table=path,
                **{k: spec[k] for k in ["potion", "enchantment", "level"] if k in spec},
            )
        )
    return definitions
