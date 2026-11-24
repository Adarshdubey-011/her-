import json
import unittest
import urllib.request

from her_server import llm
from her_server.config import Config, ConfigError, from_env

from helpers import FakeOllama, Harness, b64, vault_blob


class ApiSecurityTests(unittest.TestCase):
    def setUp(self): self.h = Harness()
    def tearDown(self): self.h.close()

    def test_rejects_foreign_host_header(self):
        self.assertEqual(self.h.call("GET", "/api/status", host="evil.com")[0], 403)
        self.assertEqual(self.h.call("GET", "/", host="evil.com:80")[0], 403)

    def test_rejects_foreign_origin_and_missing_marker(self):
        self.assertEqual(self.h.call("GET", "/api/status", headers={"Origin": "http://evil.com"})[0], 403)
        req = urllib.request.Request(self.h.base + "/api/status")
        with self.assertRaises(Exception) as c:
            urllib.request.urlopen(req)
        self.assertIn("403", str(c.exception))

    def test_same_origin_allowed(self):
        self.assertEqual(self.h.call("GET", "/api/status", headers={"Origin": self.h.base})[0], 200)

    def test_path_traversal_blocked(self):
        for p in ("/../server.py", "/%2e%2e/server.py", "/../../etc/passwd"):
            s, _ = self.h.call("GET", p, raw=True)
            self.assertEqual(s, 404, p)

    def test_security_headers_and_no_cache(self):
        with urllib.request.urlopen(self.h.base + "/") as r:
            self.assertIn("script-src 'self'", r.headers["Content-Security-Policy"])
            self.assertEqual(r.headers["Cache-Control"], "no-store")
            self.assertEqual(r.headers["Referrer-Policy"], "no-referrer")

    def test_binds_loopback_only(self):
        self.assertEqual(self.h.httpd.server_address[0], "127.0.0.1")

    def test_authenticated_routes_need_a_session(self):
        for m, p in (("PUT", "/api/vault"), ("POST", "/api/pin"), ("POST", "/api/settings"), ("GET", "/api/llm"), ("POST", "/api/chat")):
            self.assertEqual(self.h.call(m, p, {})[0], 401, p)
        self.assertEqual(self.h.call("PUT", "/api/vault", {}, token="forged")[0], 401)

    def test_bad_json_and_unknown_route(self):
        self.assertEqual(self.h.call("POST", "/api/login", None, headers={})[0], 404)   # no vault yet
        self.assertEqual(self.h.call("GET", "/api/nope")[0], 404)

    def test_no_request_logging(self):
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf), contextlib.redirect_stdout(buf):
            self.h.call("GET", "/api/status")
        self.assertEqual(buf.getvalue(), "")


