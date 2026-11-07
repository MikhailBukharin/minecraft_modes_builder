"""Validation and Bedrock components for graph-based interactions."""

import math
import re

from npc_trading import upgrade_npc, validate_npc
from population import defaults as population_defaults
from population import validate_population
from rewards import validate_rewards
from texture_tools import upgrade_palette, validate_palette

EXTRA_DEFAULTS = dict(
    knockback=0,
    detection=16,
    attack_cooldown=1,
    fire_immune=False,
    gravity=True,
    pushable=True,
    can_jump=True,
    material="entity_alphatest",
    animate_legs=False,
    interactions=False,
    stories=[],
    parameter_layout={},
    rewards={"experience": 0, "death": [], "timed": [], "trades": []},
)
BIOMES = {
    "forest": "Лес",
    "plains": "Равнина",
    "desert": "Пустыня",
    "taiga": "Тайга",
    "jungle": "Джунгли",
    "swamp": "Болото",
    "mountain": "Горы",
}
BRANCHES = {"trade", "move", "has_item", "chance"}
LANDMARKS = {"campfire", "bell", "chest", "crafting_table"}
EFFECTS = {"regeneration", "speed", "resistance", "fire_resistance", "night_vision"}
SOUNDS = {"random.levelup", "random.orb", "note.bell", "random.pop"}
NODE_TYPES = {
    "start",
    "say",
    "random",
    "wait",
    "follow",
    "wander",
    "repeat",
    "dialogue",
    "end",
    "return",
    "trade",
    "move",
    "stop",
    "look",
    "has_item",
    "chance",
    "heal",
    "effect",
    "sound",
    "title",
}


def ports(n):
    t = n["type"]
    return (
        ["body", "next"]
        if t == "repeat"
        else ["choice:" + q["id"] for q in n["data"].get("choices", [])]
        if t == "dialogue"
        else ["yes", "no"]
        if t in BRANCHES
        else []
        if t in ["end", "return"]
        else ["next"]
    )


def validate_action(t, d, strict):
    def integer(key, low, high, label):
        value = d.get(key)
        number(value, low, high, label)
        if type(value) is not int:
            raise ValueError(label + ": нужно целое число")

    if t == "move":
        if d.get("landmark") not in tuple(LANDMARKS):
            raise ValueError("Неизвестный ориентир")
        integer("range", 1, 24, "Радиус поиска")
        number(d.get("seconds"), 1, 60, "Время на путь")
    if t == "has_item":
        if (
            not isinstance(d.get("item"), str)
            or not re.fullmatch(r"[a-z][a-z0-9_]*:[a-z0-9_]+", d["item"])
            or len(d["item"]) > 100
        ):
            raise ValueError("Неверный ID предмета")
        integer("count", 1, 64, "Количество предметов")
    if t == "chance":
        number(d.get("percent"), 0, 100, "Вероятность")
    if t in ["heal", "effect"] and d.get("target") not in ["player", "monster"]:
        raise ValueError("Выберите игрока или монстра")
    if t == "heal":
        number(d.get("amount"), 1, 100, "Лечение HP")
    if t == "effect":
        if d.get("effect") not in tuple(EFFECTS):
            raise ValueError("Неизвестный эффект")
        number(d.get("seconds"), 1, 60, "Длительность эффекта")
        integer("amplifier", 0, 2, "Усиление эффекта")
    if t == "sound":
        if d.get("sound") not in tuple(SOUNDS):
            raise ValueError("Неизвестный звук")
        number(d.get("volume"), 0, 1, "Громкость")
        number(d.get("pitch"), 0.5, 2, "Высота тона")
    if t == "title":
        for key in ["text", "subtitle"]:
            if (
                not isinstance(d.get(key), str)
                or len(d[key]) > 160
                or (strict and key == "text" and not d[key].strip())
            ):
                raise ValueError("Сообщение на экране: до 160 символов, заголовок обязателен")


def upgrade(p):
    import copy

    for k, v in EXTRA_DEFAULTS.items():
        p.setdefault(k, copy.deepcopy(v))
    upgrade_npc(p["rewards"])
    p.setdefault("biomes", [p.get("biome", "forest")])
    p.setdefault("population", population_defaults(p.get("spawn") == "natural"))
    upgrade_palette(p)
    return p


def number(v, low, high, label):
    if type(v) not in (int, float) or not math.isfinite(v) or not low <= v <= high:
        raise ValueError(f"{label}: допустимо {low}–{high}")


