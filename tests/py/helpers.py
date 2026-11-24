import base64
import json
import os
import secrets
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from her_server.app import serve
from her_server.config import Config


def b64(n=32):
    return base64.b64encode(secrets.token_bytes(n)).decode()


def vault_blob(tag="x"):
    return {"salt": b64(16), "iv": b64(12), "data": base64.b64encode(tag.encode() * 20).decode(),
            "kdf": {"name": "PBKDF2-SHA256", "iter": 600000}}


class FakeOllama:
    """Tiny stand-in for a local Ollama so tests never need a real model."""

    def __init__(self, models=("gemma3n:e2b", "llama3:8b"), chunks=("Hel", "lo ", "there"), fail_after=None):
        self.models, self.chunks, self.fail_after, self.seen = list(models), list(chunks), fail_after, []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a): pass

            def do_GET(self):
                body = json.dumps({"models": [{"name": m} for m in outer.models]}).encode()
                self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                outer.seen.append(json.loads(self.rfile.read(n)))
                self.send_response(200); self.send_header("Content-Type", "application/x-ndjson"); self.end_headers()
                for i, c in enumerate(outer.chunks):
                    if outer.fail_after is not None and i >= outer.fail_after:
                        self.wfile.write(json.dumps({"error": "boom"}).encode() + b"\n"); return
                    self.wfile.write(json.dumps({"message": {"content": c}, "done": False}).encode() + b"\n")
                self.wfile.write(json.dumps({"done": True}).encode() + b"\n")

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown(); self.httpd.server_close()


class Harness:
    """A real HER server on an ephemeral port with a throwaway data folder."""

    def __init__(self, ollama_url="http://127.0.0.1:9", model="", **cfg):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = Config(port=0, data_dir=Path(self.tmp.name) / "data", ollama_url=ollama_url, model=model,
                          web_root=Path(__file__).resolve().parents[2] / "web", connect_timeout=1.0,
                          stream_idle_timeout=5.0, **cfg)
        self.httpd, self.app = serve(self.cfg)
        self.port = self.httpd.server_address[1]
        self.base = f"http://127.0.0.1:{self.port}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.tmp.cleanup()

    def call(self, method, path, body=None, token=None, headers=None, host=None, raw=False):
        h = {"X-HER": "1", "Content-Type": "application/json", **(headers or {})}
        if token:
            h["Authorization"] = "Bearer " + token
        if host:
            h["Host"] = host
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                payload = r.read()
                return r.status, (payload if raw else json.loads(payload or b"{}"))
        except urllib.error.HTTPError as e:
            payload = e.read()
            try:
                return e.code, (payload if raw else json.loads(payload or b"{}"))
            except ValueError:
                return e.code, payload

    def setup(self, auth=None, wipe_after=True, plen=4):
        auth = auth or b64()
        s, b = self.call("POST", "/api/setup/begin")
        assert s == 200, b
        s, r = self.call("POST", "/api/setup", {"auth": auth, "vault": vault_blob("first"), "plen": plen, "wipe_after": wipe_after})
        assert s == 200, r
        return auth, r["token"], r["rev"], b["pepper"]
