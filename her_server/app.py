"""HTTP layer: static files + a small JSON API. Standard library only. Binds to loopback only."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import llm
from .auth import Auth, Sessions, make_verifier, PIN_LENGTHS
from .storage import VaultStore, StorageError, NotFound, Corrupt, ConflictError

MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
        ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2"}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")


class HerApp:
    """Everything the handler needs, so tests can build an isolated instance."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.store = VaultStore(cfg.data_dir, cfg.max_body)
        self.sessions = Sessions(cfg.session_idle_s)
        self.auth = Auth(cfg.data_dir, on_wipe=self.wipe_all)
        self.write_lock = threading.RLock()

    def wipe_all(self):
        self.sessions.clear()
        self.store.wipe()
        self.auth.wipe()

    def allowed_hosts(self, port):
        return {f"127.0.0.1:{port}", f"localhost:{port}"}


def make_handler(app: HerApp, port_getter):
    cfg = app.cfg

    class Handler(BaseHTTPRequestHandler):
        server_version = "HER"
        sys_version = ""

        def log_message(self, *a):   # no request logging: nothing about use is written anywhere
            pass

        # ---------- plumbing ----------
        def reply(self, code, body=None, ctype="application/json", extra=None):
            raw = body if isinstance(body, (bytes, bytearray)) else json.dumps(body if body is not None else {}).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(raw)

        def read_json(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > cfg.max_body:
                raise ValueError("too large")
            raw = self.rfile.read(n) if n else b"{}"
            data = json.loads(raw or b"{}")
            if not isinstance(data, dict):
                raise ValueError("object expected")
            return data

        def guard(self, api):
            allowed = app.allowed_hosts(port_getter())
            if self.headers.get("Host") not in allowed:        # blocks DNS-rebinding
                self.reply(403, {"error": "bad_host"})
                return False
            if api:
                origin = self.headers.get("Origin")
                if (origin and origin not in {f"http://{h}" for h in allowed}) or self.headers.get("X-HER") != "1":
                    self.reply(403, {"error": "forbidden"})   # blocks other websites
                    return False
            return True

        def token(self):
            h = self.headers.get("Authorization", "")
            return h[7:] if h.startswith("Bearer ") else ""

        def authed(self):
            if app.sessions.valid(self.token()):
                return True
            self.reply(401, {"error": "locked"})
            return False

        # ---------- verbs ----------
        def do_GET(self):
            path = self.path.split("?")[0]
            if path.startswith("/api/"):
                return self.api("GET", path) if self.guard(True) else None
            if not self.guard(False):
                return
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            root = Path(cfg.web_root).resolve()
            f = (root / rel).resolve()
            if (root not in f.parents and f != root) or not f.is_file():
                return self.reply(404, {"error": "not_found"})
            self.reply(200, f.read_bytes(), MIME.get(f.suffix, "application/octet-stream"))

        def do_POST(self):
            if self.guard(True):
                self.api("POST", self.path.split("?")[0])

        def do_PUT(self):
            if self.guard(True):
                self.api("PUT", self.path.split("?")[0])

        def do_DELETE(self):
            if self.guard(True):
                self.api("DELETE", self.path.split("?")[0])

        # ---------- API ----------
        def api(self, method, path):
            try:
                route = (method, path)
                fn = {
                    ("GET", "/api/status"): self.status,
                    ("POST", "/api/setup/begin"): self.setup_begin,
                    ("POST", "/api/setup"): self.setup_vault,
                    ("POST", "/api/login"): self.login,
                    ("POST", "/api/logout"): self.logout,
                    ("PUT", "/api/vault"): self.put_vault,
                    ("POST", "/api/pin"): self.change_pin,
                    ("POST", "/api/settings"): self.settings,
                    ("DELETE", "/api/data"): self.erase,
                    ("GET", "/api/llm"): self.llm_status,
                    ("POST", "/api/chat"): self.chat,
                }.get(route)
                if not fn:
                    return self.reply(404, {"error": "not_found"})
                return fn()
            except (BrokenPipeError, ConnectionResetError):
                pass
            except (ValueError, KeyError, TypeError):
                self.reply(400, {"error": "bad_request"})
            except ConflictError as e:
                self.reply(409, {"error": "conflict", "rev": e.current_rev})
            except NotFound:
                self.reply(404, {"error": "no_vault"})
            except Corrupt:
                self.reply(500, {"error": "corrupt"})
            except StorageError as e:
                self.reply(400, {"error": "bad_vault", "detail": str(e)})
            except Exception:
                try:
                    self.reply(500, {"error": "server_error"})
                except Exception:
                    pass

        # ----- status / setup / login -----
        def status(self):
            out = {"configured": False, "locked": app.auth.locked_for(), "pin_len": 4, "kdf": None}
            try:
                env, _, _ = app.store.read()
                p = env["payload"]
                out.update(configured=True, pin_len=p.get("plen", 4), kdf={"salt": p["salt"], **p["kdf"]})
            except NotFound:
                pass
            except Corrupt:
                out.update(configured=True, corrupt=True)
            self.reply(200, out)

        def setup_begin(self):
            with app.write_lock:
                if app.store.exists():
                    return self.reply(409, {"error": "already_configured"})
                self.reply(200, {"pepper": app.auth.new_pepper()})

        def setup_vault(self):
            d = self.read_json()
            with app.write_lock:
                if app.store.exists():
                    return self.reply(409, {"error": "already_configured"})
                if not app.auth.pepper():
                    return self.reply(400, {"error": "no_pepper"})
                plen = d.get("plen", 4)
                if plen not in PIN_LENGTHS:
                    return self.reply(400, {"error": "bad_pin_length"})
                payload = dict(d["vault"])
                payload["ver"] = make_verifier(d["auth"])
                payload["plen"] = plen
                rev = app.store.create(payload)
                app.auth.reset(bool(d.get("wipe_after", True)))
                self.reply(200, {"token": app.sessions.issue(), "rev": rev})

        def login(self):
            d = self.read_json()
            with app.write_lock:
                try:
                    env, source, _ = app.store.read()
                except NotFound:
                    return self.reply(404, {"error": "no_vault"})
                ver = env["payload"].get("ver")
                res = app.auth.verify(d.get("auth", ""), ver) if ver else {"bad": True, "left": None, "locked": 0}
                if "ok" not in res:
                    return self.reply(401 if "locked" not in res or "bad" in res else 429, res)
                v = env["payload"]
                self.reply(200, {"token": app.sessions.issue(), "rev": env["rev"], "pepper": app.auth.pepper(),
                                 "recovered": source == "backup",
                                 "wipe_after": app.auth.wipe_after(),
                                 "vault": {k: v[k] for k in ("salt", "iv", "data", "kdf")}})

        def logout(self):
            app.sessions.revoke(self.token())
            self.reply(200, {"ok": True})

        # ----- authenticated -----
        def put_vault(self):
            if not self.authed():
                return
            d = self.read_json()
            with app.write_lock:
                env, _, _ = app.store.read()
                payload = dict(d["vault"])
                payload["ver"], payload["plen"] = env["payload"].get("ver"), env["payload"].get("plen", 4)
                rev = app.store.save(payload, int(d["base_rev"]))
                self.reply(200, {"rev": rev})

        def change_pin(self):
            if not self.authed():
                return
            d = self.read_json()
            with app.write_lock:
                env, _, _ = app.store.read()
                res = app.auth.verify(d.get("old_auth", ""), env["payload"].get("ver"))
                if "ok" not in res:
                    return self.reply(401, res)
                plen = d.get("plen", env["payload"].get("plen", 4))
                if plen not in PIN_LENGTHS:
                    return self.reply(400, {"error": "bad_pin_length"})
                payload = dict(d["vault"])
                payload["ver"], payload["plen"] = make_verifier(d["new_auth"]), plen
                rev = app.store.save(payload, int(d["base_rev"]))   # ONE atomic write changes key and verifier
                self.reply(200, {"rev": rev})

        def settings(self):
            if not self.authed():
                return
            d = self.read_json()
            if "wipe_after" in d:
                app.auth.set_wipe_after(bool(d["wipe_after"]))
            self.reply(200, {"ok": True})

        def erase(self):
            d = self.read_json()
            if d.get("confirm") != "ERASE":
                return self.reply(400, {"error": "confirm_required"})
            with app.write_lock:
                app.wipe_all()
            self.reply(200, {"ok": True})

        # ----- model -----
        def llm_status(self):
            if self.authed():
                self.reply(200, llm.availability(cfg))

        def chat(self):
            if not self.authed():
                return
            d = self.read_json()
            av = llm.availability(cfg)
            if not av["ready"]:
                return self.reply(503, {"error": av["hint"] or "no_runtime", "status": av})
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            sent = False
            try:
                for chunk in llm.stream_chat(cfg, av["model"], d.get("system", ""), d.get("messages", [])):
                    self.wfile.write(json.dumps({"t": chunk}).encode() + b"\n")
                    self.wfile.flush()
                    sent = True
                self.wfile.write(json.dumps({"done": True, "model": av["model"]}).encode() + b"\n")
            except llm.LLMError as e:
                self.wfile.write(json.dumps({"error": e.code, "partial": sent}).encode() + b"\n")
            except (BrokenPipeError, ConnectionResetError):
                return   # browser stopped listening; stream_chat's finally closes the upstream
            self.close_connection = True

    return Handler


def serve(cfg, port=None):
    """Create (but do not start) the server. Returns (httpd, app)."""
    app = HerApp(cfg)
    holder = {"port": port if port is not None else cfg.port}
    httpd = ThreadingHTTPServer(("127.0.0.1", holder["port"]), make_handler(app, lambda: holder["port"]))
    holder["port"] = httpd.server_address[1]    # real port when 0 was requested
    httpd.daemon_threads = True
    return httpd, app
