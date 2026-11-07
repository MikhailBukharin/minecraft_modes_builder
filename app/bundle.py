"""Compose workshop exports into ONE behavior pack and ONE resource pack.

Archives are read in memory, never extracted or executed. Script code is regenerated
from the current workshop runtime and the validated, declarative source config.
"""

import base64
import copy
import hashlib
import io
import json
import re
import uuid
import zipfile
from pathlib import Path, PurePosixPath

from bedrock import assets, validate_geometry
from npc_trading import add_npc_loot, validate_npc
from storage import write_bytes, write_json
from stories import script_components, upgrade, validate_extras, validate_stories

HERE = Path(__file__).resolve().parent
IDENT = re.compile(r"[a-z][a-z0-9_]{1,39}:[a-z][a-z0-9_]{1,39}")
MAX_BYTES = 64 * 1024 * 1024
SCRIPT_FILES = {
    "main.js": "runtime.js",
    "story-runner.js": "web/story-runner.js",
    "story-actions.js": "web/story-actions.js",
    "economy.js": "web/economy.js",
    "items.js": "web/items.js",
    "population-guard.js": "web/population-guard.js",
    "population-runtime.js": "population-runtime.js",
    "npc-trade.js": "web/npc-trade.js",
    "npc-trade-runtime.js": "npc-trade-runtime.js",
}


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, indent=2).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def uid(value):
    return str(uuid.UUID(value))


def parse_json(raw):
    def pairs(rows):
        out = {}
        for key, value in rows:
            if key in out:
                raise ValueError("Повторяющийся ключ JSON: " + key)
            out[key] = value
        return out

    return json.loads(
        raw.decode("utf-8-sig"),
        object_pairs_hook=pairs,
        parse_constant=lambda v: (_ for _ in ()).throw(ValueError("Недопустимое число " + v)),
    )


def zip_entries(raw, budget):
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            if len(z.infolist()) > 2000:
                raise ValueError("В архиве слишком много файлов")
            seen = set()
            out = {}
            for info in z.infolist():
                name = info.filename
                path = PurePosixPath(name)
                if (
                    chr(92) in name
                    or path.is_absolute()
                    or ":" in name
                    or ".." in path.parts
                    or str(path) != name.rstrip("/")
                ):
                    raise ValueError("Недопустимый путь в архиве")
                if info.is_dir():
                    continue
                if name.casefold() in seen:
                    raise ValueError("Повторяющийся путь в архиве: " + name)
                seen.add(name.casefold())
                if info.flag_bits & 1:
                    raise ValueError("Зашифрованные архивы не поддерживаются")
                budget[0] += info.file_size
                if info.file_size > 16 * 1024 * 1024 or budget[0] > MAX_BYTES:
                    raise ValueError("Распакованный архив превышает 64 МБ или файл превышает 16 МБ")
                out[name] = z.read(info)
            return out
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as e:
        raise ValueError("Не удалось прочитать ZIP дополнения") from e


def read_addon(raw):
    outer = zip_entries(raw, [0])
    packs = {}
    budget = [0]
    if len(outer) != 2 or any(not name.lower().endswith(".mcpack") for name in outer):
        raise ValueError("Нужен индивидуальный .mcaddon мастерской: один BP и один RP внутри")
    for contents in outer.values():
        files = zip_entries(contents, budget)
        if "manifest.json" not in files:
            raise ValueError("Внутри пакета нет manifest.json")
        m = parse_json(files["manifest.json"])
        types = {v["type"] for v in m.get("modules", [])}
        side = "Monster_BP" if "data" in types else "Monster_RP" if types == {"resources"} else None
        if side is None or side in packs or m.get("format_version") != 2:
            raise ValueError("Неподдерживаемый набор пакетов или версия manifest")
        packs[side] = files
    if set(packs) != {"Monster_BP", "Monster_RP"}:
        raise ValueError("Нужны оба пакета: поведения и ресурсов")
    return {
        side + "/" + name: data for side, files in packs.items() for name, data in files.items()
    }