class ApiFlowTests(unittest.TestCase):
    def setUp(self): self.h = Harness()
    def tearDown(self): self.h.close()

    def test_status_before_and_after_setup(self):
        s, st = self.h.call("GET", "/api/status")
        self.assertEqual((st["configured"], st["kdf"]), (False, None))
        self.h.setup(plen=6)
        s, st = self.h.call("GET", "/api/status")
        self.assertTrue(st["configured"]); self.assertEqual(st["pin_len"], 6); self.assertIn("salt", st["kdf"])

    def test_setup_only_once(self):
        self.h.setup()
        self.assertEqual(self.h.call("POST", "/api/setup/begin")[0], 409)
        self.assertEqual(self.h.call("POST", "/api/setup", {"auth": b64(), "vault": vault_blob()})[0], 409)

    def test_setup_validates(self):
        self.h.call("POST", "/api/setup/begin")
        self.assertEqual(self.h.call("POST", "/api/setup", {"auth": b64(), "vault": vault_blob(), "plen": 3})[0], 400)
        self.assertEqual(self.h.call("POST", "/api/setup", {"auth": "short", "vault": vault_blob()})[0], 400)
        self.assertEqual(self.h.call("POST", "/api/setup", {"vault": vault_blob()})[0], 400)

    def test_login_success_returns_vault_pepper_and_token(self):
        auth, tok, rev, pepper = self.h.setup()
        s, r = self.h.call("POST", "/api/login", {"auth": auth})
        self.assertEqual(s, 200)
        self.assertEqual((r["rev"], r["pepper"], r["recovered"]), (1, pepper, False))
        self.assertIn("data", r["vault"]); self.assertNotIn("ver", r["vault"])

    def test_wrong_pin_gives_no_secrets(self):
        self.h.setup()
        s, r = self.h.call("POST", "/api/login", {"auth": b64()})
        self.assertEqual(s, 401)
        self.assertEqual(set(r) & {"vault", "pepper", "token"}, set())
        self.assertEqual(r["left"], 9)

    def test_lockout_then_429_and_correct_pin_blocked(self):
        auth, *_ = self.h.setup()
        for _ in range(5):
            self.h.call("POST", "/api/login", {"auth": b64()})
        s, r = self.h.call("POST", "/api/login", {"auth": auth})
        self.assertEqual(s, 429); self.assertGreater(r["locked"], 0)
        self.assertGreater(self.h.call("GET", "/api/status")[1]["locked"], 0)

    def test_ten_wrong_pins_erase_everything(self):
        self.h.setup()
        for _ in range(10):
            self.h.app.auth.reset(True)                 # skip the waiting, keep the count honest below
            self.h.app.auth.meta.write_text(json.dumps({"fails": self.h.app.auth._load().get("fails", 0), "until": 0, "wipe_after": True}))
            s, r = self.h.call("POST", "/api/login", {"auth": b64()})
        # reset() zeroes the counter, so drive the real counter instead:
        self.h.close(); self.h = Harness()
        auth, *_ = self.h.setup()
        res = None
        for _ in range(10):
            m = self.h.app.auth._load(); m["until"] = 0; self.h.app.auth._save(m)
            s, res = self.h.call("POST", "/api/login", {"auth": b64()})
        self.assertTrue(res.get("wiped"))
        self.assertFalse(self.h.app.store.exists())
        self.assertIsNone(self.h.app.auth.pepper())
        self.assertFalse(self.h.call("GET", "/api/status")[1]["configured"])

    def test_wipe_after_can_be_turned_off(self):
        self.h.setup(wipe_after=False)
        for _ in range(12):
            m = self.h.app.auth._load(); m["until"] = 0; self.h.app.auth._save(m)
            self.h.call("POST", "/api/login", {"auth": b64()})
        self.assertTrue(self.h.app.store.exists())

    def test_save_with_revisions_and_conflict(self):
        auth, tok, rev, _ = self.h.setup()
        s, r = self.h.call("PUT", "/api/vault", {"vault": vault_blob("v2"), "base_rev": rev}, token=tok)
        self.assertEqual((s, r["rev"]), (200, 2))
        s, r = self.h.call("PUT", "/api/vault", {"vault": vault_blob("stale"), "base_rev": 1}, token=tok)
        self.assertEqual((s, r["error"], r["rev"]), (409, "conflict", 2))

    def test_client_cannot_overwrite_verifier_through_vault_save(self):
        auth, tok, rev, _ = self.h.setup()
        evil = vault_blob("x"); evil["ver"] = {"s": b64(16), "h": b64(32)}
        self.h.call("PUT", "/api/vault", {"vault": evil, "base_rev": rev}, token=tok)
        self.assertEqual(self.h.call("POST", "/api/login", {"auth": auth})[0], 200)

    def test_change_pin_is_atomic_and_swaps_credentials(self):
        auth, tok, rev, _ = self.h.setup()
        new = b64()
        s, r = self.h.call("POST", "/api/pin", {"old_auth": b64(), "new_auth": new, "vault": vault_blob("n"), "base_rev": rev}, token=tok)
        self.assertEqual(s, 401)                                     # wrong old PIN: nothing changes
        s, r = self.h.call("POST", "/api/pin", {"old_auth": auth, "new_auth": new, "vault": vault_blob("n"), "base_rev": rev, "plen": 6}, token=tok)
        self.assertEqual(s, 200)
        self.assertEqual(self.h.call("POST", "/api/login", {"auth": auth})[0], 401)
        s, r = self.h.call("POST", "/api/login", {"auth": new})
        self.assertEqual(s, 200)
        self.assertEqual(self.h.call("GET", "/api/status")[1]["pin_len"], 6)

    def test_logout_revokes_session(self):
        _, tok, rev, _ = self.h.setup()
        self.h.call("POST", "/api/logout", {}, token=tok)
        self.assertEqual(self.h.call("PUT", "/api/vault", {"vault": vault_blob(), "base_rev": rev}, token=tok)[0], 401)

    def test_erase_needs_confirmation_and_removes_all(self):
        _, tok, *_ = self.h.setup()
        self.assertEqual(self.h.call("DELETE", "/api/data", {})[0], 400)
        self.assertEqual(self.h.call("DELETE", "/api/data", {"confirm": "ERASE"})[0], 200)
        self.assertEqual(list(self.h.cfg.data_dir.iterdir()), [])
        self.assertEqual(self.h.call("PUT", "/api/vault", {"vault": vault_blob(), "base_rev": 1}, token=tok)[0], 401)

    def test_corrupt_vault_recovers_from_backup_on_login(self):
        auth, tok, rev, _ = self.h.setup()
        self.h.call("PUT", "/api/vault", {"vault": vault_blob("v2"), "base_rev": rev}, token=tok)
        self.h.app.store.main.write_text("broken")
        s, r = self.h.call("POST", "/api/login", {"auth": auth})
        self.assertEqual((s, r["recovered"], r["rev"]), (200, True, 1))


