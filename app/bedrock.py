"""Local Bedrock Add-On authoring. Python standard library only."""

import base64
import copy
import io
import json
import math
import re
import struct
import uuid
import zipfile
import zlib
from pathlib import Path

from npc_trading import add_npc_loot
from population import spawn_rules
from rewards import add_death_rewards
from stories import number, script_components, upgrade, validate_extras, validate_stories
from texture_tools import project_texture


def default_project():
    return upgrade(
        dict(
            id=str(uuid.uuid4()),
            name="Лесной глазастик",
            namespace="my_monsters",
            slug="forest_eye",
            description="Любопытный обитатель леса с большими глазами.",
            health=30,
            damage=4,
            speed=0.22,
            behavior="neutral",
            spawn="manual",
            biome="forest",
            color="#598b56",
            accent="#d5b95f",
            shape="biped",
            scale=1,
            horns=True,
            width=0.8,
            height=1.8,
            engine=[1, 26, 60],
            version=0,
            pack_ids=[str(uuid.uuid4()) for _ in range(4)],
        )
    )


def validate(p):
    if not isinstance(p, dict):
        raise ValueError("Проект должен быть объектом")
    upgrade(p)
    validate_extras(p)
    p["id"] = str(uuid.UUID(p["id"]))
    for key in ("namespace", "slug"):
        if not re.fullmatch(r"[a-z][a-z0-9_]{1,39}", p.get(key, "")):
            raise ValueError(f"{key}: латиница, цифры и _, от 2 до 40 символов")
    if p["namespace"] == "minecraft":
        raise ValueError("Используйте собственное пространство имён")
    for key, limit in [("name", 80), ("description", 2000)]:
        if not isinstance(p.get(key), str) or not p[key].strip() or len(p[key]) > limit:
            raise ValueError(f"Проверьте поле {key}")
    if "\n" in p["name"] or "\r" in p["name"]:
        raise ValueError("Имя должно занимать одну строку")
    for key, low, high in [
        ("health", 1, 1000),
        ("damage", 0, 100),
        ("speed", 0.01, 1),
        ("scale", 0.25, 3),
        ("width", 0.2, 5),
        ("height", 0.2, 8),
    ]:
        v = p.get(key)
        if (
            isinstance(v, bool)
            or not isinstance(v, (int, float))
            or not math.isfinite(v)
            or not low <= v <= high
        ):
            raise ValueError(f"{key}: допустимо {low}–{high}")
    for key, values in [
        ("shape", ["biped", "quadruped"]),
        ("behavior", ["peaceful", "neutral", "hostile"]),
        ("spawn", ["manual", "natural"]),
    ]:
        if p.get(key) not in values:
            raise ValueError(f"Неизвестное значение {key}")
    for key in ("color", "accent"):
        if not re.fullmatch("#[0-9a-fA-F]{6}", p.get(key, "")):
            raise ValueError("Неверный цвет")
    if not isinstance(p.get("horns"), bool):
        raise ValueError("Неверное значение horns")
    engine = p.get("engine")
    if (
        not isinstance(engine, list)
        or len(engine) != 3
        or any(type(v) is not int or not 0 <= v <= 999 for v in engine)
        or engine < [1, 21, 0]
    ):
        raise ValueError("Минимальная версия Bedrock: 1.21.0")
    if type(p.get("version")) is not int or not 0 <= p["version"] < 100000:
        raise ValueError("Неверная версия проекта")
    ids = p.get("pack_ids", [])
    if not isinstance(ids, list) or len(ids) != 4:
        raise ValueError("Неверные UUID пакетов")
    p["pack_ids"] = [str(uuid.UUID(v)) for v in ids]
    if len(set(p["pack_ids"])) != 4:
        raise ValueError("UUID пакетов должны различаться")
    for key in ("drawing", "texture"):
        if p.get(key):
            image_bytes(p[key])
    if p.get("geometry"):
        validate_geometry(p["geometry"])
    return p


