"""Native spawn rules, opt-in admission limits and workload guidance."""

from rewards import integer


def defaults(natural=False):
    return dict(
        weight=10,
        herd_min=1,
        herd_max=2,
        native_density=4,
        guard=natural,
        area_size=64,
        area_max=4,
        period_seconds=60,
        period_max=2,
        loaded_max=20,
    )


def validate_population(p):
    s = p["population"]
    if not isinstance(s, dict) or set(s) != set(defaults()):
        raise ValueError("Неверные настройки появления")
    for key, lo, hi in [
        ("weight", 1, 100),
        ("herd_min", 1, 8),
        ("herd_max", 1, 8),
        ("native_density", 1, 64),
        ("area_max", 1, 64),
        ("period_seconds", 5, 3600),
        ("period_max", 1, 16),
        ("loaded_max", 1, 200),
    ]:
        integer(s.get(key), lo, hi, key)
    if type(s["guard"]) is not bool:
        raise ValueError("Строгие лимиты: нужно логическое значение")
    if type(s["area_size"]) is not int or s["area_size"] not in [32, 64, 128, 256]:
        raise ValueError("Размер ячейки: 32, 64, 128 или 256 блоков")
    if s["herd_min"] > s["herd_max"]:
        raise ValueError("Минимум группы не должен превышать максимум")
    if s["herd_max"] > s["native_density"]:
        raise ValueError("Группа не должна превышать штатный лимит плотности")
    if s["area_max"] > s["loaded_max"]:
        raise ValueError("Лимит ячейки не должен превышать общий лимит")


def spawn_rules(p, identifier):
    s = p["population"]
    return {
        "format_version": "1.8.0",
        "minecraft:spawn_rules": dict(
            description=dict(
                identifier=identifier,
                population_control="monster" if p["behavior"] == "hostile" else "animal",
            ),
            conditions=[
                {
                    "minecraft:spawns_on_surface": {},
                    "minecraft:brightness_filter": dict(min=7, max=15, adjust_for_weather=False),
                    "minecraft:weight": {"default": s["weight"]},
                    "minecraft:herd": dict(min_size=s["herd_min"], max_size=s["herd_max"]),
                    "minecraft:density_limit": dict(surface=s["native_density"], underground=0),
                    "minecraft:biome_filter": {
                        "any_of": [
                            dict(test="has_biome_tag", operator="==", value=b) for b in p["biomes"]
                        ]
                    },
                }
            ],
        ),
    }


def guardrail_report(p, g):
    model = g["minecraft:geometry"][0]
    bones = model["bones"]
    cubes = sum(len(b.get("cubes", [])) for b in bones)
    d = model["description"]
    s = p["population"]
    warnings = []
    if not s["guard"]:
        warnings.append(
            "Строгие лимиты выключены. Штатная плотность не ограничивает яйца и команды и не задаёт общий предел для всех загруженных областей."
        )
    if cubes > 150 or len(bones) > 32:
        warnings.append(
            "Для часто встречающегося моба начните с 30–100 кубов и 8–24 костей; упростите модель или уменьшите число одновременно видимых монстров."
        )
    if d["texture_width"] * d["texture_height"] > 256 * 256:
        warnings.append(
            "Проверьте, можно ли уменьшить текстуру до 256×256 или меньше без потери нужных деталей."
        )
    if p["detection"] > 32:
        warnings.append(
            "Дальность обнаружения выше 32 блоков увеличивает работу AI. Для первого теста используйте 16–24 блока."
        )
    if p["material"] == "entity_alphablend":
        warnings.append(
            "Полупрозрачные поверхности требуют дополнительной отрисовки. Используйте вырезание прозрачности, если это подходит рисунку."
        )
    per_monster = sum(60 / r["seconds"] * r["max"] for r in p["rewards"]["timed"])
    if per_monster > 2:
        warnings.append(
            "Регулярная добыча превышает 2 предмета в минуту на монстра при удачных проверках. Увеличьте интервал или уменьшите количество."
        )
    if p["rewards"]["trade_mode"] == "food" and any(
        r["cooldown"] == 0 for r in p["rewards"]["trades"]
    ):
        warnings.append(
            "Обмен без паузы допускает очень частую выдачу наград. Для начала поставьте паузу 5–30 секунд."
        )
    if p["rewards"]["trade_mode"] == "npc" and p["rewards"]["npc_trade"]["refresh_seconds"] < 300:
        warnings.append(
            "Запросы NPC обновляются чаще пяти минут. Проверьте баланс редких наград и число доступных сделок."
        )
    if s["loaded_max"] > 40:
        warnings.append(
            "Общий порог выше 40. Сначала проверьте 10–20 мобов на самом слабом устройстве игроков."
        )
    return dict(
        bones=len(bones),
        cubes=cubes,
        texture=[d["texture_width"], d["texture_height"]],
        projected_cubes=cubes * s["loaded_max"],
        timed_items_per_minute=round(per_monster, 2),
        loaded_timed_items_per_minute=round(per_monster * s["loaded_max"], 2),
        warnings=warnings,
    )