def inspect_source(files, label):
    """Recognize the individual format and refuse unrelated/partly understood mods."""
    bp = parse_json(files["Monster_BP/manifest.json"])
    rp = parse_json(files["Monster_RP/manifest.json"])
    for m in [bp, rp]:
        if m.get("capabilities") or m.get("format_version") != 2:
            raise ValueError("Особые возможности и другие форматы manifest не объединяются")
        uid(m["header"]["uuid"])
        engine = m["header"]["min_engine_version"]
        if (
            not isinstance(engine, list)
            or len(engine) != 3
            or any(type(v) is not int or v < 0 for v in engine)
        ):
            raise ValueError("Неверная версия движка")
    for dep in bp.get("dependencies", []):
        if "uuid" in dep:
            if dep["uuid"] != rp["header"]["uuid"] or dep["version"] != rp["header"]["version"]:
                raise ValueError("Не разрешена внешняя или несогласованная зависимость пакета")
        elif (dep.get("module_name"), dep.get("version")) not in [
            ("@minecraft/server", "2.0.0"),
            ("@minecraft/server", "2.4.0"),
            ("@minecraft/server-ui", "2.0.0"),
        ]:
            raise ValueError("Неподдерживаемая скриптовая зависимость")
    if rp.get("dependencies"):
        raise ValueError("Внешние зависимости RP не поддерживаются")
    entities = [
        (k, parse_json(v)["minecraft:entity"])
        for k, v in files.items()
        if k.startswith("Monster_BP/entities/") and k.endswith(".json")
    ]
    clients = [
        parse_json(v)["minecraft:client_entity"]["description"]
        for k, v in files.items()
        if k.startswith("Monster_RP/entity/") and k.endswith(".json")
    ]
    if len(entities) != 1 or len(clients) != 1:
        raise ValueError("Импортируйте индивидуальный мод с одним персонажем")
    entity = entities[0][1]
    identifier = entity["description"]["identifier"]
    if not IDENT.fullmatch(identifier) or clients[0]["identifier"] != identifier:
        raise ValueError("ID поведения и визуальной сущности не совпадают")
    ns, slug = identifier.split(":")
    resource = ns + "/" + slug
    key = ns + "." + slug
    geometry_name = f"Monster_RP/models/entity/{resource}.geo.json"
    geo = parse_json(files[geometry_name])
    validate_geometry(geo)
    if geo["minecraft:geometry"][0]["description"]["identifier"] != "geometry." + key:
        raise ValueError("Это не геометрия индивидуального экспорта мастерской")
    expected = [
        f"Monster_RP/textures/entity/{resource}.png",
        f"Monster_RP/animations/{resource}.json",
        f"Monster_RP/render_controllers/{resource}.json",
    ]
    if any(k not in files for k in expected):
        raise ValueError("Не хватает ресурсов персонажа")
    c = entity["components"]
    if "workshop_monster" not in c.get("minecraft:type_family", {}).get("family", []):
        raise ValueError("Поддерживаются индивидуальные экспорты этой мастерской")
    scripted = any(m["type"] == "script" for m in bp["modules"])
    if any(m["type"] not in ["data", "script"] for m in bp["modules"]):
        raise ValueError("Неизвестный модуль пакета поведения")
    if sum(m["type"] == "script" for m in bp["modules"]) > 1:
        raise ValueError("В индивидуальном пакете несколько скриптовых модулей")
    config = None
    if scripted:
        prefix = "export const config = "
        raw = files["Monster_BP/scripts/config.js"].decode()
        if not raw.startswith(prefix) or not raw.rstrip().endswith(";"):
            raise ValueError("Не найден декларативный config мастерской")
        config = json.loads(raw[len(prefix) :].strip()[:-1])
        if config["identifier"] != identifier:
            raise ValueError("ID сценариев не совпадает с сущностью")
        p = upgrade(
            {
                "spawn": "natural" if any("/spawn_rules/" in k for k in files) else "manual",
                **{
                    k: copy.deepcopy(config[k])
                    for k in ["stories", "rewards", "interactions", "population"]
                    if k in config
                },
            }
        )
        validate_extras(p)
        validate_stories(p["stories"], True)
        validate_npc(p["rewards"], True)
        config = {
            **config,
            **{k: p[k] for k in ["stories", "rewards", "interactions", "population"]},
        }
        expected = {"components": {}, "description": {}}
        script_components(
            dict(speed=c["minecraft:movement"]["value"], stories=config["stories"]), expected
        )
        if (
            entity.get("component_groups") != expected["component_groups"]
            or entity.get("events") != expected["events"]
        ):
            raise ValueError(
                "Нестандартные группы поведения или события. Поддерживаются исходные экспорты мастерской."
            )
    elif any(k.startswith("Monster_BP/scripts/") for k in files):
        raise ValueError("Скрипты без модуля manifest не поддерживаются")
    allowed_bp = ("entities/", "loot_tables/", "spawn_rules/", "scripts/")
    allowed_rp = (
        "entity/",
        "models/entity/",
        "textures/entity/",
        "animations/",
        "render_controllers/",
        "texts/",
    )
    for path in files:
        side, relative = path.split("/", 1)
        if relative in ["manifest.json", "pack_icon.png"]:
            continue
        if not relative.startswith(allowed_bp if side == "Monster_BP" else allowed_rp):
            raise ValueError("Не поддерживается содержимое " + path)
        if relative.startswith("scripts/") and relative.split("/", 1)[1] not in set(
            SCRIPT_FILES
        ) | {"config.js"}:
            raise ValueError("Пользовательские скриптовые модули не объединяются")
    bones = geo["minecraft:geometry"][0]["bones"]
    return dict(
        name=label,
        identifier=identifier,
        resource=resource,
        scripted=scripted,
        config=config,
        bones=len(bones),
        cubes=sum(len(b.get("cubes", [])) for b in bones),
        engine=max(bp["header"]["min_engine_version"], rp["header"]["min_engine_version"]),
    )


