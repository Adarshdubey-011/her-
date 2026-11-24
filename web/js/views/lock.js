// Lock screen: first-time PIN creation, PIN entry, and every failure state (wrong PIN, lockout, wiped, unreadable, server down).
import { mountHero } from "../ui/crew.js";
import { LANGS, t as tr } from "../i18n/index.js";
import { esc, em } from "../util.js";
import { pinpad } from "./pin.js";
import { ApiError } from "../vault.js";

export const crewFor = (t, crew) => crew.map((c) => ({ ...c, says: t(`crew.${c.kind}`) }));

export function langSeg(S, rerender) {
  return `<div class="seg tabs-lang" role="group" aria-label="Language">${LANGS.map((l) => `<button type="button" data-lang="${l.id}" aria-pressed="${l.id === S.lang}">${esc(tr(l.id, "lang.name"))}</button>`).join("")}</div>`;
}

let passed = false; // has "Continue" been pressed on this lock screen
export function renderLock(ctx, note = "", gate = true) {
  const { S, t, app } = ctx;
  const st = S.status;
  if (gate) passed = false;
  app.innerHTML = `<div class="lockbox"><div id="hero"></div><div class="center"><span class="eyebrow">${esc(st?.configured ? t("lock.locked") : t("lock.first"))}</span></div>
    <div id="lockbody"></div>${langSeg(S)}<p class="fine center">${esc(t("fine"))}</p></div>`;
  S.hero?.destroy();
  S.hero = mountHero(app.querySelector("#hero"), { word: "HER", compact: true, doodleCount: 6, crew: crewFor(t, ctx.DEFAULT_CREW), doodles: ctx.DEFAULT_DOODLES });
  app.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => { S.lang = b.dataset.lang; document.documentElement.lang = LANGS.find((l) => l.id === S.lang).html; renderLock(ctx, "", !passed); }));
  const body = app.querySelector("#lockbody");
  if (!st) return noServer(ctx, body);
  if (st.corrupt) return corrupt(ctx, body);
  const proceed = () => (passed = true, st.configured ? enter(ctx, body, st, note) : create(ctx, body, note));
  if (passed && !gate) return proceed();
  return splash(ctx, body, proceed);
}

// First screen: just a Continue button. The PIN (create or enter) is asked only after it is pressed.
function splash(ctx, body, proceed) {
  const { t } = ctx;
  body.innerHTML = `<div class="splash"><p class="lead">${esc(t("lead"))}</p><button class="btn" id="go">${esc(t("next"))}</button></div>`;
  const go = body.querySelector("#go");
  go.onclick = proceed;
  go.focus({ preventScroll: true });
}

function noServer(ctx, body) {
  const { t } = ctx;
  body.innerHTML = `<h1 class="title center">${t("lock.noserver.t")}</h1><p class="lead center">${esc(t("lock.noserver.d"))}</p><button class="btn" id="retry">${esc(t("next"))}</button>`;
  body.querySelector("#retry").onclick = () => ctx.boot();
}

function corrupt(ctx, body) {
  const { t } = ctx;
  body.innerHTML = `<p class="lead center">${esc(t("lock.corrupt"))}</p><button class="btn danger" id="er">${esc(t("lock.forgot"))}</button>`;
  body.querySelector("#er").onclick = () => confirmErase(ctx);
}

export function confirmErase(ctx) {
  const { t } = ctx;
  ctx.openSheet(`<h1 class="title">${esc(t("set.erase"))}</h1><p class="lead">${esc(t("set.eraseSure"))}</p><div class="btnrow"><button class="btn outline" data-close>${esc(t("cancel"))}</button><button class="btn danger" id="go">${esc(t("set.erase"))}</button></div>`, (p) => {
    p.querySelector("#go").onclick = async () => {
      try { await ctx.S.vault.erase(); } catch { /* nothing to erase, or server gone */ }
      ctx.closeSheet(); ctx.S.data = null; await ctx.boot(t("set.erased"));
    };
  });
}

