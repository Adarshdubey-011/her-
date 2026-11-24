// Emergency banner shown above the chat as soon as the detector fires (before any model reply).
import { esc, em } from "../util.js";
import { treatment } from "../emergency.js";

export function bannerHtml(ctx, a) {
  const { t } = ctx, tr = treatment(a);
  if (tr === "none") return "";
  if (tr === "selfharm") return `<div class="banner" role="alert"><b>${esc(t("em.selfharm.t"))}</b><p>${esc(t("em.selfharm.d"))}</p><div class="row wrap"><a class="call" href="tel:14416">${esc(t("em.call14416"))}</a><a class="call alt" href="tel:112">${esc(t("em.call112"))}</a></div></div>`;
  if (tr === "urgent") return `<div class="banner" role="alert"><b>${esc(t("em.urgent.t"))}</b><p>${esc(t("em.urgent.d"))}</p><div class="row wrap"><a class="call" href="tel:112">${esc(t("em.call112"))}</a><a class="call alt" href="tel:181">${esc(t("em.call181"))}</a></div></div>`;
  return `<div class="banner soft" role="status"><b>${esc(t("em.concern.t"))}</b><p>${esc(t("em.concern.d"))}</p><div class="row wrap"><a class="call alt" href="tel:181">${esc(t("em.call181"))}</a><a class="call alt" href="#rights" data-go="rights">${esc(t("em.seeRights"))}</a></div></div>`;
}