def load_source(root, selection):
    kind = selection["kind"]
    source_id = uid(selection["id"])
    if kind == "project":
        p = json.loads((root / "projects" / f"{source_id}.json").read_text(encoding="utf-8"))
        files = assets(copy.deepcopy(p))
        label = p["name"]
    elif kind == "import":
        meta = json.loads((root / "imports" / f"{source_id}.json").read_text(encoding="utf-8"))
        files = read_addon((root / "imports" / f"{source_id}.mcaddon").read_bytes())
        label = meta["name"]
    else:
        raise ValueError("Неизвестный источник")
    return files, inspect_source(files, label)


def sources(root):
    out = []
    for kind, folder in [("project", "projects"), ("import", "imports")]:
        for path in sorted((root / folder).glob("*.json")):
            try:
                files, info = load_source(root, dict(kind=kind, id=path.stem))
                out.append(
                    {k: info[k] for k in ["name", "identifier", "bones", "cubes", "scripted"]}
                    | dict(kind=kind, id=path.stem)
                )
            except (ValueError, KeyError, TypeError, OSError):
                # A broken draft remains editable in the workshop, but cannot enter a collection.
                out.append(
                    dict(
                        kind=kind,
                        id=path.stem,
                        name=path.stem,
                        error="Источник не готов к сборке. Проверьте индивидуальный экспорт.",
                    )
                )
    return out


def import_addon(root, name, encoded):
    if not isinstance(name, str) or not name.lower().endswith(".mcaddon") or len(name) > 240:
        raise ValueError("Выберите файл .mcaddon")
    if not isinstance(encoded, str) or len(encoded) > 18 * 1024 * 1024:
        raise ValueError("Файл не более 12 МБ")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except ValueError as e:
        raise ValueError("Неверный файл") from e
    if len(raw) > 12 * 1024 * 1024:
        raise ValueError("Файл не более 12 МБ")
    info = inspect_source(read_addon(raw), name)
    folder = root / "imports"
    folder.mkdir(exist_ok=True)
    source_id = str(uuid.uuid4())
    write_bytes(folder / f"{source_id}.mcaddon", raw)
    write_json(folder / f"{source_id}.json", dict(name=name, sha256=digest(raw)))
    return dict(
        id=source_id,
        kind="import",
        **{k: info[k] for k in ["name", "identifier", "bones", "cubes", "scripted"]},
    )