def image_bytes(data):
    if not isinstance(data, str) or len(data) > 12_000_000:
        raise ValueError("Слишком большое изображение")
    try:
        raw = base64.b64decode(data.split(",", 1)[-1], validate=True)
    except Exception:
        raise ValueError("Некорректное изображение")
    if raw[:8] != b"\x89PNG\r\n\x1a\n" or len(raw) < 33:
        raise ValueError("Нужен PNG (рисунок можно загрузить как JPG через интерфейс)")
    w, h = struct.unpack(">II", raw[16:24])
    if not 1 <= w <= 2048 or not 1 <= h <= 2048:
        raise ValueError("Изображение не более 2048×2048")
    return raw


def validate_geometry(g):
    if not isinstance(g, dict) or g.get("format_version") != "1.12.0":
        raise ValueError("Нужна Bedrock-геометрия 1.12.0")
    gs = g.get("minecraft:geometry", [])
    if len(gs) != 1:
        raise ValueError("Импортируйте ровно одну геометрию")
    bones = gs[0].get("bones", [])
    if not 1 <= len(bones) <= 256:
        raise ValueError("Допустимо 1–256 костей")
    names = [b.get("name") for b in bones]
    if any(
        not isinstance(n, str) or not re.fullmatch("[A-Za-z0-9_]{1,80}", n) for n in names
    ) or len(set(names)) != len(names):
        raise ValueError("Неверные или повторяющиеся имена костей")
    if sum(len(b.get("cubes", [])) for b in bones) > 2000:
        raise ValueError("Максимум 2000 кубов")
    parents = {b["name"]: b.get("parent") for b in bones}
    for b in bones:
        seen = set()
        n = b["name"]
        while n is not None:
            if n in seen or n not in parents:
                raise ValueError("Ошибка иерархии костей")
            seen.add(n)
            n = parents[n]
        for obj, keys in [(b, ["pivot", "rotation"])] + [
            (cube, ["origin", "size", "pivot", "rotation"]) for cube in b.get("cubes", [])
        ]:
            for key in keys:
                v = obj.get(key)
                if v is not None and (
                    not isinstance(v, list)
                    or len(v) != 3
                    or any(
                        type(a) not in (int, float) or not math.isfinite(a) or abs(a) > 1024
                        for a in v
                    )
                ):
                    raise ValueError(f"Неверный вектор {key}")
        for cube in b.get("cubes", []):
            if not all(k in cube for k in ("origin", "size", "uv")) or any(
                v <= 0 for v in cube["size"]
            ):
                raise ValueError("Куб должен иметь origin, size, uv")
            if "inflate" in cube:
                number(cube["inflate"], -32, 32, "Inflate")
                if any(v + 2 * cube["inflate"] <= 0 for v in cube["size"]):
                    raise ValueError("Inflate делает куб пустым")
            for key in ["mirror"]:
                if key in cube and type(cube[key]) is not bool:
                    raise ValueError("Mirror: нужно логическое значение")
            uv = cube["uv"]

            def uv_vec(v):
                if not isinstance(v, list) or len(v) != 2:
                    raise ValueError("UV: нужны два числа")
                for a in v:
                    number(a, -8192, 8192, "UV")

            if isinstance(uv, list):
                uv_vec(uv)
            elif isinstance(uv, dict):
                for face, face_uv in uv.items():
                    if face not in [
                        "north",
                        "south",
                        "east",
                        "west",
                        "up",
                        "down",
                    ] or not isinstance(face_uv, dict):
                        raise ValueError("Неизвестная грань UV")
                    uv_vec(face_uv.get("uv"))
                    if "uv_size" in face_uv:
                        uv_vec(face_uv["uv_size"])
            else:
                raise ValueError("Неверная UV-развёртка")
    d = gs[0].get("description", {})
    for k in ("texture_width", "texture_height"):
        if type(d.get(k)) is not int or not 1 <= d[k] <= 2048:
            raise ValueError("Неверные размеры текстуры в геометрии")
    for k in ["visible_bounds_width", "visible_bounds_height"]:
        if k in d:
            number(d[k], 0.1, 128, k)
    if "visible_bounds_offset" in d:
        if not isinstance(d["visible_bounds_offset"], list) or len(d["visible_bounds_offset"]) != 3:
            raise ValueError("Неверный visible_bounds_offset")
        for v in d["visible_bounds_offset"]:
            number(v, -1024, 1024, "visible_bounds_offset")
    return g