def validate_extras(p):
    validate_palette(p)
    validate_rewards(p["rewards"])
    validate_npc(p["rewards"])
    validate_population(p)
    biomes = p["biomes"]
    if (
        not isinstance(biomes, list)
        or len(biomes) > len(BIOMES)
        or any(not isinstance(b, str) or b not in BIOMES for b in biomes)
        or len(set(biomes)) != len(biomes)
    ):
        raise ValueError("Выберите допустимые биомы без повторов")
    if p.get("spawn") == "natural" and not biomes:
        raise ValueError("Для естественного появления нужен хотя бы один биом")
    for k, lo, hi in [("knockback", 0, 1), ("detection", 1, 128), ("attack_cooldown", 0.1, 60)]:
        number(p[k], lo, hi, k)
    for k in ["fire_immune", "gravity", "pushable", "can_jump", "animate_legs", "interactions"]:
        if type(p[k]) is not bool:
            raise ValueError(f"{k}: нужно логическое значение")
    if p["material"] not in ["entity_alphatest", "entity_alphablend"]:
        raise ValueError("Неизвестный материал")
    layout = p["parameter_layout"]
    if not isinstance(layout, dict) or len(layout) > 30:
        raise ValueError("Неверный холст параметров")
    for pos in layout.values():
        if not isinstance(pos, dict):
            raise ValueError("Неверная позиция блока")
        for k in ["x", "y"]:
            number(pos.get(k), 0, 10000, "Позиция блока")
    validate_stories(p["stories"])


def validate_stories(stories, strict=False):
    if not isinstance(stories, list) or len(stories) > 20:
        raise ValueError("Максимум 20 историй")
    sids = set()
    for s in stories:
        if (
            not isinstance(s, dict)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", s.get("id", ""))
            or s["id"] in sids
        ):
            raise ValueError("Неверный ID истории")
        sids.add(s["id"])
        if not isinstance(s.get("name"), str) or not 1 <= len(s["name"].strip()) <= 80:
            raise ValueError("Нужно имя истории")
        nodes = s.get("nodes", [])
        edges = s.get("edges", [])
        if (
            not isinstance(nodes, list)
            or not 1 <= len(nodes) <= 100
            or not isinstance(edges, list)
            or len(edges) > 250
        ):
            raise ValueError("История: до 100 блоков и 250 связей")
        by = {}
        starts = []
        for n in nodes:
            if (
                not isinstance(n, dict)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", n.get("id", ""))
                or n["id"] in by
            ):
                raise ValueError("Неверный ID блока")
            by[n["id"]] = n
            t = n.get("type")
            d = n.get("data", {})
            if not isinstance(t, str) or t not in NODE_TYPES:
                raise ValueError("Неизвестный блок сценария")
            if not isinstance(d, dict):
                raise ValueError("Неверные параметры блока")
            validate_action(t, d, strict)
            if t == "start":
                starts.append(n["id"])
            for k in ["x", "y"]:
                number(n.get(k, 0), 0, 10000, "Позиция блока")
            if t in ["say", "dialogue"]:
                text = d.get("text", "")
                if not isinstance(text, str) or len(text) > 2000 or (strict and not text.strip()):
                    raise ValueError("Заполните текст реплики")
            if t == "random":
                texts = d.get("phrases", [])
                if (
                    not isinstance(texts, list)
                    or len(texts) > 20
                    or any(not isinstance(v, str) or len(v) > 1000 for v in texts)
                    or (strict and (not texts or any(not v.strip() for v in texts)))
                ):
                    raise ValueError("Заполните случайные фразы")
            if t in ["say", "random", "wait", "follow", "wander", "stop"]:
                number(d.get("seconds", 2), 0.1, 120, "Длительность")
            if t == "repeat":
                times = d.get("times", 3)
                if type(times) is not int or not 1 <= times <= 10:
                    raise ValueError("Повтор: от 1 до 10 раз")
            if t == "dialogue":
                choices = d.get("choices", [])
                if not isinstance(choices, list) or not 1 <= len(choices) <= 6:
                    raise ValueError("Диалог: от 1 до 6 ответов")
                ids = set()
                for q in choices:
                    if (
                        not isinstance(q, dict)
                        or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", q.get("id", ""))
                        or q["id"] in ids
                        or not isinstance(q.get("text"), str)
                        or len(q["text"]) > 160
                        or (strict and not q["text"].strip())
                    ):
                        raise ValueError("Неверный ответ диалога")
                    ids.add(q["id"])
        if len(starts) > 1 or (strict and len(starts) != 1):
            raise ValueError("В истории нужен ровно один блок «Начать»")
        outgoing = {}
        adj = {k: [] for k in by}
        for e in edges:
            if not isinstance(e, dict) or e.get("from") not in by or e.get("to") not in by:
                raise ValueError("Связь ссылается на удалённый блок")
            source = by[e["from"]]
            port = e.get("port", "next")
            t = source["type"]
            allowed = ports(source)
            if port not in allowed or by[e["to"]]["type"] == "start":
                raise ValueError("Недопустимое соединение портов")
            key = (e["from"], port)
            if key in outgoing:
                raise ValueError("У выхода блока может быть только одна связь")
            outgoing[key] = e["to"]
            adj[e["from"]].append(e["to"])
        visiting = set()
        done = set()

        def acyclic(k):
            if k in visiting:
                raise ValueError("Циклическая связь: используйте блок «Повтор»")
            if k in done:
                return
            visiting.add(k)
            for v in adj[k]:
                acyclic(v)
            visiting.remove(k)
            done.add(k)

        for k in by:
            acyclic(k)
        if not strict:
            continue
        # Validate every block, including unreachable drafts: nothing silently discarded.
        for n in nodes:
            t = n["type"]
            k = n["id"]
            if any((k, port) not in outgoing for port in ports(n)):
                raise ValueError(f"История «{s['name']}»: соедините все выходы блока {t}")
        reachable = set()

        def walk(k):
            if k in reachable:
                return
            reachable.add(k)
            for v in adj[k]:
                walk(v)

        walk(starts[0])
        if len(reachable) != len(nodes):
            raise ValueError("Есть блоки, не связанные с началом истории")
        terminal_cache = {}

        def terminals(k, depth=0):
            if depth > 8:
                raise ValueError("Максимальная вложенность повторов: 8")
            if (k, depth) in terminal_cache:
                return terminal_cache[k, depth]
            n = by[k]
            t = n["type"]
            if t in ["end", "return"]:
                return {t}
            if t == "repeat":
                if terminals(outgoing[k, "body"], depth + 1) != {"return"}:
                    raise ValueError("Тело повтора должно заканчиваться «Вернуться»")
                result = terminals(outgoing[k, "next"], depth)
                terminal_cache[k, depth] = result
                return result
            result = set()
            for v in adj[k]:
                result |= terminals(v, depth)
            terminal_cache[k, depth] = result
            return result

        if terminals(starts[0]) != {"end"}:
            raise ValueError("Основная история должна заканчиваться «Завершить»")