def new_bundle():
    return dict(
        id=str(uuid.uuid4()), name="Мои монстры и NPC", version=0, loaded_max=40, selection=[]
    )


def validate_settings(settings):
    uid(settings["id"])
    if (
        not isinstance(settings.get("name"), str)
        or not 1 <= len(settings["name"].strip()) <= 80
        or "\n" in settings["name"]
        or "\r" in settings["name"]
    ):
        raise ValueError("Название сборки: 1–80 символов, одна строка")
    if type(settings.get("loaded_max")) is not int or not 1 <= settings["loaded_max"] <= 200:
        raise ValueError("Общий лимит: 1–200 загруженных персонажей")
    if not isinstance(settings.get("selection"), list) or not 2 <= len(settings["selection"]) <= 12:
        raise ValueError("Выберите от 2 до 12 индивидуальных модов")
    seen = set()
    for row in settings["selection"]:
        key = (row["kind"], uid(row["id"]))
        if key in seen:
            raise ValueError("Один источник выбран дважды")
        seen.add(key)
        if (
            not isinstance(row.get("identifier"), str)
            or not IDENT.fullmatch(row["identifier"])
            or row["identifier"].startswith("minecraft:")
        ):
            raise ValueError("ID персонажа: namespace:name, латиница, цифры и _, по 2–40 символов")


def rewrite(value, old, new):
    oldres = old.replace(":", "/")
    newres = new.replace(":", "/")
    oldkey = old.replace(":", ".")
    newkey = new.replace(":", ".")
    pairs = [
        (old, new),
        ("geometry." + oldkey, "geometry." + newkey),
        ("animation." + oldkey, "animation." + newkey),
        ("controller.render." + oldkey, "controller.render." + newkey),
        ("textures/entity/" + oldres, "textures/entity/" + newres),
        ("loot_tables/entities/" + oldres, "loot_tables/entities/" + newres),
        ("npc/" + oldres, "npc/" + newres),
    ]

    def text(s):
        for a, b in pairs:
            if s == a or s.startswith(a + "/") or s.startswith(a + "."):
                return b + s[len(a) :]
        return s

    if isinstance(value, str):
        return text(value)
    if isinstance(value, list):
        return [rewrite(v, old, new) for v in value]
    if isinstance(value, dict):
        return {text(k): rewrite(v, old, new) for k, v in value.items()}
    return value


def source_assets(files, info, new_id):
    old = info["identifier"]
    oldres = info["resource"]
    resource = new_id.replace(":", "/")
    out = {}
    for name, raw in files.items():
        side, rel = name.split("/", 1)
        if rel in ["manifest.json", "pack_icon.png"] or rel.startswith("scripts/"):
            continue
        if rel.startswith("spawn_rules/"):
            rel = "spawn_rules/" + resource + ".json"
        else:
            rel = rel.replace("/" + oldres + "/", "/" + resource + "/").replace(
                "/" + oldres + ".", "/" + resource + "."
            )
        if rel.endswith(".json"):
            raw = json_bytes(rewrite(parse_json(raw), old, new_id))
        elif rel.endswith(".lang"):
            lines = []
            for line in raw.decode("utf-8-sig").splitlines():
                key, sep, value = line.partition("=")
                lines.append(key.replace("." + old + ".", "." + new_id + ".") + sep + value)
            raw = ("\n".join(lines) + "\n").encode()
        out[side + "/" + rel] = raw
    config = rewrite(copy.deepcopy(info["config"]), old, new_id) if info["config"] else None
    if config:
        config["population_key"] = "workshop:rates_" + uuid.uuid5(uuid.NAMESPACE_URL, new_id).hex
        entity_key = next(k for k in out if k.startswith("Monster_BP/entities/"))
        entity_doc = parse_json(out[entity_key])
        entity = entity_doc["minecraft:entity"]
        script_components(
            dict(
                speed=entity["components"]["minecraft:movement"]["value"], stories=config["stories"]
            ),
            entity,
        )
        out[entity_key] = json_bytes(entity_doc)
        # Native NPC loot is rebuilt from validated choices, never from source JavaScript.
        native = {}
        config["npc_rewards"] = add_npc_loot({"rewards": config["rewards"]}, native, resource)
        for path, value in native.items():
            out[path] = json_bytes(value)
        for filename, source in SCRIPT_FILES.items():
            out[f"Monster_BP/scripts/creatures/{resource}/{filename}"] = (
                HERE / source
            ).read_bytes()
        out[f"Monster_BP/scripts/creatures/{resource}/config.js"] = (
            "export const config = " + json.dumps(config, ensure_ascii=False) + ";\n"
        ).encode()
    return out, config