def png(color, accent):
    colors = [bytes.fromhex(color[1:]), bytes.fromhex(accent[1:]), b"\x16\x23\x2b", b"\xf2\xf6\xe8"]
    raw = b"".join(b"\0" + b"".join(colors[min(x // 16, 3)] for x in range(64)) for y in range(64))

    def chunk(k, v):
        return struct.pack(">I", len(v)) + k + v + struct.pack(">I", zlib.crc32(k + v) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def geometry(p):
    if p.get("geometry"):
        return copy.deepcopy(p["geometry"])
    bones = []

    def bone(name, pivot, cubes, parent="root"):
        bones.append(
            dict(
                name=name,
                pivot=pivot,
                cubes=[
                    dict(
                        origin=o,
                        size=s,
                        uv={
                            f: dict(uv=[tile * 16, 0], uv_size=[8, 8])
                            for f in ["north", "south", "east", "west", "up", "down"]
                        },
                    )
                    for o, s, tile in cubes
                ],
                **({"parent": parent} if parent else {}),
            )
        )

    bone("root", [0, 0, 0], [], None)
    quad = p["shape"] == "quadruped"
    bone(
        "body",
        [0, 10, 0],
        [([-5, 8, -7] if quad else [-4, 10, -3], [10, 7, 14] if quad else [8, 10, 6], 0)],
    )
    head_y = 15 if quad else 20
    head_z = -8 if quad else 0
    head = [
        ([-5, head_y, head_z - 4], [10, 8, 8], 0),
        ([-3.8, head_y + 3, head_z - 4.3], [3, 3, 0.4], 3),
        ([0.8, head_y + 3, head_z - 4.3], [3, 3, 0.4], 3),
        ([-2.8, head_y + 3.5, head_z - 4.6], [1.5, 2, 0.4], 2),
        ([1.3, head_y + 3.5, head_z - 4.6], [1.5, 2, 0.4], 2),
    ]
    if p["horns"]:
        head += [([-4, head_y + 8, head_z], [2, 5, 2], 1), ([2, head_y + 8, head_z], [2, 5, 2], 1)]
    bone("head", [0, head_y, head_z], head)
    for side, x in [("left", 2), ("right", -5)]:
        if quad:
            for pos, z in [("front", -5), ("back", 3)]:
                bone("leg_" + side + "_" + pos, [x + 1.5, 8, z + 1.5], [([x, 0, z], [3, 8, 3], 1)])
        else:
            bone("leg_" + side, [x + 1.5, 10, 0], [([x, 0, -2], [3, 10, 4], 1)])
            bone(
                "arm_" + side,
                [6 if side == "left" else -6, 19, 0],
                [([4 if side == "left" else -7, 10, -2], [3, 9, 4], 0)],
            )
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [
            dict(
                description=dict(
                    identifier="geometry.workshop.monster",
                    texture_width=64,
                    texture_height=64,
                    visible_bounds_width=6,
                    visible_bounds_height=6,
                    visible_bounds_offset=[0, 1.5, 0],
                ),
                bones=bones,
            )
        ],
    }


def assets(p):
    validate(p)
    ident = p["namespace"] + ":" + p["slug"]
    g = geometry(p)
    resource = p["namespace"] + "/" + p["slug"]
    key = p["namespace"] + "." + p["slug"]
    g["minecraft:geometry"][0]["description"]["identifier"] = "geometry." + key
    tex = project_texture(p, png)
    dims = struct.unpack(">II", tex[16:24])
    d = g["minecraft:geometry"][0]["description"]
    if dims != (d["texture_width"], d["texture_height"]):
        raise ValueError("Размер PNG должен совпадать с texture_width/height геометрии")
    # Imported geometry is never assigned template animation tracks.
    tracks = (
        {
            b["name"]: {"rotation": ["math.sin(query.anim_time * 360) * 25", 0, 0]}
            for b in g["minecraft:geometry"][0]["bones"]
            if b["name"].startswith("leg_")
        }
        if not p.get("geometry") or p["animate_legs"]
        else {}
    )
    for n, t in tracks.items():
        if "right" in n:
            t["rotation"][0] = "-" + t["rotation"][0]
    animations = {
        "format_version": "1.8.0",
        "animations": {
            "animation." + key + ".walk": dict(loop=True, animation_length=1, bones=tracks)
        },
    }
    components = {
        "minecraft:type_family": {"family": ["workshop_monster", "mob"]},
        "minecraft:health": dict(value=p["health"], max=p["health"]),
        "minecraft:collision_box": dict(
            width=p["width"] * p["scale"], height=p["height"] * p["scale"]
        ),
        "minecraft:scale": {"value": p["scale"]},
        "minecraft:movement": {"value": p["speed"]},
        "minecraft:movement.basic": {},
        "minecraft:navigation.walk": {
            "can_path_over_water": True,
            "avoid_water": True,
            "can_jump": p["can_jump"],
        },
        "minecraft:physics": {"has_gravity": p["gravity"]},
        "minecraft:pushable": dict(is_pushable=p["pushable"], is_pushable_by_piston=p["pushable"]),
        "minecraft:behavior.float": {"priority": 0},
        "minecraft:behavior.random_stroll": dict(priority=6, speed_multiplier=1),
        "minecraft:behavior.look_at_player": dict(priority=7, look_distance=8),
        "minecraft:behavior.random_look_around": {"priority": 8},
    }
    if p["can_jump"]:
        components["minecraft:jump.static"] = {}
    if p["fire_immune"]:
        components["minecraft:fire_immune"] = {}
    components["minecraft:knockback_resistance"] = {"value": p["knockback"]}
    components["minecraft:follow_range"] = {"value": p["detection"]}
    if p["behavior"] != "peaceful":
        components.update(
            {
                "minecraft:attack": {"damage": p["damage"]},
                "minecraft:behavior.hurt_by_target": {"priority": 1},
                "minecraft:behavior.melee_attack": dict(
                    priority=3,
                    speed_multiplier=1.2,
                    track_target=True,
                    cooldown_time=p["attack_cooldown"],
                ),
            }
        )
    if p["behavior"] == "hostile":
        components["minecraft:behavior.nearest_attackable_target"] = dict(
            priority=2,
            must_see=True,
            entity_types=[
                dict(
                    filters=dict(test="is_family", subject="other", value="player"),
                    max_dist=p["detection"],
                )
            ],
        )
    bp = {
        "format_version": "1.21.0",
        "minecraft:entity": dict(
            description=dict(
                identifier=ident, is_spawnable=True, is_summonable=True, is_experimental=False
            ),
            components=components,
        ),
    }
    client = {
        "format_version": "1.10.0",
        "minecraft:client_entity": {
            "description": dict(
                identifier=ident,
                materials={"default": "entity_alphatest"},
                textures={"default": "textures/entity/" + resource},
                geometry={"default": d["identifier"]},
                animations={"walk": "animation." + key + ".walk"},
                scripts={"animate": [{"walk": "query.modified_move_speed > 0.01"}]},
                render_controllers=["controller.render." + key],
                spawn_egg={"base_color": p["color"], "overlay_color": p["accent"]},
            )
        },
    }
    client["minecraft:client_entity"]["description"]["materials"]["default"] = p["material"]
    renderer = {
        "format_version": "1.8.0",
        "render_controllers": {
            "controller.render." + key: dict(
                geometry="Geometry.default",
                materials=[{"*": "Material.default"}],
                textures=["Texture.default"],
            )
        },
    }
    version = [1, 0, p["version"] + 1]
    ids = p["pack_ids"]

    def manifest(name, typ, a, b):
        return dict(
            format_version=2,
            header=dict(
                name=name,
                description=p["description"],
                uuid=a,
                version=version,
                min_engine_version=p["engine"],
            ),
            modules=[dict(type=typ, uuid=b, version=version)],
        )

    bm = manifest(p["name"] + " · Поведение", "data", ids[0], ids[1])
    bm["dependencies"] = [dict(uuid=ids[2], version=version)]
    rm = manifest(p["name"] + " · Ресурсы", "resources", ids[2], ids[3])
    npc = p["rewards"]["trade_mode"] == "npc"
    scripted = (
        p["interactions"]
        or bool(p["stories"])
        or bool(p["rewards"]["timed"])
        or (npc or bool(p["rewards"]["trades"]))
        or p["population"]["guard"]
    )
    if scripted:
        if p["engine"] < [1, 26, 60]:
            raise ValueError("Сценарии мастерской рассчитаны на Bedrock 26.60 и новее")
        validate_stories(p["stories"], strict=True)
        script_components(p, bp["minecraft:entity"])
        bm["modules"].append(
            dict(
                type="script",
                language="javascript",
                uuid=str(uuid.uuid5(uuid.UUID(p["id"]), "story-runtime")),
                version=version,
                entry="scripts/main.js",
            )
        )
        bm["dependencies"] += [
            dict(module_name="@minecraft/server", version="2.4.0" if npc else "2.0.0"),
            dict(module_name="@minecraft/server-ui", version="2.0.0"),
        ]
    files = {
        "Monster_BP/manifest.json": bm,
        "Monster_RP/manifest.json": rm,
        f"Monster_BP/entities/{resource}.json": bp,
        f"Monster_RP/entity/{resource}.entity.json": client,
        f"Monster_RP/models/entity/{resource}.geo.json": g,
        f"Monster_RP/render_controllers/{resource}.json": renderer,
        f"Monster_RP/animations/{resource}.json": animations,
    }
    add_death_rewards(p, bp["minecraft:entity"], files, resource)
    npc_rewards = add_npc_loot(p, files, resource)
    if p["spawn"] == "natural":
        files["Monster_BP/spawn_rules/monster.spawn_rules.json"] = spawn_rules(p, ident)
    result = {k: json.dumps(v, ensure_ascii=False, indent=2).encode() for k, v in files.items()}
    if scripted:
        here = Path(__file__).resolve().parent
        result["Monster_BP/scripts/main.js"] = (here / "runtime.js").read_bytes()
        result["Monster_BP/scripts/story-runner.js"] = (here / "web/story-runner.js").read_bytes()
        result["Monster_BP/scripts/story-actions.js"] = (here / "web/story-actions.js").read_bytes()
        result["Monster_BP/scripts/economy.js"] = (here / "web/economy.js").read_bytes()
        result["Monster_BP/scripts/items.js"] = (here / "web/items.js").read_bytes()
        result["Monster_BP/scripts/population-guard.js"] = (
            here / "web/population-guard.js"
        ).read_bytes()
        result["Monster_BP/scripts/population-runtime.js"] = (
            here / "population-runtime.js"
        ).read_bytes()
        result["Monster_BP/scripts/npc-trade.js"] = (here / "web/npc-trade.js").read_bytes()
        result["Monster_BP/scripts/npc-trade-runtime.js"] = (
            here / "npc-trade-runtime.js"
        ).read_bytes()
        config = dict(
            identifier=ident,
            name=p["name"],
            description=p["description"],
            stories=p["stories"],
            interactions=p["interactions"],
            rewards=p["rewards"],
            population=p["population"],
            npc_rewards=npc_rewards,
        )
        result["Monster_BP/scripts/config.js"] = (
            "export const config = " + json.dumps(config, ensure_ascii=False) + ";\n"
        ).encode()
    result["Monster_RP/textures/entity/" + resource + ".png"] = tex
    for lang in ("ru_RU", "en_US"):
        result[f"Monster_RP/texts/{lang}.lang"] = (
            f"entity.{ident}.name={p['name']}\nitem.spawn_egg.entity.{ident}.name={p['name']}\n".encode()
        )
    result["Monster_RP/texts/languages.json"] = b'["en_US", "ru_RU"]'
    return result


def archive(p):
    out = io.BytesIO()
    files = assets(p)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for folder in ("Monster_BP", "Monster_RP"):
            pack = io.BytesIO()
            with zipfile.ZipFile(pack, "w", zipfile.ZIP_DEFLATED) as inner:
                for name, data in files.items():
                    if name.startswith(folder + "/"):
                        inner.writestr(name[len(folder) + 1 :], data)
            z.writestr(folder + ".mcpack", pack.getvalue())
    return out.getvalue()
