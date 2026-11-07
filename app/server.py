import argparse
import json
import mimetypes
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import bundle
import generation
from bedrock import archive, default_project, geometry, png, validate
from generation import cancel_job, get_job, latest_job, provider_status, start_job
from paths import APP_ROOT, data_directory, initialize_data_directory
from population import guardrail_report
from storage import write_bytes, write_json
from stories import upgrade
from texture_tools import project_texture

ROOT = data_directory()
WEB = APP_ROOT / "app/web"
LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def send(self, code, data, typ="application/json; charset=utf-8"):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        )
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        try:
            self.get_response()
        except (ValueError, KeyError, TypeError, OSError):
            self.send(404, {"error": "Не найдено или повреждено"})
        except Exception as error:
            self.log_error("GET failed: %s", type(error).__name__)
            self.send(500, {"error": "Ошибка сервера"})

    def get_response(self):
        path = urlparse(self.path).path
        if self.headers.get("Host") not in [
            f"127.0.0.1:{self.server.server_port}",
            f"localhost:{self.server.server_port}",
        ]:
            return self.send(403, {"error": "Local host only"})
        if path == "/api/projects":
            return self.send(200, list_records(ROOT / "projects"))
        if path == "/api/new":
            return self.send(200, default_project())
        if path == "/api/bundle/new":
            return self.send(200, bundle.new_bundle())
        if path == "/api/bundle/sources":
            return self.send(200, bundle.sources(ROOT))
        if path == "/api/bundles":
            return self.send(200, list_records(ROOT / "bundles", include_version=True))
        if path.startswith("/api/bundle/"):
            try:
                return self.send(
                    200,
                    json.loads(
                        (
                            ROOT / "bundles" / f"{bundle.uid(path.rsplit('/', 1)[-1])}.json"
                        ).read_text(encoding="utf-8")
                    ),
                )
            except (ValueError, FileNotFoundError):
                return self.send(404, {"error": "Сборка не найдена"})
        if path == "/api/generation/provider":
            return self.send(200, provider_status())
        if path.startswith("/api/generation/latest/"):
            try:
                return self.send(200, latest_job(path.rsplit("/", 1)[-1]))
            except ValueError:
                return self.send(400, {"error": "Неверный ID проекта"})
        if path.startswith("/api/generation/jobs/"):
            try:
                return self.send(200, get_job(path.rsplit("/", 1)[-1], include_candidate=True))
            except (ValueError, FileNotFoundError):
                return self.send(404, {"error": "Задание не найдено"})
        if path.startswith("/api/project/"):
            try:
                import uuid

                pid = str(uuid.UUID(path.rsplit("/", 1)[-1]))
                return self.send(
                    200,
                    upgrade(
                        json.loads((ROOT / "projects" / f"{pid}.json").read_text(encoding="utf-8"))
                    ),
                )
            except (ValueError, FileNotFoundError):
                return self.send(404, {"error": "Проект не найден"})
        if path.startswith("/exports/"):
            file = (ROOT / path.lstrip("/")).resolve()
            base = (ROOT / "exports").resolve()
        else:
            file = (WEB / ("index.html" if path == "/" else path.lstrip("/"))).resolve()
            base = WEB.resolve()
        if not file.is_relative_to(base) or not file.is_file():
            return self.send(404, {"error": "Не найдено"})
        typ = (
            "text/javascript"
            if file.suffix == ".js"
            else mimetypes.guess_type(str(file))[0] or "application/octet-stream"
        )
        self.send(200, file.read_bytes(), typ)

    def do_POST(self):
        origin = self.headers.get("Origin")
        if self.headers.get("Host") not in [
            f"127.0.0.1:{self.server.server_port}",
            f"localhost:{self.server.server_port}",
        ] or origin not in [
            f"http://127.0.0.1:{self.server.server_port}",
            f"http://localhost:{self.server.server_port}",
        ]:
            return self.send(403, {"error": "Локальный запрос обязателен"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if (
                not 0 < n <= 25_000_000
                or self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                != "application/json"
            ):
                raise ValueError("Недопустимый запрос")
            payload = json.loads(self.rfile.read(n))
            if not isinstance(payload, dict):
                raise ValueError("Ожидается JSON-объект")
            if self.path == "/api/generation/start":
                p = payload["project"]
                validate(p)
                return self.send(
                    202,
                    start_job(p, payload.get("instructions", ""), payload.get("consent", False)),
                )
            if self.path == "/api/generation/cancel":
                return self.send(200, cancel_job(payload["id"]))
            if self.path == "/api/bundle/import":
                return self.send(200, bundle.import_addon(ROOT, payload["name"], payload["data"]))
            if self.path == "/api/bundle/check":
                with LOCK:
                    _, report = bundle.prepare(ROOT, payload)
                return self.send(200, report)
            if self.path == "/api/bundle/export":
                with LOCK:
                    data, saved, report = bundle.build(ROOT, payload, payload.get("snapshot"))
                    filename = f"collection-{saved['id'][:8]}-1.0.{saved['version']}.mcaddon"
                    folder = ROOT / "bundles"
                    folder.mkdir(exist_ok=True)
                    report_name = filename.removesuffix(".mcaddon") + "-report.json"
                    write_bytes(ROOT / "exports" / filename, data)
                    write_json(ROOT / "exports" / report_name, report)
                    write_json(folder / f"{saved['id']}.json", saved)
                return self.send(
                    200,
                    dict(
                        bundle=saved,
                        report=report,
                        url="/exports/" + filename,
                        report_url="/exports/" + report_name,
                    ),
                )
            if self.path not in [
                "/api/guardrails",
                "/api/model-backup",
                "/api/preview",
                "/api/save",
                "/api/export",
            ]:
                return self.send(404, {"error": "Не найдено"})
            p = payload
            validate(p)
            if self.path == "/api/guardrails":
                return self.send(200, guardrail_report(p, geometry(p)))
            if self.path == "/api/model-backup":
                import uuid

                backup = ROOT / "backups/models"
                backup.mkdir(parents=True, exist_ok=True)
                file = backup / f"{p['id']}-{uuid.uuid4().hex[:8]}.json"
                write_json(file, p)
                return self.send(200, {"saved": True})
            if self.path == "/api/preview":
                import base64

                return self.send(
                    200,
                    dict(
                        geometry=geometry(p),
                        texture="data:image/png;base64,"
                        + base64.b64encode(project_texture(p, png)).decode(),
                    ),
                )
            if self.path not in ["/api/save", "/api/export"]:
                return self.send(404, {"error": "Не найдено"})
            with LOCK:
                file = ROOT / "projects" / f"{p['id']}.json"
                if file.exists():
                    old = json.loads(file.read_text(encoding="utf-8"))
                    if old["pack_ids"] != p["pack_ids"]:
                        raise ValueError("UUID существующего проекта изменены")
                    p["version"] = old["version"]
                if self.path == "/api/export":
                    data = archive(p)
                    p["version"] += 1
                    filename = f"{p['slug']}-{p['id'][:8]}-1.0.{p['version']}.mcaddon"
                    write_bytes(ROOT / "exports" / filename, data)
                write_json(file, p)
            self.send(
                200,
                dict(
                    project=p,
                    **({"url": "/exports/" + filename} if self.path == "/api/export" else {}),
                ),
            )
        except (ValueError, KeyError, TypeError, OverflowError) as e:
            self.send(400, {"error": str(e)})
        except Exception as e:
            self.log_error("POST failed: %s", type(e).__name__)
            self.send(500, {"error": "Ошибка сервера; подробности в терминале"})


def list_records(folder, include_version=False):
    """Ignore broken local drafts rather than making the whole editor unavailable."""
    result = []
    for file in sorted(folder.glob("*.json")):
        try:
            value = json.loads(file.read_text(encoding="utf-8"))
            item = {"id": bundle.uid(value["id"]), "name": value["name"]}
            if not isinstance(item["name"], str):
                continue
            if include_version:
                item["version"] = value["version"]
            result.append(item)
        except (ValueError, KeyError, TypeError, OSError):
            continue
    return result


def create_server(port=8766, data_dir=None):
    """Bind only loopback; source files and user data use different roots."""
    global ROOT
    ROOT = initialize_data_directory(data_directory(data_dir))
    generation.JOBS = ROOT / "generations"
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Local Minecraft monster workshop")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--data-dir", help="User-data directory; defaults to platform user storage")
    options = parser.parse_args()
    server = create_server(options.port, options.data_dir)
    url = f"http://127.0.0.1:{server.server_port}"
    print("Monster Workshop:", url, flush=True)
    if not options.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
