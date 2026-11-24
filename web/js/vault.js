// Client side of the encrypted vault. The PIN and the encryption key NEVER leave this file / this browser.
//   PBKDF2(PIN, salt, 600k) -> 512 bits -> [0..32) "auth" (sent to the server to check the PIN) + [32..64) key material
//   HKDF(key material, salt = device pepper released by the server after a correct PIN) -> AES-256-GCM key
// The server stores only a scrypt hash of `auth`. A copied vault.json alone is useless without the pepper and the PIN.
export const KDF_ITER = 600_000;
const enc = new TextEncoder(), dec = new TextDecoder();

export const b64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKeys(pin, saltB64, iter) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: iter }, base, 512));
  return { auth: b64(bits.slice(0, 32)), km: bits.slice(32) };
}
export async function aesKey(km, pepperB64) {
  const k = await crypto.subtle.importKey("raw", km, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: unb64(pepperB64), info: enc.encode("HER vault v2") }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function seal(key, data, saltB64, iter) {
  const iv = rnd(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data))));
  return { salt: saltB64, iv: b64(iv), data: b64(ct), kdf: { name: "PBKDF2-SHA256", iter } };
}
export async function open(key, vault) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(vault.iv) }, key, unb64(vault.data));
  return JSON.parse(dec.decode(pt));
}

export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `http_${status}`); this.status = status; this.body = body || {}; }
}

export class Vault {
  constructor(fetchFn = (...a) => fetch(...a)) {
    this.fetch = fetchFn; this.token = null; this.rev = 0; this.key = null; this.meta = null; this.pepper = null;
    this.saveState = "idle"; this.onState = () => {}; this._chain = Promise.resolve(); this._latest = null; this._pending = false;
  }
  get unlocked() { return !!(this.token && this.key); }

  async api(path, { method = "GET", body, signal } = {}) {
    let res;
    try {
      res = await this.fetch(path, { method, signal, headers: { "X-HER": "1", "Content-Type": "application/json", ...(this.token ? { Authorization: "Bearer " + this.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { if (e?.name === "AbortError") throw e; throw new ApiError(0, { error: "network" }); }
    let json = {}; try { json = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw new ApiError(res.status, json);
    return json;
  }

  status() { return this.api("/api/status"); }

  async create(pin, data, { wipeAfter = true } = {}) {
    const { pepper } = await this.api("/api/setup/begin", { method: "POST", body: {} });
    const salt = b64(rnd(16));
    const { auth, km } = await deriveKeys(pin, salt, KDF_ITER);
    const key = await aesKey(km, pepper);
    const vault = await seal(key, data, salt, KDF_ITER);
    const r = await this.api("/api/setup", { method: "POST", body: { auth, vault, plen: pin.length, wipe_after: wipeAfter } });
    Object.assign(this, { token: r.token, rev: r.rev, key, pepper, meta: { salt, iter: KDF_ITER, plen: pin.length, wipeAfter } });
    return data;
  }

  /** Returns the decrypted data. Throws ApiError (401 {left}/{wiped}, 429 {locked}) for server refusals, Error("decrypt") if the data cannot be read. */
  async login(pin, kdf) {
    const { auth, km } = await deriveKeys(pin, kdf.salt, kdf.iter);
    const r = await this.api("/api/login", { method: "POST", body: { auth } });
    const key = await aesKey(km, r.pepper);
    let data;
    try { data = await open(key, r.vault); } catch { throw new Error("decrypt"); }
    Object.assign(this, { token: r.token, rev: r.rev, key, pepper: r.pepper, meta: { salt: kdf.salt, iter: r.vault.kdf.iter, plen: pin.length, wipeAfter: r.wipe_after } });
    return { data, recovered: !!r.recovered };
  }

  /** Save the latest data. Calls are serialized; only the newest data is written; transient errors retry 3 times. */
  save(data) {
    this._latest = data; this._pending = true; this._set("saving");
    this._chain = this._chain.then(() => this._flush()).catch(() => {});
    return this._chain;
  }
  async _flush() {
    if (!this._pending || !this.unlocked) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const data = this._latest; this._pending = false;
      try {
        const v = await seal(this.key, data, this.meta.salt, this.meta.iter);
        const r = await this.api("/api/vault", { method: "PUT", body: { vault: v, base_rev: this.rev } });
        this.rev = r.rev;
        if (this._pending) { attempt = -1; continue; }   // newer data arrived while writing
        return this._set("saved");
      } catch (e) {
        this._pending = true;
        if (e instanceof ApiError && (e.status === 409 || e.status === 401)) { this._set("conflict"); this.onConflict?.(e.status); return; }
        this._set("retry");
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    this._set("failed");
  }
  _set(s) { this.saveState = s; this.onState(s); }

  async changePin(oldPin, newPin, data) {
    const old = await deriveKeys(oldPin, this.meta.salt, this.meta.iter);
    const salt = b64(rnd(16));
    const nu = await deriveKeys(newPin, salt, KDF_ITER);
    const key = await aesKey(nu.km, this.pepper);
    const vault = await seal(key, data, salt, KDF_ITER);
    const r = await this.api("/api/pin", { method: "POST", body: { old_auth: old.auth, new_auth: nu.auth, vault, base_rev: this.rev, plen: newPin.length } });
    Object.assign(this, { rev: r.rev, key }); this.meta = { ...this.meta, salt, iter: KDF_ITER, plen: newPin.length };
  }
  setWipeAfter(on) { this.meta.wipeAfter = on; return this.api("/api/settings", { method: "POST", body: { wipe_after: on } }); }
  llm() { return this.api("/api/llm"); }
  async lock() { const t = this.token; this.token = null; this.key = null; this._latest = null; this._pending = false; if (t) { try { await this.fetch("/api/logout", { method: "POST", headers: { "X-HER": "1", Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: "{}", keepalive: true }); } catch { /* server already gone */ } } }
  async erase() { await this.api("/api/data", { method: "DELETE", body: { confirm: "ERASE" } }); this.token = null; this.key = null; }
}