def merge_lang(a, b):
    values = {}
    for raw in [a, b]:
        for line in raw.decode("utf-8-sig").splitlines():
            if not line or line.startswith("##"):
                continue
            key, sep, value = line.partition("=")
            if not sep:
                raise ValueError("Не удалось разобрать строку локализации")
            if key in values and values[key] != value:
                raise ValueError("Конфликт перевода " + key)
            values[key] = value
    return ("\n".join(k + "=" + v for k, v in sorted(values.items())) + "\n").encode()


def consistency(files):
    """Check definition IDs and links the workshop emits, after all renaming."""
    errors = []
    defined = {}
    objects = {k: parse_json(v) for k, v in files.items() if k.endswith(".json")}
    objects = {k: v for k, v in objects.items() if isinstance(v, dict)}

    def define(group, key, path):
        idkey = (group, key)
        if idkey in defined:
            errors.append("Дублируется " + group + " " + key)
        defined[idkey] = path

    for path, obj in objects.items():
        if "minecraft:entity" in obj:
            define("entity", obj["minecraft:entity"]["description"]["identifier"], path)
        if "/entity/" in path and "minecraft:client_entity" in obj:
            define("client", obj["minecraft:client_entity"]["description"]["identifier"], path)
        for g in obj.get("minecraft:geometry", []):
            define("geometry", g["description"]["identifier"], path)
        for key in obj.get("animations", {}):
            define("animation", key, path)
        for key in obj.get("render_controllers", {}):
            define("controller", key, path)
    for path, obj in objects.items():
        if "minecraft:client_entity" in obj:
            c = obj["minecraft:client_entity"]["description"]
            ident = c["identifier"]
            if ("entity", ident) not in defined:
                errors.append("Нет поведения для " + ident)
            for tex in c.get("textures", {}).values():
                if "Monster_RP/" + tex + ".png" not in files:
                    errors.append("Не найдена текстура " + tex)
            for group, values in [
                ("geometry", c.get("geometry", {}).values()),
                ("animation", c.get("animations", {}).values()),
                ("controller", c.get("render_controllers", [])),
            ]:
                for value in values:
                    if (group, value) not in defined:
                        errors.append("Не найден " + group + " " + value)
        if "minecraft:entity" in obj:
            e = obj["minecraft:entity"]
            ident = e["description"]["identifier"]
            if ("client", ident) not in defined:
                errors.append("Нет модели для " + ident)
            loot = e["components"].get("minecraft:loot", {}).get("table")
            if loot and "Monster_BP/" + loot not in files:
                errors.append("Не найдена добыча " + loot)
        if (
            "minecraft:spawn_rules" in obj
            and ("entity", obj["minecraft:spawn_rules"]["description"]["identifier"]) not in defined
        ):
            errors.append("Правило появления ссылается на неизвестного монстра")
    for path, data in files.items():
        if path.endswith(".js"):
            for relative in re.findall(
                r"(?:from\s*|import\s*)['\"](\.[^'\"]+)['\"]", data.decode()
            ):
                parts = list(PurePosixPath(path).parent.parts)
                for part in PurePosixPath(relative).parts:
                    if part == "..":
                        parts.pop()
                    elif part != ".":
                        parts.append(part)
                if "/".join(parts) not in files:
                    errors.append("Не найден импорт " + relative + " в " + path)
        if path.endswith("config.js"):
            config = json.loads(
                data.decode().removeprefix("export const config = ").strip().removesuffix(";")
            )
            for row in config.get("npc_rewards", []):
                if "Monster_BP/loot_tables/" + row["loot_table"] + ".json" not in files:
                    errors.append("Не найдена награда NPC " + row["loot_table"])

    # A standalone composition must not silently depend on an absent custom item pack.
    def items(value):
        if isinstance(value, list):
            for v in value:
                yield from items(v)
        elif isinstance(value, dict):
            for k, v in value.items():
                if k in ["item", "food"] and isinstance(v, str):
                    yield v
                elif k == "type" and v == "item":
                    if isinstance(value.get("name"), str):
                        yield value["name"]
                else:
                    yield from items(v)

    for path, obj in objects.items():
        if "/loot_tables/" in path:
            for item in items(obj):
                if not item.startswith("minecraft:"):
                    errors.append("В сборке нет определения предмета " + item)
    for path, raw in files.items():
        if path.endswith("/config.js"):
            obj = json.loads(
                raw.decode().removeprefix("export const config = ").strip().removesuffix(";")
            )
            for item in items(obj):
                if not item.startswith("minecraft:"):
                    errors.append("В сборке нет определения предмета " + item)
    return sorted(set(errors))


