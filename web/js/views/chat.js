// The conversation. The emergency banner appears BEFORE the model answers. Replies stream, can be stopped, and a cut-off is shown honestly.
import { assess } from "../emergency.js";
import { reply } from "../engine.js";
import { isSerious } from "../personas.js";
import { esc } from "../util.js";
import { bannerHtml } from "./banner.js";

const MAX_MSGS = 500;
const SEND = '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-3-7z"/></svg>', STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

export const modelPill = (ctx) => {
  const { S, t } = ctx, l = S.llm;
  if (!l) return `<p class="pill warn"><i></i>${esc(t("priv.checking"))}</p>`;
  if (l.ready) return `<p class="pill"><i></i><span>${esc(t("priv.model", { model: "" }))}<code>${esc(l.model)}</code></span></p>`;
  const key = l.hint === "no_runtime" ? "priv.noRuntime" : l.hint ? "priv.noGemma" : "priv.demo";
  return `<p class="pill warn"><i></i>${esc(t(key))}</p>`;
};

const paras = (c) => String(c).split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

export function renderChat(ctx) {
  const { S, t, app } = ctx;
  const d = S.data;
  app.innerHTML = `${ctx.topbar()}<section class="chat"><div class="chat-head"><div class="who">${esc(t(`persona.${d.persona}.n`))}<small>${esc(t("chat"))}</small></div><span class="savestate" id="ss"></span></div>
    ${modelPill(ctx)}<div id="banner"></div><div class="log" id="log" aria-live="polite"></div><div class="sugg" id="sugg"></div>
    <form class="composer" id="f"><textarea id="ta" rows="1" maxlength="4000" placeholder="${esc(t("placeholder"))}" aria-label="${esc(t("placeholder"))}"></textarea><button class="send" id="sb" type="submit" aria-label="${esc(t("send"))}">${SEND}</button></form></section>`;
  const log = app.querySelector("#log"), ta = app.querySelector("#ta"), sb = app.querySelector("#sb"), banner = app.querySelector("#banner"), sugg = app.querySelector("#sugg");
  const scroll = () => scrollTo({ top: document.body.scrollHeight });
  const add = (m) => { const el = document.createElement("div"); el.className = `m ${m.r}${m.s && m.r === "her" ? " serious" : ""}`; el.innerHTML = m.r === "me" ? esc(m.c) : paras(m.c) + (m.cut ? `<span class="note">${esc(t("chat.cut"))}</span>` : ""); log.append(el); return el; };
  const setBusy = (b) => { S.busy = b; sb.innerHTML = b ? STOP : SEND; sb.classList.toggle("stop", b); sb.setAttribute("aria-label", t(b ? "stop" : "send")); };
  const savestate = (s) => { const el = app.querySelector("#ss"); if (!el) return; el.className = "savestate" + (s === "failed" || s === "retry" ? " bad" : ""); el.textContent = { saving: t("chat.saving"), saved: t("chat.saved"), retry: t("chat.notsaved"), failed: t("chat.notsaved") }[s] || ""; };
  S.vault.onState = savestate; savestate(S.vault.saveState);

  if (!d.msgs.length) add({ r: "her", c: t(`hello.${d.persona}`) });
  d.msgs.forEach(add);
  if (!d.msgs.length) sugg.innerHTML = [1, 2, 3, 4].map((n) => `<button type="button">${esc(t(`sugg.${n}`))}</button>`).join("");
  sugg.querySelectorAll("button").forEach((b) => (b.onclick = () => send(b.textContent)));
  const last = d.msgs.filter((m) => m.r === "me").map((m) => m.c);
  if (last.length) banner.innerHTML = bannerHtml(ctx, assess(last.at(-1), last.slice(0, -1)));
  scroll();

  async function send(text) {
    text = text.trim();
    if (!text || S.busy) return;
    sugg.innerHTML = ""; ta.value = ""; ta.style.height = "";
    const history = d.msgs.slice();
    const a0 = assess(text, history.filter((m) => m.r === "me").map((m) => m.c));
    banner.innerHTML = bannerHtml(ctx, a0);                      // safety first: before any model work
    const me = { r: "me", c: text }; d.msgs.push(me); add(me);
    const serious = isSerious(a0.level);
    const bubble = add({ r: "her", c: "", s: serious }); bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    scroll(); setBusy(true);
    S.abort = new AbortController();
    const r = await reply({ vault: S.vault, lang: S.lang, persona: d.persona, msgs: history, text, modelReady: S.llm?.ready, signal: S.abort.signal, onToken: (full) => { bubble.innerHTML = paras(full); scroll(); } });
    setBusy(false); S.abort = null;
    if (!r.text) {
      bubble.remove();
      if (r.status === "failed") { const n = add({ r: "her", c: t("chat.fail") }); n.classList.add("serious"); }
    } else {
      const m = { r: "her", c: r.text, s: serious, cut: r.status === "partial" || r.status === "aborted" };
      d.msgs.push(m); bubble.className = `m her${serious ? " serious" : ""}`; bubble.innerHTML = paras(m.c) + (m.cut ? `<span class="note">${esc(t("chat.cut"))}</span>` : "");
    }
    if (d.msgs.length > MAX_MSGS) d.msgs.splice(0, d.msgs.length - MAX_MSGS);
    ctx.persist(); scroll(); ta.focus();
  }
  app.querySelector("#f").onsubmit = (e) => { e.preventDefault(); if (S.busy) S.abort?.abort(); else send(ta.value); };
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!S.busy) send(ta.value); } });
  ta.focus();
}
