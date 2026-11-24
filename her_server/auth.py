"""PIN verification, lockout, auto-erase, device pepper and sessions.

How a login works
- The browser stretches the PIN with PBKDF2 into two independent halves: an `auth` secret and an AES key.
  Only `auth` is sent (to 127.0.0.1). The AES key never leaves the browser.
- The server stores scrypt(auth, salt) *inside the vault file itself*, so changing the PIN and re-encrypting the
  vault is ONE atomic write: a crash can never leave "new key, old verifier".
- Attempt counting lives server-side, so a modified client cannot skip it.
- A random 32-byte "device pepper" lives in a separate file and is released only after a correct PIN. It is mixed
  into the encryption key, so a vault.json copied on its own cannot be brute-forced at all.
"""
import base64
import binascii
import hashlib
import hmac
import json
import secrets
import threading
import time
from pathlib import Path

from .storage import atomic_write, shred

WIPE_AFTER = 10
PIN_LENGTHS = range(4, 9)


def delay_for(fails: int) -> int:
    """Seconds of lockout after `fails` consecutive wrong PINs (none for the first four)."""
    return 0 if fails < 5 else min(900, 30 * (fails - 4))


def decode_auth(auth_b64) -> bytes:
    try:
        raw = base64.b64decode(auth_b64, validate=True)
    except (binascii.Error, TypeError, ValueError):
        raise ValueError("bad auth")
    if len(raw) != 32:
        raise ValueError("bad auth")
    return raw


def _scrypt(secret: bytes, salt: bytes) -> bytes:
    return hashlib.scrypt(secret, salt=salt, n=2 ** 14, r=8, p=1, dklen=32)


def make_verifier(auth_b64) -> dict:
    raw = decode_auth(auth_b64)
    salt = secrets.token_bytes(16)
    return {"s": base64.b64encode(salt).decode(), "h": base64.b64encode(_scrypt(raw, salt)).decode()}


def check_verifier(auth_b64, ver) -> bool:
    try:
        raw = decode_auth(auth_b64)
        salt, want = base64.b64decode(ver["s"]), base64.b64decode(ver["h"])
    except (ValueError, KeyError, TypeError, binascii.Error):
        return False
    return hmac.compare_digest(_scrypt(raw, salt), want)


class Sessions:
    def __init__(self, idle_s=600, clock=time.monotonic):
        self.idle, self.clock, self.lock, self._s = idle_s, clock, threading.Lock(), {}

    def issue(self) -> str:
        t = secrets.token_urlsafe(32)
        with self.lock:
            self._s[t] = self.clock() + self.idle
        return t

    def valid(self, token) -> bool:
        if not token:
            return False
        with self.lock:
            exp = self._s.get(token)
            if exp is None:
                return False
            if self.clock() > exp:
                del self._s[token]
                return False
            self._s[token] = self.clock() + self.idle   # sliding idle timeout
            return True

    def revoke(self, token):
        with self.lock:
            self._s.pop(token, None)

    def clear(self):
        with self.lock:
            self._s.clear()


class Auth:
    def __init__(self, directory: Path, on_wipe, clock=time.time):
        d = Path(directory)
        self.meta, self.pepper_path = d / "meta.json", d / "device.key"
        self.on_wipe, self.clock, self.lock = on_wipe, clock, threading.RLock()

    # ---- counters (non-secret) ----
    def _load(self):
        try:
            return json.loads(self.meta.read_text())
        except Exception:
            return {}

    def _save(self, m):
        atomic_write(self.meta, json.dumps(m).encode())

    def reset(self, wipe_after=True):
        with self.lock:
            self._save({"fails": 0, "until": 0, "wipe_after": bool(wipe_after)})

    def wipe_after(self) -> bool:
        return bool(self._load().get("wipe_after", True))

    def set_wipe_after(self, on: bool):
        with self.lock:
            m = self._load()
            m["wipe_after"] = bool(on)
            self._save(m)

    def locked_for(self) -> int:
        return max(0, int(self._load().get("until", 0) - self.clock()))

    # ---- device pepper ----
    def new_pepper(self) -> str:
        with self.lock:
            p = base64.b64encode(secrets.token_bytes(32)).decode()
            atomic_write(self.pepper_path, p.encode())
            return p

    def pepper(self):
        try:
            return self.pepper_path.read_text().strip() or None
        except OSError:
            return None

    # ---- verification ----
    def verify(self, auth_b64, ver) -> dict:
        """-> {ok} | {locked: secs} | {bad, left, locked} | {wiped}"""
        with self.lock:
            m = self._load()
            wait = int(m.get("until", 0) - self.clock())
            if wait > 0:
                return {"locked": wait}
            if check_verifier(auth_b64, ver):
                if m.get("fails") or m.get("until"):
                    m["fails"], m["until"] = 0, 0
                    self._save(m)
                return {"ok": True}
            m["fails"] = m.get("fails", 0) + 1
            wipe = bool(m.get("wipe_after", True))
            if wipe and m["fails"] >= WIPE_AFTER:
                self.on_wipe()
                return {"wiped": True}
            m["until"] = self.clock() + delay_for(m["fails"])
            self._save(m)
            return {"bad": True, "left": (WIPE_AFTER - m["fails"]) if wipe else None,
                    "locked": delay_for(m["fails"])}

    def wipe(self):
        with self.lock:
            shred(self.meta)
            shred(self.pepper_path)
