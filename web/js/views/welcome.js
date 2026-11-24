// Home hero (the giant HER wordmark with its crew), the one-time onboarding (language, personality) and the About description.
import { mountHero } from "../ui/crew.js";
import { LANGS, t as tr } from "../i18n/index.js";
import { PERSONA_IDS } from "../personas.js";
import { esc, em } from "../util.js";
import { crewFor } from "./lock.js";

export const aboutHtml = (t) => `<section class="about"><span class="brand"><span class="logo" aria-hidden="true">♡</span>HER</span><p>${esc(t("about.d"))}</p><p class="fine">${esc(t("fine"))}</p></section>`;

export function renderWelcome(ctx) {
  const { S, t, app } = ctx;
  app.innerHTML = `${ctx.topbar()}<div id="hero"></div><p class="lead center">${esc(t("lead"))}</p><p class="pill" style="justify-content:center"><i></i>${esc(t("priv.local"))}</p>${aboutHtml(t)}`;
  S.hero?.destroy();
  S.hero = mountHero(app.querySelector("#hero"), {
    word: "HER", tagline: t("tagline"), crew: crewFor(t, ctx.DEFAULT_CREW), doodles: ctx.DEFAULT_DOODLES, doodleCount: 10,
    actions: [{ id: "begin", label: S.data.onboarded ? t("chat") : t("start"), icon: "heart", variant: "solid" }, { id: "how", label: t("howItWorks"), icon: "sparkle", variant: "outline" }],
    onAction(id) { if (id === "begin") ctx.go(S.data.onboarded ? "chat" : "onboard"); else ctx.openSheet(`<h1 class="title">${esc(t("about.t"))}</h1><p class="lead">${esc(t("about.d"))}</p><p class="pill"><i></i>${esc(t("priv.local"))}</p><button class="btn" data-close>${esc(t("ok"))}</button>`); },
  });
}

export function renderOnboard(ctx, step = 1) {
  const { S, t, app } = ctx;
  const steps = `<div class="steps"><i class="on"></i><i class="${step === 2 ? "on" : ""}"></i></div>`;
  if (step === 1) {
    app.innerHTML = `${ctx.topbar()}${steps}<h1 class="title">${esc(t("pickLang"))}</h1><div class="seg">${LANGS.map((l) => `<button type="button" data-lang="${l.id}" aria-pressed="${l.id === S.lang}">${esc(tr(l.id, "lang.name"))}</button>`).join("")}</div><button class="btn" id="n">${esc(t("next"))}</button>`;
    app.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => { S.lang = S.data.lang = b.dataset.lang; ctx.applyLang(); renderOnboard(ctx, 1); }));
    app.querySelector("#n").onclick = () => renderOnboard(ctx, 2);
  } else {
    app.innerHTML = `${ctx.topbar()}${steps}<h1 class="title">${esc(t("pickPersona"))}</h1>${PERSONA_IDS.map((p) => `<button type="button" class="opt" data-p="${p}" aria-pressed="${S.data.persona === p}"><b>${esc(t(`persona.${p}.n`))}${p === "love" ? `<span class="tag">${esc(t("persona.love.tag"))}</span>` : ""}</b><small>${esc(t(`persona.${p}.b`))}</small></button>`).join("")}<button class="btn" id="n">${esc(t("next"))}</button>`;
    app.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { S.data.persona = b.dataset.p; app.querySelectorAll("[data-p]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
    app.querySelector("#n").onclick = () => { S.data.onboarded = true; S.data.msgs = []; ctx.persist(); ctx.go("chat"); };
  }
}