def prepare(root, settings):
    validate_settings(settings)
    errors = []
    warnings = []
    files = {}
    monsters = []
    source_hashes = []
    ids = set()
    scripted = []
    engine = [1, 26, 60]
    api = "2.0.0"
    for row in settings["selection"]:
        try:
            source, info = load_source(root, row)
            identifier = row["identifier"]
            if identifier in ids:
                errors.append(
                    "Повторяющийся ID "
                    + identifier
                    + ". Измените ID в строке одного из персонажей."
                )
                continue
            ids.add(identifier)
            engine = max(engine, info["engine"])
            source_hashes.append(
                digest(b"".join(k.encode() + b"\0" + v for k, v in sorted(source.items())))
            )
            incoming, config = source_assets(source, info, identifier)
            if config:
                scripted.append(identifier)
                if config["rewards"]["trade_mode"] == "npc":
                    api = "2.4.0"
            for path, raw in incoming.items():
                existing = next((k for k in files if k.casefold() == path.casefold()), None)
                if existing and existing != path:
                    raise ValueError("Конфликт регистра путей " + path)
                if existing:
                    if path.endswith(".lang"):
                        raw = merge_lang(files[path], raw)
                    elif path.endswith("/languages.json"):
                        raw = json_bytes(
                            sorted(set(parse_json(files[path])) | set(parse_json(raw)))
                        )
                    elif files[path] != raw:
                        raise ValueError("Конфликт файла " + path)
                files[path] = raw
            monsters.append(
                dict(
                    name=info["name"],
                    original_id=info["identifier"],
                    identifier=identifier,
                    bones=info["bones"],
                    cubes=info["cubes"],
                    scripted=info["scripted"],
                )
            )
        except (ValueError, KeyError, TypeError, OSError, IndexError) as e:
            errors.append("Источник " + str(row.get("id", "")) + ": " + str(e))
    if not errors:
        if sum(len(v) for v in files.values()) > 128 * 1024 * 1024:
            errors.append("Общая сборка превышает 128 МБ распакованных ресурсов")
        files["Monster_BP/scripts/bundle-guard.js"] = (HERE / "bundle-guard.js").read_bytes()
        startup = ["import { installBundleGuard } from './bundle-guard.js';"]
        startup.extend(
            "import './creatures/" + ident.replace(":", "/") + "/main.js';" for ident in scripted
        )
        startup.append(
            "installBundleGuard("
            + json.dumps(sorted(ids))
            + ","
            + str(settings["loaded_max"])
            + ");"
        )
        files["Monster_BP/scripts/main.js"] = ("\n".join(startup) + "\n").encode()
        errors.extend(consistency(files))
    total_cubes = sum(m["cubes"] for m in monsters)
    if total_cubes * settings["loaded_max"] > 20000:
        warnings.append(
            "При общем лимите модельная нагрузка может быть высокой. Уменьшите число одновременно загруженных персонажей или сложность моделей."
        )
    warnings.append(
        "В мире активируйте только общий BP и RP для выбранных персонажей. Индивидуальные пакеты с теми же ID нужно выключить."
    )
    generated = digest(b"".join(k.encode() + b"\0" + v for k, v in sorted(files.items())))
    snapshot = digest(
        json_bytes(
            dict(
                id=settings["id"],
                name=settings["name"],
                loaded_max=settings["loaded_max"],
                selection=settings["selection"],
                sources=source_hashes,
                generated=generated,
            )
        )
    )
    report = dict(
        ok=not errors,
        errors=errors,
        warnings=warnings,
        monsters=monsters,
        snapshot=snapshot,
        engine=engine,
        script_api=api,
        loaded_max=settings["loaded_max"],
        total_cubes=total_cubes,
        files=len(files),
    )
    return files, report


