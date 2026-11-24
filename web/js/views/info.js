// Rights (laws + complaint process) and Help (helplines + staying safe).
import { LAWS, PROCESS, HELPLINES, refLabel } from "../data/legal.js";
import { esc, em } from "../util.js";

export function renderRights(ctx) {
  const { t, app } = ctx;
  const former = t("rights.former");
  const refs = (rs) => rs.map((r) => refLabel(r, former)).join(" · ");
  app.innerHTML = `${ctx.topbar()}<h1 class="title">${em(t("rights.title"))}</h1><p class="lead">${esc(t("rights.lead"))}</p>
    <h2 class="sec">${esc(t("rights.laws"))}</h2>
    ${LAWS.map((l) => `<div class="law"><b>${esc(t(`law.${l.id}.t`))}</b><span class="ref">${esc(refs(l.refs))}</span><p>${esc(t(`law.${l.id}.d`))}</p><span class="src">${esc(t(l.status === "checked" ? "rights.checked" : "rights.general"))} · ${esc(l.source)}</span></div>`).join("")}
    <h2 class="sec">${esc(t("rights.process"))}</h2><div class="steps-l">${PROCESS.map((s) => `<div class="step"><div><b>${esc(t(`proc.${s.id}.h`))}</b><p>${esc(t(`proc.${s.id}.p`))}</p>${s.refs.length ? `<span class="src">${esc(refs(s.refs))}</span>` : ""}</div></div>`).join("")}</div>
    <p class="fine">${esc(t("rights.note"))}</p><button class="btn" data-go="draft">${esc(t("rights.draft"))}</button>`;
}

export function renderHelp(ctx) {
  const { t, app } = ctx;
  app.innerHTML = `${ctx.topbar()}<h1 class="title">${em(t("help.title"))}</h1><p class="lead">${esc(t("help.lead"))}</p>
    ${HELPLINES.map((h) => `<div class="help"><div><b>${esc(t(`help.${h.n}.n`))}</b><small>${esc(t(`help.${h.n}.d`))}</small></div><a href="tel:${h.n}" aria-label="${esc(t(`help.${h.n}.n`))} ${h.n}">${h.n}</a></div>`).join("")}
    <h2 class="sec">${esc(t("help.safe"))}</h2>${[1, 2, 3].map((n) => `<div class="step"><p>${esc(t(`help.safe${n}`))}</p></div>`).join("")}`;
}