function enter(ctx, body, st, note) {
  const { S, t } = ctx;
  body.innerHTML = `<h1 class="title center">${esc(t("lock.enter"))}</h1><div id="pp"></div><div class="center"><button class="linkbtn" id="forgot">${esc(t("lock.forgot"))}</button></div>`;
  let timer = 0, pad;
  const wait = (s) => { clearInterval(timer); let left = Math.ceil(s); pad.disable(true); const tick = () => { if (left <= 0) { clearInterval(timer); pad.disable(false); pad.reset(""); return; } pad.message(t("lock.wait", { s: left })); left--; }; tick(); timer = setInterval(tick, 1000); };
  body.querySelector("#forgot").onclick = () => confirmErase(ctx);
  pad = pinpad(body.querySelector("#pp"), {
    len: st.pin_len, labels: { back: t("back") },
    async onDone(pin) {
      pad.disable(true); pad.message(t("lock.checking"));
      try {
        const { data, recovered } = await S.vault.login(pin, st.kdf);
        clearInterval(timer); pad.destroy();
        await ctx.unlocked(data, recovered ? t("lock.recovered") : "");
      } catch (e) {
        pad.disable(false);
        if (e instanceof ApiError) {
          if (e.body.wiped) { clearInterval(timer); pad.destroy(); return ctx.boot(t("lock.wiped")); }
          if (e.status === 429 && e.body.locked) return wait(e.body.locked);
          if (e.status === 401) { const left = e.body.left; pad.reset(t("lock.wrong") + (left != null && left <= 5 ? " " + t("lock.left", { n: left }) : "")); if (e.body.locked) wait(e.body.locked); return; }
          pad.reset(e.status === 0 ? t("lock.server") : t("lock.corrupt"));
        } else pad.reset(t("lock.corrupt"));
      }
    },
  });
  if (note) pad.message(note);
  if (st.locked > 0) wait(st.locked);
  ctx.cleanup = () => { clearInterval(timer); pad.destroy(); };
}

function create(ctx, body, note) {
  const { S, t } = ctx;
  let len = 4, wipe = true, first = null, pad;
  const draw = (stage) => {
    body.innerHTML = `<h1 class="title center">${esc(stage === 1 ? t("lock.create") : t("lock.confirm"))}</h1>
      ${stage === 1 ? `<p class="lead center">${esc(t("lock.intro"))}</p>` : ""}<div id="pp"></div>
      ${stage === 1 ? `<label class="toggle"><span>${esc(t("lock.longer"))}</span><input type="checkbox" id="six" ${len === 6 ? "checked" : ""}></label>
      <label class="toggle"><span>${esc(t("lock.wipeToggle"))}</span><input type="checkbox" id="wipe" ${wipe ? "checked" : ""}></label>` : ""}`;
    if (stage === 1) {
      body.querySelector("#six").onchange = (e) => { len = e.target.checked ? 6 : 4; draw(1); };
      body.querySelector("#wipe").onchange = (e) => { wipe = e.target.checked; };
    }
    pad?.destroy();
    pad = pinpad(body.querySelector("#pp"), { len, labels: { back: t("back") }, async onDone(pin) {
      if (stage === 1) { first = pin; return draw(2); }
      if (pin !== first) { first = null; draw(1); pad.message(t("lock.mismatch")); return; }
      pad.disable(true); pad.message(t("lock.checking"));
      try {
        const data = ctx.newData();
        await S.vault.create(pin, data, { wipeAfter: wipe });
        pad.destroy(); await ctx.unlocked(data, "", true);
      } catch (e) { pad.disable(false); pad.reset(e instanceof ApiError && e.status === 0 ? t("lock.server") : t("lock.corrupt")); }
    } });
    if (stage === 1 && note) pad.message(note);
  };
  draw(1);
  ctx.cleanup = () => pad?.destroy();
}