def build(root, settings, expected_snapshot):
    files, report = prepare(root, settings)
    if not report["ok"]:
        raise ValueError("; ".join(report["errors"]))
    if report["snapshot"] != expected_snapshot:
        raise ValueError(
            "Состав или исходный проект изменился после проверки. Проверьте сборку ещё раз."
        )
    record = root / "bundles" / f"{uid(settings['id'])}.json"
    previous = json.loads(record.read_text(encoding="utf-8")) if record.exists() else None
    version = [1, 0, (previous["version"] if previous else 0) + 1]
    basis = uuid.UUID(settings["id"])
    pack_ids = [
        str(uuid.uuid5(basis, tag)) for tag in ["bp", "bp-data", "rp", "rp-resources", "script"]
    ]

    def manifest(side):
        offset = 0 if side == "BP" else 2
        m = dict(
            format_version=2,
            header=dict(
                name=settings["name"] + " · " + ("Поведение" if side == "BP" else "Ресурсы"),
                description="Совместная сборка: " + str(len(report["monsters"])) + " персонажей.",
                uuid=pack_ids[offset],
                version=version,
                min_engine_version=report["engine"],
            ),
            modules=[
                dict(
                    type="data" if side == "BP" else "resources",
                    uuid=pack_ids[offset + 1],
                    version=version,
                )
            ],
        )
        if side == "BP":
            m["modules"].append(
                dict(
                    type="script",
                    language="javascript",
                    uuid=pack_ids[4],
                    version=version,
                    entry="scripts/main.js",
                )
            )
            m["dependencies"] = [
                dict(uuid=pack_ids[2], version=version),
                dict(module_name="@minecraft/server", version=report["script_api"]),
                dict(module_name="@minecraft/server-ui", version="2.0.0"),
            ]
        return m

    for side in ["BP", "RP"]:
        files[f"Monster_{side}/manifest.json"] = json_bytes(manifest(side))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as addon:
        for side in ["BP", "RP"]:
            inner = io.BytesIO()
            prefix = f"Monster_{side}/"
            with zipfile.ZipFile(inner, "w", zipfile.ZIP_DEFLATED) as pack:
                for path, raw in sorted(files.items()):
                    if path.startswith(prefix):
                        pack.writestr(path[len(prefix) :], raw)
            addon.writestr("Collection_" + side + ".mcpack", inner.getvalue())
    saved = {k: copy.deepcopy(settings[k]) for k in ["id", "name", "loaded_max", "selection"]}
    saved["version"] = version[2]
    return out.getvalue(), saved, report
