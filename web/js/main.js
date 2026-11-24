// HER: application shell. Owns state, routing, auto-lock, quick exit. Views live in js/views/.
import { Vault } from "./vault.js";
import { t, detectLang, langInfo } from "./i18n/index.js";
import { DEFAULT_CREW, DEFAULT_DOODLES } from "./ui/crew.js";
import { esc } from "./util.js";
import { renderLock } from "./views/lock.js";
import { renderWelcome, renderOnboard } from "./views/welcome.js";
import { renderChat } from "./views/chat.js";
import { renderRights, renderHelp } from "./views/info.js";
import { renderDraft } from "./views/draft.js";
import { renderSettings } from "./views/settings.js";

const IDLE_MS = 5 * 60 * 1000, HIDDEN_MS = 60 * 1000;
const ROUTES = { welcome: renderWelcome, onboard: renderOnboard, chat: renderChat, rights: renderRights, draft: renderDraft, help: renderHelp, settings: renderSettings };
const DOCK = ["chat", "rights", "draft", "help"];
const app = document.getElementById("app"), dock = document.getElementById("dock"), sheet = document.getElementById("sheet");

const S = { lang: detectLang(navigator.languages), vault: new Vault(), data: null, status: null, llm: null, route: "lock", hero: null, busy: false, abort: null };
const ctx = {
  S, app, DEFAULT_CREW, DEFAULT_DOODLES, cleanup: null,
  t: (k, v) => t(S.lang, k, v),
  newData: () => ({ v: 2, lang: S.lang, persona: "listener", onboarded: false, msgs: [] }),
  persist: () => S.vault.save(S.data),
};

ctx.applyLang = () => { document.documentElement.lang = langInfo(S.lang).html; document.title = "HER"; };
ctx.toast = (msg) => { const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg; document.body.append(el); setTimeout(() => el.remove(), 2600); };
ctx.openSheet = (html, mount) => { sheet.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`; sheet.hidden = false; sheet.querySelectorAll("[data-close]").forEach((b) => (b.onclick = ctx.closeSheet)); mount?.(sheet.querySelector(".panel")); };
ctx.closeSheet = () => { sheet.hidden = true; sheet.innerHTML = ""; };
sheet.addEventListener("pointerdown", (e) => { if (e.target === sheet) ctx.closeSheet(); });

ctx.topbar = () => `<header class="topbar"><a class="brand" href="#" data-go="welcome"><span class="logo" aria-hidden="true">♡</span>HER</a><div class="row"><button class="chip" data-go="settings">${esc(ctx.t("settings"))}</button><button class="chip alert" id="qx">${esc(ctx.t("exit"))}</button><button class="chip" id="lk">${esc(ctx.t("lock"))}</button></div></header>`;

function paintDock() {
  const show = S.data && DOCK.includes(S.route);
  dock.hidden = !show; document.body.classList.toggle("no-dock", !show);
  if (show) dock.innerHTML = DOCK.map((r) => `<a href="#${r}" data-go="${r}" class="${r === S.route ? "on" : ""}">${esc(ctx.t(r))}</a>`).join("") + `<a class="call" href="tel:112">${esc(ctx.t("call"))}</a>`;
}

ctx.go = (route) => {
  if (!S.data) return;
  S.route = route; S.hero?.destroy(); S.hero = null; ctx.cleanup?.(); ctx.cleanup = null;
  ROUTES[route](ctx);
  paintDock(); scrollTo({ top: 0 });
  app.querySelector("#qx")?.addEventListener("click", quickExit);
  app.querySelector("#lk")?.addEventListener("click", () => ctx.lock());
};

ctx.checkModel = async () => { try { S.llm = await S.vault.llm(); } catch { S.llm = { ready: false, hint: "no_runtime" }; } };

ctx.unlocked = async (data, note, fresh = false) => {
  S.data = data; S.lang = data.lang || S.lang; ctx.applyLang();
  S.vault.onConflict = () => { ctx.toast(ctx.t("lock.conflict")); ctx.lock(); };
  S.llm = null; ctx.checkModel().then(() => { if (S.route === "chat") ctx.go("chat"); });
  ctx.go(fresh || !data.onboarded ? "welcome" : "chat");
  if (note) ctx.toast(note);
  armIdle();
};

ctx.lock = async () => {
  S.abort?.abort(); S.data = null; S.llm = null; S.route = "lock"; clearTimeout(idleT);
  await S.vault.lock(); ctx.closeSheet(); await ctx.boot();
};

ctx.boot = async (note = "") => {
  S.hero?.destroy(); S.hero = null; ctx.cleanup?.(); ctx.cleanup = null; S.route = "lock"; paintDock();
  try { S.status = await S.vault.status(); } catch { S.status = null; }
  renderLock(ctx, note);
};

/* ---------- quick exit, auto-lock ---------- */
function quickExit() {
  S.abort?.abort(); S.data = null; S.vault.lock();
  document.body.innerHTML = '<div class="cover"><h1>Weather</h1><p>Loading…</p></div>';
  location.replace("https://www.google.com/search?q=weather");
}
let idleT = 0, lastEsc = 0, hiddenAt = 0;
function armIdle() { clearTimeout(idleT); if (S.data) idleT = setTimeout(() => ctx.lock(), IDLE_MS); }
["pointerdown", "keydown", "touchstart", "scroll"].forEach((ev) => addEventListener(ev, armIdle, { passive: true }));
document.addEventListener("visibilitychange", () => { if (document.hidden) hiddenAt = Date.now(); else if (S.data && hiddenAt && Date.now() - hiddenAt > HIDDEN_MS) ctx.lock(); });
addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (!sheet.hidden) return ctx.closeSheet(); if (!S.data) return; const n = Date.now(); if (n - lastEsc < 800) quickExit(); lastEsc = n; });
document.addEventListener("click", (e) => { const g = e.target.closest("[data-go]"); if (g && S.data) { e.preventDefault(); ctx.go(g.dataset.go); } });

ctx.applyLang();
// Measure the hero wordmark only once the bundled headline font is ready (never wait long).
Promise.race([document.fonts?.load('200px "Anton"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {}).then(() => ctx.boot());
