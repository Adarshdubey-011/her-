import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DICTS, LANG_IDS, t, detectLang } from "../../web/js/i18n/index.js";
import { LAWS, PROCESS, HELPLINES, lawsFor } from "../../web/js/data/legal.js";
import { buildDraft } from "../../web/js/views/draft.js";
import { systemPrompt } from "../../web/js/personas.js";
import { demoReply } from "../../web/js/engine.js";
import { assess } from "../../web/js/emergency.js";
import { hash, clamp, layoutWord, lookAt, stepFloater } from "../../web/js/ui/crew.js";
import { deriveKeys, aesKey, seal, open, b64, Vault } from "../../web/js/vault.js";

const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();

test("i18n: every language has exactly the English keys, same placeholders, no empties", () => {
  const en = DICTS.en;
  for (const id of LANG_IDS) {
    const d = DICTS[id];
    assert.deepEqual(Object.keys(en).filter((k) => !(k in d)), [], `${id} missing`);
    assert.deepEqual(Object.keys(d).filter((k) => !(k in en)), [], `${id} extra`);
    for (const k of Object.keys(en)) { assert.ok(String(d[k]).trim(), `${id}.${k} empty`); assert.equal(ph(d[k]), ph(en[k]), `${id}.${k} placeholders`); }
  }
});
test("i18n: fallback and detection", () => { assert.equal(t("xx", "send"), "Send"); assert.equal(t("en", "nope"), "nope"); assert.equal(detectLang(["hi-IN"]), "hi"); assert.equal(detectLang(["fr"]), "en"); });
test("legal: every law, step and helpline has text in every language", () => {
  for (const id of LANG_IDS) {
    for (const l of LAWS) { assert.ok(DICTS[id][`law.${l.id}.t`] && DICTS[id][`law.${l.id}.d`], `${id} law ${l.id}`); }
    for (const p of PROCESS) assert.ok(DICTS[id][`proc.${p.id}.h`] && DICTS[id][`proc.${p.id}.p`]);
    for (const h of HELPLINES) assert.ok(DICTS[id][`help.${h.n}.n`] && DICTS[id][`help.${h.n}.d`]);
  }
});
test("legal: data integrity", () => {
  for (const l of LAWS) { assert.ok(["checked", "general"].includes(l.status)); assert.ok(l.refs.length && l.source); }
  assert.equal(new Set(LAWS.map((l) => l.id)).size, LAWS.length);
  assert.ok(lawsFor(["stalking"]).includes("stalking"));
  assert.ok(HELPLINES.some((h) => h.n === "112") && !HELPLINES.some((h) => h.n === "1091"));
});
test("draft: contains inputs, no section numbers", () => {
  const d = buildDraft({ to: "police", lang: "en", name: "Asha", what: "He follows me", ev: ["shots"] });
  assert.match(d, /Asha/); assert.match(d, /He follows me/); assert.match(d, /Screenshots/); assert.ok(!/\bBNS\b|\bIPC\b|section/i.test(d));
  assert.match(buildDraft({ to: "posh", lang: "hi", what: "x" }), /आंतरिक समिति/);
});
test("personas: Love switches to serious mode; safety alerts included", () => {
  const play = systemPrompt({ persona: "love", level: 0 }), ser = systemPrompt({ persona: "love", level: 3, selfHarm: true });
  assert.match(play, /PLAYFUL MODE/); assert.match(ser, /SERIOUS MODE/); assert.ok(!/PLAYFUL MODE/.test(ser)); assert.match(ser, /112/); assert.match(ser, /14416/);
  for (const p of ["listener", "friend", "guide", "calm"]) assert.match(systemPrompt({ persona: p, lang: "hn" }), /Hinglish/);
});
test("engine: demo fallback is safety-first in every language", () => {
  for (const id of LANG_IDS) {
    const a = assess("he will kill me"), s = assess("I want to kill myself");
    assert.match(demoReply(id, "love", a, "he will kill me"), /112/); assert.match(demoReply(id, "love", s, "x"), /14416/);
  }
});
test("crew: pure helpers", () => {
  assert.equal(hash(1), hash(1)); assert.equal(clamp(5, 0, 3), 3);
  const l = layoutWord([10, 20], 0.1, 100); assert.deepEqual(l.x, [0, 20]); assert.equal(l.width, 40);
  assert.deepEqual(lookAt(0, 0, 0, 0, 3, 100), { x: 0, y: 0 }); assert.ok(Math.hypot(...Object.values(lookAt(0, 0, 300, 0, 3, 100))) <= 3.0001);
  const f = { x: 5, y: 5, vx: 0, vy: 0, rot: 0, vr: 0, fall: 10, phase: 0, pop: 0 }; stepFloater(f, 0.05, 0, 100, 100, NaN, NaN, 0, Math.random); assert.ok(f.y > 5);
});
test("crypto: roundtrip, wrong PIN fails, wrong pepper fails, ciphertext hides data", async () => {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16))), pep = b64(crypto.getRandomValues(new Uint8Array(32))), iter = 1000;
  const a = await deriveKeys("1234", salt, iter), key = await aesKey(a.km, pep);
  const v = await seal(key, { msgs: [{ c: "secret words" }] }, salt, iter);
  assert.ok(!JSON.stringify(v).includes("secret"));
  assert.deepEqual(await open(key, v), { msgs: [{ c: "secret words" }] });
  const bad = await deriveKeys("1235", salt, iter); assert.notEqual(bad.auth, a.auth);
  await assert.rejects(open(await aesKey(bad.km, pep), v));
  await assert.rejects(open(await aesKey(a.km, b64(new Uint8Array(32))), v));
  assert.notEqual(a.auth, b64(a.km));
});
test("vault client: save queue retries then reports failure; conflict is reported", async () => {
  let calls = 0; const states = [];
  const v = new Vault(async () => { calls++; return { ok: false, status: 500, json: async () => ({}) }; });
  const salt = b64(new Uint8Array(16)); v.token = "t"; v.rev = 1; v.meta = { salt, iter: 1000 };
  v.key = await aesKey((await deriveKeys("1234", salt, 1000)).km, b64(new Uint8Array(32))); v.onState = (s) => states.push(s);
  await v.save({ a: 1 }); assert.equal(calls, 3); assert.equal(v.saveState, "failed");
  let conflict = 0; const v2 = new Vault(async () => ({ ok: false, status: 409, json: async () => ({ error: "conflict" }) }));
  Object.assign(v2, { token: "t", rev: 1, meta: v.meta, key: v.key }); v2.onConflict = () => conflict++; await v2.save({ a: 1 }); assert.equal(conflict, 1);
});
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
test("privacy: web code has no localStorage, no external URLs, no remote fetches, no eval", () => {
  for (const f of walk("web").filter((f) => /\.(js|html|css)$/.test(f))) {
    const s = readFileSync(f, "utf8");
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function|sendBeacon|XMLHttpRequest|WebSocket/.test(s), `${f} uses forbidden API`);
    const urls = (s.match(/https?:\/\/[^\s"'`)<]+/g) || []).filter((u) => !/www\.w3\.org|google\.com\/search\?q=weather/.test(u));
    assert.deepEqual(urls, [], `${f} references external URL`);
    for (const m of s.matchAll(/fetch\(\s*([^,)]+)/g)) assert.ok(/^["'`]\/api|path|this\.fetch|^\.\.\.a$/.test(m[1].trim()) || /\/api\//.test(m[1]), `${f} fetch(${m[1]})`);
  }
});
test("privacy: index.html loads only local scripts", () => {
  const h = readFileSync("web/index.html", "utf8");
  for (const m of h.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(!/^https?:/.test(m[1]), m[1]);
});
