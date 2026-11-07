"""Palette textures produced by this workshop; imported images remain untouched."""

import base64
import re
import struct
import zlib
from collections import Counter


def palette_png(colors):
    rgb = [bytes.fromhex(c[1:]) for c in colors]
    raw = b"".join(b"\0" + b"".join(rgb[x // 16] for x in range(128)) for _ in range(16))

    def chunk(k, v):
        return struct.pack(">I", len(v)) + k + v + struct.pack(">I", zlib.crc32(k + v) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 128, 16, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def palette_roles(geometry):
    bones = geometry["minecraft:geometry"][0]["bones"]

    def common(matches, fallback):
        tiles = Counter()
        for b in bones:
            if matches(b["name"].lower()):
                for c in b.get("cubes", []):
                    uv = c.get("uv", {})
                    if isinstance(uv, dict):
                        q = uv.get("north") or next(iter(uv.values()), None)
                        if q:
                            tile = int(q["uv"][0] // 16)
                            if 0 <= tile < 8:
                                x, y, z = c["size"]
                                tiles[tile] += 2 * (x * y + x * z + y * z)
        return tiles.most_common(1)[0][0] if tiles else fallback

    body = common(lambda n: n in ["body", "torso"], 0)
    accent = common(lambda n: n.startswith("leg_"), 1)
    return {"body": body, "accent": accent if accent != body else (body + 1) % 8}


def upgrade_palette(p):
    if (
        p.get("model_palette") is None
        and p.get("generation")
        and p.get("texture")
        and p.get("geometry")
    ):
        # Earlier Codex projects have an unfiltered RGB swatch image, but no palette metadata.
        try:
            png = base64.b64decode(p["texture"].split(",")[-1], validate=True)
            if png[16:29] != struct.pack(">IIBBBBB", 128, 16, 8, 2, 0, 0, 0):
                return
            offset = 8
            data = b""
            while offset + 12 <= len(png):
                length = struct.unpack(">I", png[offset : offset + 4])[0]
                kind = png[offset + 4 : offset + 8]
                if kind == b"IDAT":
                    data += png[offset + 8 : offset + 8 + length]
                offset += length + 12
            raw = zlib.decompressobj().decompress(data, 16 * 385 + 1)
            if len(raw) != 16 * 385 or any(raw[y * 385] != 0 for y in range(16)):
                return
            colors = ["#" + raw[1 + x * 48 : 4 + x * 48].hex() for x in range(8)]
            if palette_png(colors) != png:
                return
            p["model_palette"] = colors
            p["palette_roles"] = palette_roles(p["geometry"])
            p["color"] = colors[p["palette_roles"]["body"]]
            p["accent"] = colors[p["palette_roles"]["accent"]]
        except (ValueError, KeyError, TypeError, zlib.error, struct.error):
            return


def validate_palette(p):
    if "model_palette" not in p:
        return
    colors = p["model_palette"]
    roles = p.get("palette_roles")
    if (
        not isinstance(colors, list)
        or len(colors) != 8
        or any(not isinstance(c, str) or not re.fullmatch("#[0-9a-fA-F]{6}", c) for c in colors)
    ):
        raise ValueError("Палитра: нужны восемь цветов")
    if (
        not isinstance(roles, dict)
        or set(roles) != {"body", "accent"}
        or any(type(v) is not int or not 0 <= v < 8 for v in roles.values())
        or roles["body"] == roles["accent"]
    ):
        raise ValueError("Неверные роли цветов палитры")
    d = p.get("geometry", {}).get("minecraft:geometry", [{}])[0].get("description", {})
    if (d.get("texture_width"), d.get("texture_height")) != (128, 16):
        raise ValueError("Палитре нужна геометрия с текстурой 128×16")


def project_texture(p, fallback):
    if p.get("model_palette"):
        colors = p["model_palette"].copy()
        roles = p["palette_roles"]
        colors[roles["body"]] = p["color"]
        colors[roles["accent"]] = p["accent"]
        return palette_png(colors)
    return (
        base64.b64decode(p["texture"].split(",")[-1], validate=True)
        if p.get("texture")
        else fallback(p["color"], p["accent"])
    )
