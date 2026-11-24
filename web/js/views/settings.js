// Settings: language, personality, security (wipe toggle, change PIN, lock, erase), local model check, About.
import { LANGS, t as tr } from "../i18n/index.js";
import { PERSONA_IDS } from "../personas.js";
import { esc } from "../util.js";
import { pinpad } from "./pin.js";
import { confirmErase } from "./lock.js";
import { aboutHtml } from "./welcome.js";
import { modelPill } from "./chat.js";
import { ApiError } from "../vault.js";

export function renderSettings(ctx) {
  const { S, t, app } = ctx;
  const d = S.data, m = S.vault.meta;
  app.innerHTML = `${ctx.topbar()}<h1 class="title">${esc(t("set.title"))}</h1>
    <h2 class="sec">${esc(t("set.language"))}</h2><div class="seg">${LANGS.map((l) => `<button type="button" data-lang="${l.id}" aria-pressed="${l.id === S.lang}">${esc(tr(l.id, "lang.name"))}</button>`).join("")}</div>
    <h2 class="sec">${esc(t("set.persona"))}</h2>${PERSONA_IDS.map((p) => `<button type="button" class="opt" data-p="${p}" aria-pressed="${d.persona === p}"><b>${esc(t(`persona.${p}.n`))}</b><small>${esc(t(`persona.${p}.b`))}</small></button>`).join("")}
    <h2 class="sec">${esc(t("set.model"))}</h2>${modelPill(ctx)}<button class="btn outline" id="rc">${esc(t("set.recheck"))}</button>
    <h2 class="sec">${esc(t("set.security"))}</h2><label class="toggle"><span>${esc(t("lock.wipeToggle"))}</span><input type="checkbox" id="wipe" ${m.wipeAfter ? "checked" : ""}></label>
    <button class="btn outline" id="cp">${esc(t("set.changePin"))}</button><button class="btn outline" id="lk">${esc(t("set.lockNow"))}</button><button class="btn outline" id="nc">${esc(t("newChat"))}</button><button class="btn danger" id="er">${esc(t("set.erase"))}</button>${aboutHtml(t)}`;
  app.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => { S.lang = d.lang = b.dataset.lang; ctx.applyLang(); ctx.persist(); renderSettings(ctx); }));
  app.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { d.persona = b.dataset.p; ctx.persist(); app.querySelectorAll("[data-p]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
  app.querySelector("#rc").onclick = async () => { await ctx.checkModel(); renderSettings(ctx); };
  app.querySelector("#wipe").onchange = async (e) => { try { await S.vault.setWipeAfter(e.target.checked); } catch { ctx.toast(t("lock.server")); e.target.checked = !e.target.checked; } };
  app.querySelector("#lk").onclick = () => ctx.lock();
  app.querySelector("#nc").onclick = () => { d.msgs = []; ctx.persist(); ctx.go("chat"); };
  app.querySelector("#er").onclick = () => confirmErase(ctx);
  app.querySelector("#cp").onclick = () => changePin(ctx);
}

function changePin(ctx) {
  const { S, t } = ctx;
  const len = S.vault.meta.plen;
  let oldPin = "", newPin = "", stage = 1, six = false, pad;
  ctx.openSheet(`<h1 class="title" id="ct"></h1><div id="pp"></div><div id="opt"></div>`, (p) => {
    const draw = () => {
      p.querySelector("#ct").textContent = t(stage === 1 ? "lock.enter" : stage === 2 ? "lock.change" : "lock.confirm");
      p.querySelector("#opt").innerHTML = stage === 2 && len === 4 ? `<label class="toggle"><span>${esc(t("lock.longer"))}</span><input type="checkbox" id="six" ${six ? "checked" : ""}></label>` : "";
      p.querySelector("#six")?.addEventListener("change", (e) => { six = e.target.checked; draw(); });
      pad?.destroy();
      const n = stage === 1 ? len : six ? 6 : len;
      pad = pinpad(p.querySelector("#pp"), { len: n, labels: { back: t("back") }, async onDone(pin) {
        if (stage === 1) { oldPin = pin; stage = 2; return draw(); }
        if (stage === 2) { newPin = pin; stage = 3; return draw(); }
        if (pin !== newPin) { stage = 2; draw(); return pad.message(t("lock.mismatch")); }
        pad.disable(true); pad.message(t("lock.checking"));
        try { await S.vault.changePin(oldPin, newPin, S.data); pad.destroy(); ctx.closeSheet(); ctx.toast(t("lock.changed")); }
        catch (e) { pad.disable(false); stage = 1; draw(); pad.message(e instanceof ApiError && e.status === 401 ? t("lock.wrong") : e instanceof ApiError && e.status === 409 ? t("lock.conflict") : t("lock.server")); }
      } });
    };
    draw();
  });
}
