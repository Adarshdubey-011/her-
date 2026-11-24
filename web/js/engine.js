// Turns a user message into a reply: emergency check -> system prompt -> streamed local model, with a clear demo fallback.
import { assess } from "./emergency.js";
import { systemPrompt } from "./personas.js";
import { t } from "./i18n/index.js";
import { findLoveReply } from "./lovebank.js";

const MAX_TURNS = 24;

/** Decide the demo reply key when no model is available. Honest, simple, and always safety-first. */
export function demoReply(lang, persona, a, text, turn = 0) {
  if (a.selfHarm) return t(lang, "demo.selfharm");
  if (a.level >= 3) return t(lang, "demo.danger");
  if (a.calm) return t(lang, "demo.calm");
  if (a.categories.includes("stalking") || a.categories.includes("harassment") || a.level === 2) return t(lang, "demo.stalk");
  if (/complain|fir|police|law|legal|rights|case|shikayat|शिकायत|कानून/i.test(text)) return t(lang, "demo.legal");
  if (a.level === 1) return t(lang, "demo.sad");
  if (persona === "love") return t(lang, `demo.love.${(turn % 3) + 1}`);
  if (persona === "guide") return t(lang, "demo.guide");
  return t(lang, "demo.light");
}

/** Messages as the model sees them: only the last turns, roles mapped. */
export const toModelMessages = (msgs) => msgs.filter((m) => m.c).slice(-MAX_TURNS).map((m) => ({ role: m.r === "me" ? "user" : "assistant", content: m.c }));

/**
 * Stream one reply. `vault` supplies api auth. Returns { text, status } where status is
 * "ok" | "aborted" | "partial" (cut off after some text) | "failed" (nothing received) | "demo".
 */
export async function reply({ vault, lang, persona, msgs, text, modelReady, onToken, signal }) {
  const history = msgs.filter((m) => m.r === "me").map((m) => m.c);   // earlier user messages (text not yet added)
  const a = assess(text, history);
  const demo = () => ({ a, text: demoReply(lang, persona, a, text, msgs.length), status: "demo" });
  // Love, playful mode only: a hard-coded question matches first; anything else goes on to the local model.
  if (persona === "love" && a.level === 0 && !a.selfHarm && !a.calm && !a.thirdParty) {
    const hit = findLoveReply(text);
    if (hit) { await new Promise((r) => setTimeout(r, 450)); return { a, text: hit, status: "bank" }; }
  }
  if (!modelReady) return demo();

  const system = systemPrompt({ persona, lang, level: a.level, selfHarm: a.selfHarm, thirdParty: a.thirdParty, calm: a.calm });
  const messages = toModelMessages([...msgs, { r: "me", c: text }]);
  let out = "";
  try {
    const res = await fetch("/api/chat", { method: "POST", signal, headers: { "X-HER": "1", "Content-Type": "application/json", Authorization: "Bearer " + vault.token }, body: JSON.stringify({ system, messages }) });
    if (!res.ok || !res.body) return a.level >= 1 ? demo() : { a, text: "", status: "failed" };
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", failed = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.t) { out += j.t; onToken?.(out); }
        if (j.error) failed = true;
      }
    }
    if (failed) return out ? { a, text: out, status: "partial" } : (a.level >= 1 ? demo() : { a, text: "", status: "failed" });
    return { a, text: out.trim(), status: out.trim() ? "ok" : "failed" };
  } catch (e) {
    if (e?.name === "AbortError") return { a, text: out.trim(), status: "aborted" };
    return out ? { a, text: out, status: "partial" } : (a.level >= 1 ? demo() : { a, text: "", status: "failed" });
  }
}