def script_components(p, entity):
    """Runtime motion is implemented through vanilla goals, not teleportation."""
    c = entity["components"]
    speed = p["speed"]
    c["minecraft:tameable"] = {"probability": 0, "tame_items": []}
    c["minecraft:interact"] = {
        "interactions": [
            {
                "on_interact": {"event": "workshop:touch", "target": "self"},
                "interact_text": "Поговорить",
                "swing": True,
            }
        ]
    }
    entity["component_groups"] = {
        "workshop:default": {
            "minecraft:movement": {"value": speed},
            "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 1},
        },
        "workshop:wait": {"minecraft:movement": {"value": 0}},
        "workshop:follow": {
            "minecraft:movement": {"value": speed},
            "minecraft:behavior.follow_owner": {
                "priority": 0,
                "speed_multiplier": 1.2,
                "start_distance": 3,
                "stop_distance": 2,
                "can_teleport": False,
            },
        },
        "workshop:wander": {
            "minecraft:movement": {"value": speed},
            "minecraft:behavior.random_stroll": {"priority": 0, "speed_multiplier": 1},
        },
    }
    entity["events"] = {"workshop:touch": {}}
    moves = {
        (n["data"]["landmark"], n["data"]["range"])
        for s in p["stories"]
        for n in s["nodes"]
        if n["type"] == "move"
    }
    if moves:
        entity["description"].setdefault("properties", {})["workshop:arrived"] = {
            "type": "bool",
            "default": False,
        }
        entity["events"]["workshop:arrived"] = {"set_property": {"workshop:arrived": True}}
        for landmark, search_range in sorted(moves):
            entity["component_groups"][f"workshop:move_{landmark}_{search_range}"] = {
                "minecraft:movement": {"value": speed},
                "minecraft:behavior.move_to_block": {
                    "priority": 0,
                    "control_flags": ["move", "look"],
                    "speed_multiplier": 1,
                    "search_range": search_range,
                    "search_height": 4,
                    "goal_radius": 2,
                    "start_chance": 1,
                    "tick_interval": 1,
                    "stay_duration": 1200,
                    "target_blocks": ["minecraft:" + landmark],
                    "target_selection_method": "nearest",
                    "on_reach": [{"event": "workshop:arrived", "target": "self"}],
                },
            }
    groups = list(entity["component_groups"])
    for group in groups:
        event = {"remove": {"component_groups": groups}, "add": {"component_groups": [group]}}
        if moves:
            event["set_property"] = {"workshop:arrived": False}
        entity["events"][group] = event
