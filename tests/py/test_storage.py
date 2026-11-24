import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from her_server import storage
from her_server.storage import ConflictError, Corrupt, NotFound, StorageError, VaultStore

from helpers import vault_blob


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = VaultStore(Path(self.tmp.name) / "d")

    def tearDown(self):
        self.tmp.cleanup()

    def test_create_read_roundtrip(self):
        self.assertEqual(self.s.create(vault_blob("a")), 1)
        env, src, bak = self.s.read()
        self.assertEqual((env["rev"], src, bak), (1, "main", None))

    def test_missing_vault(self):
        with self.assertRaises(NotFound):
            self.s.read()
        self.assertFalse(self.s.exists())

    def test_cannot_create_twice(self):
        self.s.create(vault_blob())
        with self.assertRaises(StorageError):
            self.s.create(vault_blob())

    def test_save_increments_and_keeps_backup(self):
        self.s.create(vault_blob("one"))
        self.assertEqual(self.s.save(vault_blob("two"), 1), 2)
        self.assertTrue(self.s.bak.exists())
        env, _, bak = self.s.read()
        self.assertEqual(env["rev"], 2)
        self.assertEqual(bak["rev"], 1)

    def test_stale_revision_rejected_not_overwritten(self):
        self.s.create(vault_blob())
        self.s.save(vault_blob("new"), 1)
        with self.assertRaises(ConflictError) as c:
            self.s.save(vault_blob("stale"), 1)
        self.assertEqual(c.exception.current_rev, 2)
        self.assertEqual(self.s.read()[0]["rev"], 2)

    def test_damaged_main_recovers_from_backup(self):
        self.s.create(vault_blob("one"))
        self.s.save(vault_blob("two"), 1)
        self.s.main.write_text("{ truncated")
        env, src, _ = self.s.read()
        self.assertEqual((src, env["rev"]), ("backup", 1))

    def test_bitflip_is_detected_by_checksum(self):
        self.s.create(vault_blob("one"))
        raw = json.loads(self.s.main.read_text())
        raw["payload"]["data"] = raw["payload"]["data"][:-4] + "AAAA"
        self.s.main.write_text(json.dumps(raw))
        with self.assertRaises(Corrupt):
            self.s.read()

    def test_save_after_recovery_does_not_clobber_good_backup_with_damage(self):
        self.s.create(vault_blob("one"))
        self.s.save(vault_blob("two"), 1)
        self.s.main.write_text("garbage")
        env, src, _ = self.s.read()
        self.s.save(vault_blob("three"), env["rev"])      # rev 2 built on the backup (rev 1)
        self.assertEqual(self.s.read()[0]["rev"], 2)
        self.assertEqual(self.s.bak.read_text() and json.loads(self.s.bak.read_text())["rev"], 1)

    def test_crash_during_write_leaves_previous_vault_intact(self):
        self.s.create(vault_blob("one"))
        before = self.s.main.read_bytes()
        with mock.patch("her_server.storage.os.replace", side_effect=OSError("disk gone")):
            with self.assertRaises(OSError):
                self.s.save(vault_blob("two"), 1)
        self.assertEqual(self.s.main.read_bytes(), before)
        self.assertEqual(list(self.s.dir.glob("*.tmp")), [])

    def test_rejects_malformed_payloads(self):
        bad = [{}, {**vault_blob(), "salt": ""}, {**vault_blob(), "kdf": {"name": "md5", "iter": 600000}},
               {**vault_blob(), "kdf": {"name": "PBKDF2-SHA256", "iter": 5}}, {**vault_blob(), "plen": 99}, "x"]
        for p in bad:
            with self.assertRaises(StorageError):
                self.s.create(p)

    def test_size_limit(self):
        small = VaultStore(Path(self.tmp.name) / "s", max_bytes=500)
        big = vault_blob("y"); big["data"] = "A" * 2000
        with self.assertRaises(StorageError):
            small.create(big)

    @unittest.skipIf(os.name == "nt", "posix permissions")
    def test_private_permissions(self):
        self.s.create(vault_blob())
        self.assertEqual(stat.S_IMODE(self.s.main.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.s.dir.stat().st_mode), 0o700)

    def test_wipe_removes_everything(self):
        self.s.create(vault_blob("one"))
        self.s.save(vault_blob("two"), 1)
        (self.s.dir / "leftover.tmp").write_text("x")
        self.s.wipe()
        self.assertEqual(list(self.s.dir.iterdir()), [])
        with self.assertRaises(NotFound):
            self.s.read()

    def test_only_opaque_fields_are_stored(self):
        self.s.create(vault_blob("SECRET-PLAINTEXT"))
        on_disk = self.s.main.read_text()
        # data is stored as given (ciphertext in real use); nothing else could hold chat content
        self.assertEqual(set(json.loads(on_disk)["payload"]) - {"salt", "iv", "data", "kdf", "plen"}, set())


if __name__ == "__main__":
    unittest.main()
