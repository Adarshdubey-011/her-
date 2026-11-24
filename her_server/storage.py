"""Crash-safe storage for the encrypted vault.

Guarantees:
- Atomic replace (write temp, fsync, rename, fsync directory): a crash never leaves a half-written vault.
- Every write keeps the previous good version as vault.bak; reads fall back to it if the main file is damaged.
- Each file carries a SHA-256 checksum so silent corruption is detected, not decrypted into garbage.
- Revision numbers (optimistic concurrency): a stale tab cannot overwrite newer data.
- Only ciphertext is ever stored here. The server has no key.
"""
import hashlib
import json
import os
import secrets
import threading
from pathlib import Path

FMT = 2
B64_MAX = 8 * 1024 * 1024


class StorageError(Exception):
    pass


class NotFound(StorageError):
    pass


class Corrupt(StorageError):
    pass


class ConflictError(StorageError):
    def __init__(self, current_rev):
        super().__init__(f"stale revision, current is {current_rev}")
        self.current_rev = current_rev


def atomic_write(path: Path, data: bytes):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{secrets.token_hex(4)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise
    try:  # make the rename itself durable (POSIX)
        dfd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    except OSError:
        pass


def shred(path: Path):
    """Overwrite then delete. Best effort: SSD wear levelling and OS/cloud backups may keep traces."""
    try:
        if path.is_file():
            size = path.stat().st_size
            with open(path, "r+b") as f:
                for _ in range(2):
                    f.seek(0)
                    f.write(secrets.token_bytes(size))
                    f.flush()
                    os.fsync(f.fileno())
    except OSError:
        pass
    try:
        path.unlink()
    except OSError:
        pass


def _canon(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


def validate_payload(p):
    if not isinstance(p, dict):
        raise StorageError("payload must be an object")
    for k in ("salt", "iv", "data"):
        v = p.get(k)
        if not isinstance(v, str) or not v or len(v) > B64_MAX:
            raise StorageError(f"bad field {k}")
    kdf = p.get("kdf")
    if (not isinstance(kdf, dict) or kdf.get("name") != "PBKDF2-SHA256"
            or not isinstance(kdf.get("iter"), int) or not (100_000 <= kdf["iter"] <= 20_000_000)):
        raise StorageError("bad kdf")
    out = {"salt": p["salt"], "iv": p["iv"], "data": p["data"], "kdf": {"name": kdf["name"], "iter": kdf["iter"]}}
    ver = p.get("ver")
    if ver is not None:
        if not (isinstance(ver, dict) and isinstance(ver.get("s"), str) and isinstance(ver.get("h"), str)):
            raise StorageError("bad verifier")
        out["ver"] = {"s": ver["s"], "h": ver["h"]}
    plen = p.get("plen", 4)
    if not isinstance(plen, int) or not (4 <= plen <= 8):
        raise StorageError("bad pin length")
    out["plen"] = plen
    return out


class VaultStore:
    def __init__(self, directory: Path, max_bytes: int = B64_MAX):
        self.dir = Path(directory)
        self.main = self.dir / "vault.json"
        self.bak = self.dir / "vault.bak"
        self.max_bytes = max_bytes
        self.lock = threading.RLock()
        self.dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            os.chmod(self.dir, 0o700)
        except OSError:
            pass

    # ---- reading ----
    def _load(self, path: Path):
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            return None
        except OSError as e:
            raise Corrupt(str(e))
        try:
            env = json.loads(raw)
            if env.get("fmt") != FMT or not isinstance(env.get("rev"), int):
                raise ValueError("format")
            if hashlib.sha256(_canon(env["payload"])).hexdigest() != env.get("sum"):
                raise ValueError("checksum")
            env["payload"] = validate_payload(env["payload"])
            return env
        except (ValueError, KeyError, TypeError, StorageError) as e:
            raise Corrupt(str(e))

    def _try(self, path):
        try:
            return self._load(path)
        except Corrupt:
            return None

    def exists(self) -> bool:
        return self.main.exists() or self.bak.exists()

    def read(self):
        """-> (envelope, source, backup_envelope_or_None). Falls back to the backup if main is damaged."""
        with self.lock:
            main, bak = self._try(self.main), self._try(self.bak)
            if main:
                return main, "main", (bak if bak and bak["rev"] != main["rev"] else None)
            if bak:
                return bak, "backup", None
            if self.exists():
                raise Corrupt("vault and backup are both unreadable")
            raise NotFound("no vault")

    def rev(self) -> int:
        try:
            return self.read()[0]["rev"]
        except NotFound:
            return 0

    # ---- writing ----
    def _envelope(self, payload, rev):
        payload = validate_payload(payload)
        env = {"fmt": FMT, "rev": rev, "sum": hashlib.sha256(_canon(payload)).hexdigest(), "payload": payload}
        raw = _canon(env)
        if len(raw) > self.max_bytes:
            raise StorageError("vault too large")
        return raw

    def create(self, payload) -> int:
        with self.lock:
            if self.exists():
                raise StorageError("vault already exists")
            atomic_write(self.main, self._envelope(payload, 1))
            return 1

    def save(self, payload, base_rev: int) -> int:
        with self.lock:
            current, source, _ = self.read()
            if base_rev != current["rev"]:
                raise ConflictError(current["rev"])
            raw = self._envelope(payload, current["rev"] + 1)
            if source == "main":          # keep the last good version; never overwrite a good backup with damage
                atomic_write(self.bak, self.main.read_bytes())
            atomic_write(self.main, raw)
            return current["rev"] + 1

    def wipe(self):
        with self.lock:
            for p in (self.main, self.bak):
                shred(p)
            for p in self.dir.glob("*.tmp"):
                shred(p)