class LlmTests(unittest.TestCase):
    def test_config_refuses_non_local_model_host(self):
        with self.assertRaises(ConfigError):
            from_env({"OLLAMA_URL": "http://example.com:11434"})
        self.assertEqual(from_env({"OLLAMA_URL": "http://localhost:11434"}).ollama_url, "http://localhost:11434")
        self.assertTrue(from_env({"OLLAMA_URL": "http://10.0.0.5:11434", "HER_ALLOW_REMOTE_LLM": "1"}))

    def test_pick_model(self):
        ms = [{"name": "llama3:8b"}, {"name": "gemma3:4b"}, {"name": "gemma3n:e2b"}]
        self.assertEqual(llm.pick_model(ms), "gemma3n:e2b")
        self.assertEqual(llm.pick_model([{"name": "gemma3:4b"}, {"name": "gemma3:1b"}]), "gemma3:1b")
        self.assertIsNone(llm.pick_model([{"name": "llama3:8b"}]))
        self.assertEqual(llm.pick_model(ms, "llama3"), "llama3:8b")
        self.assertIsNone(llm.pick_model(ms, "nope"))

    def test_availability_states(self):
        h = Harness(); self.addCleanup(h.close)
        self.assertEqual(llm.availability(h.cfg)["hint"], "no_runtime")
        for models, ready, hint in ((["llama3:8b"], False, "no_gemma"), (["gemma3n:e2b"], True, "")):
            fake = FakeOllama(models=models); self.addCleanup(fake.close)
            h2 = Harness(ollama_url=fake.url); self.addCleanup(h2.close)
            av = llm.availability(h2.cfg)
            self.assertEqual((av["ready"], av["hint"]), (ready, hint))
        fake = FakeOllama(models=["gemma3n:e2b"]); self.addCleanup(fake.close)
        h3 = Harness(ollama_url=fake.url, model="gemma9:xl"); self.addCleanup(h3.close)
        self.assertEqual(llm.availability(h3.cfg)["hint"], "model_missing")

    def test_trim_keeps_system_and_latest(self):
        msgs = [{"role": "system", "content": "S" * 10}] + [{"role": "user", "content": str(i) * 100} for i in range(20)]
        out = llm.trim_messages(msgs, 450)
        self.assertEqual(out[0]["role"], "system")
        self.assertTrue(out[-1]["content"].startswith("19"))
        self.assertLessEqual(sum(len(m["content"]) for m in out), 450 + 100)

    def test_chat_streams_and_forwards_only_cleaned_messages(self):
        fake = FakeOllama(); self.addCleanup(fake.close)
        h = Harness(ollama_url=fake.url); self.addCleanup(h.close)
        _, tok, *_ = h.setup()
        s, body = h.call("POST", "/api/chat", {"system": "be kind", "messages": [{"role": "user", "content": "hi"}, {"role": "evil", "content": "x"}]}, token=tok, raw=True)
        lines = [json.loads(l) for l in body.decode().splitlines()]
        self.assertEqual("".join(l.get("t", "") for l in lines), "Hello there")
        self.assertTrue(lines[-1]["done"])
        sent = fake.seen[0]
        self.assertEqual(sent["model"], "gemma3n:e2b")
        self.assertEqual([m["role"] for m in sent["messages"]], ["system", "user", "assistant"])   # unknown role coerced

    def test_chat_reports_midstream_failure_with_partial_flag(self):
        fake = FakeOllama(fail_after=1); self.addCleanup(fake.close)
        h = Harness(ollama_url=fake.url); self.addCleanup(h.close)
        _, tok, *_ = h.setup()
        s, body = h.call("POST", "/api/chat", {"system": "", "messages": [{"role": "user", "content": "hi"}]}, token=tok, raw=True)
        last = json.loads(body.decode().splitlines()[-1])
        self.assertEqual((last["error"], last["partial"]), ("model_error", True))

    def test_chat_503_with_actionable_hint_when_no_model(self):
        h = Harness(); self.addCleanup(h.close)
        _, tok, *_ = h.setup()
        s, r = h.call("POST", "/api/chat", {"system": "", "messages": []}, token=tok)
        self.assertEqual((s, r["error"]), (503, "no_runtime"))
        s, r = h.call("GET", "/api/llm", token=tok)
        self.assertFalse(r["ready"])


if __name__ == "__main__":
    unittest.main()
