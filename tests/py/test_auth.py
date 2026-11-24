import tempfile
import unittest
from pathlib import Path

from her_server.auth import Auth, Sessions, WIPE_AFTER, check_verifier, decode_auth, delay_for, make_verifier

from helpers import b64


class Clock:
    def __init__(self): self.t = 1000.0
    def __call__(self): return self.t


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.clock, self.wiped = Clock(), []
        self.a = Auth(Path(self.tmp.name), on_wipe=lambda: self.wiped.append(1), clock=self.clock)
        self.a.reset(True)
        self.secret = b64()
        self.ver = make_verifier(self.secret)

    def tearDown(self):
        self.tmp.cleanup()

    def test_delay_schedule(self):
        self.assertEqual([delay_for(n) for n in (0, 1, 4)], [0, 0, 0])
        self.assertEqual((delay_for(5), delay_for(6), delay_for(9)), (30, 60, 150))
        self.assertEqual(delay_for(500), 900)

    def test_verifier_is_salted_and_checks(self):
        v2 = make_verifier(self.secret)
        self.assertNotEqual(self.ver["h"], v2["h"])          # fresh salt every time
        self.assertTrue(check_verifier(self.secret, self.ver))
        self.assertFalse(check_verifier(b64(), self.ver))
        self.assertFalse(check_verifier("not-base64!!", self.ver))
        self.assertFalse(check_verifier(self.secret, {"s": "x"}))

    def test_rejects_wrong_length_secret(self):
        for bad in ("", "AAAA", None, 5):
            with self.assertRaises(ValueError):
                decode_auth(bad)

    def test_correct_pin_ok_and_resets_counter(self):
        self.a.verify(b64(), self.ver)
        self.assertEqual(self.a.verify(self.secret, self.ver), {"ok": True})
        self.assertEqual(self.a.verify(b64(), self.ver)["left"], WIPE_AFTER - 1)

    def test_lockout_starts_at_fifth_failure_and_blocks_even_correct_pin(self):
        for _ in range(4):
            self.assertEqual(self.a.verify(b64(), self.ver)["locked"], 0)
        r = self.a.verify(b64(), self.ver)
        self.assertEqual(r["locked"], 30)
        self.assertEqual(self.a.verify(self.secret, self.ver), {"locked": 30})
        self.clock.t += 31
        self.assertEqual(self.a.verify(self.secret, self.ver), {"ok": True})

    def test_wipe_after_ten_failures(self):
        for _ in range(WIPE_AFTER - 1):
            r = self.a.verify(b64(), self.ver)
            self.clock.t += 1000
        self.assertEqual(self.wiped, [])
        self.assertEqual(self.a.verify(b64(), self.ver), {"wiped": True})
        self.assertEqual(self.wiped, [1])

    def test_wipe_can_be_disabled(self):
        self.a.set_wipe_after(False)
        for _ in range(30):
            r = self.a.verify(b64(), self.ver)
            self.clock.t += 1000
        self.assertEqual(self.wiped, [])
        self.assertIsNone(r["left"])

    def test_counter_survives_restart(self):
        for _ in range(5):
            self.a.verify(b64(), self.ver)
        again = Auth(Path(self.tmp.name), on_wipe=lambda: None, clock=self.clock)
        self.assertGreater(again.locked_for(), 0)

    def test_pepper_is_random_and_wipeable(self):
        p1 = self.a.new_pepper()
        self.assertEqual(self.a.pepper(), p1)
        self.assertNotEqual(self.a.new_pepper(), p1)
        self.a.wipe()
        self.assertIsNone(self.a.pepper())


class SessionTests(unittest.TestCase):
    def test_issue_expire_revoke(self):
        t = [0.0]
        s = Sessions(idle_s=10, clock=lambda: t[0])
        tok = s.issue()
        self.assertTrue(s.valid(tok))
        t[0] = 9; self.assertTrue(s.valid(tok))          # sliding: refreshed at t=9
        t[0] = 18; self.assertTrue(s.valid(tok))
        t[0] = 40; self.assertFalse(s.valid(tok))        # idle too long
        tok2 = s.issue(); s.revoke(tok2)
        self.assertFalse(s.valid(tok2))
        self.assertFalse(s.valid("")); self.assertFalse(s.valid("forged"))

    def test_tokens_are_unguessable_and_unique(self):
        s = Sessions()
        toks = {s.issue() for _ in range(50)}
        self.assertEqual(len(toks), 50)
        self.assertTrue(all(len(t) >= 40 for t in toks))


if __name__ == "__main__":
    unittest.main()
