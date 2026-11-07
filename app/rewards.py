"""Validation and native Bedrock death rewards."""

import re

FOODS = {
    "minecraft:" + x
    for x in [
        "apple",
        "bread",
        "carrot",
        "baked_potato",
        "cooked_beef",
        "cooked_chicken",
        "cooked_porkchop",
        "cooked_mutton",
        "cookie",
        "pumpkin_pie",
        "sweet_berries",
        "dried_kelp",
    ]
}


def integer(v, lo, hi, label):
    if type(v) is not int or not lo <= v <= hi:
        raise ValueError(f"{label}: целое число {lo}–{hi}")


def item(v):
    if not isinstance(v, str) or not re.fullmatch(r"[a-z0-9_.-]{1,40}:[a-z0-9_./-]{1,80}", v):
        raise ValueError("Неверный ID предмета: например minecraft:diamond")


def validate_rewards(r):
    if not isinstance(r, dict) or set(r) != {
        "experience",
        "death",
        "timed",
        "trades",
        "trade_mode",
        "npc_trade",
    }:
        raise ValueError("Неверные настройки добычи")
    integer(r["experience"], 0, 10000, "Опыт")
    for kind in ["death", "timed", "trades"]:
        rows = r[kind]
        if not isinstance(rows, list) or len(rows) > 16:
            raise ValueError("Не более 16 правил в каждом разделе добычи")
        ids = set()
        for row in rows:
            if (
                not isinstance(row, dict)
                or not re.fullmatch(r"[a-zA-Z0-9_]{1,40}", row.get("id", ""))
                or row["id"] in ids
            ):
                raise ValueError("Неверный ID правила добычи")
            ids.add(row["id"])
            item(row.get("item"))
            if kind == "trades":
                if row.get("food") not in FOODS:
                    raise ValueError("Выберите еду из списка")
                integer(row.get("food_count"), 1, 64, "Количество еды")
                integer(row.get("count"), 1, 64, "Количество награды")
                integer(row.get("cooldown"), 0, 86400, "Пауза обмена")
            else:
                integer(row.get("min"), 1, 64, "Минимальное количество")
                integer(row.get("max"), row["min"], 64, "Максимальное количество")
                integer(row.get("chance"), 0, 100, "Вероятность")
                if kind == "timed":
                    integer(row.get("seconds"), 1, 86400, "Интервал выпадения")


def add_death_rewards(p, entity, files, resource):
    r = p["rewards"]
    c = entity["components"]
    if r["experience"]:
        c["minecraft:experience_reward"] = {
            "on_death": f"query.last_hit_by_player ? {r['experience']} : 0"
        }
    if r["death"]:
        path = "loot_tables/entities/" + resource + ".json"
        c["minecraft:loot"] = {"table": path}
        files["Monster_BP/" + path] = {
            "pools": [
                {
                    "rolls": 1,
                    "conditions": [{"condition": "random_chance", "chance": row["chance"] / 100}],
                    "entries": [
                        {
                            "type": "item",
                            "name": row["item"],
                            "weight": 1,
                            "functions": [
                                {
                                    "function": "set_count",
                                    "count": {"min": row["min"], "max": row["max"]},
                                }
                            ],
                        }
                    ],
                }
                for row in r["death"]
            ]
        }
