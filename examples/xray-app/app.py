#!/usr/bin/env python3
"""Local-only Chest X-ray Review example integration, on 127.0.0.1:3041."""
import base64
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlsplit

from core import AppError, Config, XrayApp

ORIGIN = "http://127.0.0.1:3041"
HOST = "127.0.0.1:3041"
ROOT = Path(__file__).parent


def authorized(value, username, password):
    try:
        if not value or not value.startswith("Basic ") or len(value) > 1024:
            return False
        provided = base64.b64decode(value[6:], validate=True)
        expected = f"{username}:{password}".encode()
        return hmac.compare_digest(hashlib.sha256(provided).digest(), hashlib.sha256(expected).digest())
    except (ValueError, UnicodeError):
        return False


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, handler, app, username, password):
        self.app, self.username, self.password = app, username, password
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(address, handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *args):
        pass

    def respond(self, status, data, mime="application/json"):
        if not isinstance(data, bytes):
            data = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store, private")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(data)

    def handle_action(self):
        if self.headers.get("Host") != HOST:
            raise AppError("invalid_host", 403)
        path = urlsplit(self.path)
        assets = {"/": ("index.html", "text/html; charset=utf-8"), "/app.js": ("app.js", "text/javascript; charset=utf-8"), "/style.css": ("style.css", "text/css; charset=utf-8")}
        if self.command == "GET" and path.path in assets:
            filename, mime = assets[path.path]
            self.respond(200, (ROOT / filename).read_bytes(), mime)
            return
        if not authorized(self.headers.get("Authorization"), self.server.username, self.server.password):
            self.respond(401, {"error": "sign_in_required"})
            return
        if path.path.startswith("/api/"):
            if self.headers.get("X-Requested-With") != "CareVaultDemo":
                raise AppError("same_origin_required", 403)
            if self.command != "GET" and self.headers.get("Origin") != ORIGIN:
                raise AppError("same_origin_required", 403)
        if self.command == "GET":
            if path.path == "/api/session":
                self.respond(200, {"authenticated": True})
            elif path.path == "/api/records":
                self.respond(200, {"records": self.server.app.records()})
            elif path.path == "/api/image":
                args = parse_qs(path.query)
                image, mime, _ = self.server.app.image(args.get("id", [""])[0], args.get("variant", [""])[0])
                self.respond(200, image, mime)
            else:
                raise AppError("not_found", 404)
        elif self.command == "POST" and path.path in ("/api/analyze", "/api/save"):
            if self.headers.get("Content-Type") != "application/json" or self.headers.get("Transfer-Encoding"):
                raise AppError("invalid_request")
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise ValueError()
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError()
            except (ValueError, TypeError):
                raise AppError("invalid_request") from None
            if path.path == "/api/analyze":
                self.respond(200, self.server.app.analyze(body.get("recordId"), body.get("variant")))
            else:
                identifier = body.get("draftId")
                if not isinstance(identifier, str):
                    raise AppError("invalid_request")
                self.respond(200, self.server.app.save(identifier))
        else:
            raise AppError("not_found", 404)

    def dispatch(self):
        try:
            self.handle_action()
        except AppError as error:
            self.respond(error.status, {"error": error.code})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.respond(500, {"error": "request_failed"})

    do_GET = dispatch
    do_POST = dispatch


def main():
    username, password = os.environ.get("XRAY_APP_USERNAME", ""), os.environ.get("XRAY_APP_PASSWORD", "")
    if not username or ":" in username or len(username) > 100 or not 12 <= len(password) <= 256:
        raise SystemExit("Set XRAY_APP_USERNAME and XRAY_APP_PASSWORD (at least 12 characters).")
    try:
        app = XrayApp(Config.from_environment())
    except AppError as error:
        raise SystemExit(error.code) from None
    server = LocalServer(("127.0.0.1", 3041), Handler, app, username, password)
    print(f"Chest X-ray Review: {ORIGIN}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
