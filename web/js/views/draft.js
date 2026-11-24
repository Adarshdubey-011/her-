// Complaint draft generator. Templates in English and Hindi only (letters are usually submitted in one of those; user can edit).
// The letter deliberately quotes NO section numbers: the police/committee apply the law, and a wrong number would hurt more than none.
import { esc, em } from "../util.js";

const L = {
  en: {
    to: { police: "The Station House Officer,\n[Name of Police Station]", posh: "The Presiding Officer,\nInternal Committee (POSH),\n[Name of organisation]", cyber: "The Officer-in-Charge,\nCyber Crime Cell,\n[City / District]" },
    subject: "Subject: Complaint regarding harassment / offence against me", dear: "Respectfully,", intro: (n) => `I, ${n || "[Your name]"}, wish to make the following complaint.`,
    date: "Date of incident", place: "Place", what: "What happened", accused: "Person complained against", ev: "Evidence I have", wit: "Witnesses", none: "—",
    ask: "I request that this complaint be registered, that I be given a free copy / acknowledgement, that my identity be kept confidential as far as the law allows, and that appropriate action be taken.",
    sign: "Yours faithfully,", sigline: (n) => `${n || "[Your name]"}\n[Phone / contact, if you wish]\nDate: ____________`,
    ev_: { shots: "Screenshots", calls: "Call logs", voice: "Voice notes", media: "Photos / videos", medical: "Medical report", wit: "Witnesses" },
  },
  hi: {
    to: { police: "थाना प्रभारी,\n[थाने का नाम]", posh: "अध्यक्ष,\nआंतरिक समिति (POSH),\n[संस्था का नाम]", cyber: "प्रभारी अधिकारी,\nसाइबर क्राइम सेल,\n[शहर / जिला]" },
    subject: "विषय: मेरे विरुद्ध उत्पीड़न / अपराध की शिकायत", dear: "सादर,", intro: (n) => `मैं, ${n || "[आपका नाम]"}, निम्नलिखित शिकायत दर्ज कराना चाहती हूँ।`,
    date: "घटना की तारीख", place: "स्थान", what: "क्या हुआ", accused: "जिसके विरुद्ध शिकायत है", ev: "मेरे पास सबूत", wit: "गवाह", none: "—",
    ask: "मेरा अनुरोध है कि इस शिकायत को दर्ज किया जाए, मुझे निःशुल्क प्रति / पावती दी जाए, कानून के अनुसार मेरी पहचान गोपनीय रखी जाए और उचित कार्रवाई की जाए।",
    sign: "भवदीय,", sigline: (n) => `${n || "[आपका नाम]"}\n[फ़ोन / संपर्क, यदि चाहें]\nदिनांक: ____________`,
    ev_: { shots: "स्क्रीनशॉट", calls: "कॉल लॉग", voice: "वॉइस नोट", media: "फोटो / वीडियो", medical: "मेडिकल रिपोर्ट", wit: "गवाह" },
  },
};

/** f = {to, lang, name, date, place, what, accused, ev:[keys], witness} -> plain-text letter */
export function buildDraft(f) {
  const x = L[f.lang] || L.en;
  const ev = (f.ev || []).map((k) => x.ev_[k]).filter(Boolean).join(", ") || x.none;
  const line = (k, v) => `${k}: ${String(v || "").trim() || x.none}`;
  return [x.to[f.to] || x.to.police, "", x.subject, "", x.dear, x.intro(String(f.name || "").trim()), "",
    line(x.date, f.date), line(x.place, f.place), "", `${x.what}:`, String(f.what || "").trim() || x.none, "",
    line(x.accused, f.accused), line(x.ev, ev), line(x.wit, f.witness), "", x.ask, "", x.sign, x.sigline(String(f.name || "").trim())].join("\n");
}

export function renderDraft(ctx) {
  const { S, t, app } = ctx;
  const keys = ["shots", "calls", "voice", "media", "medical"];
  app.innerHTML = `${ctx.topbar()}<h1 class="title">${em(t("draft.title"))}</h1><p class="lead">${esc(t("draft.lead"))}</p>
    <label class="f" for="to">${esc(t("draft.to"))}</label><select id="to"><option value="police">${esc(t("draft.to.police"))}</option><option value="posh">${esc(t("draft.to.posh"))}</option><option value="cyber">${esc(t("draft.to.cyber"))}</option></select>
    <label class="f" for="name">${esc(t("draft.name"))}</label><input type="text" id="name" autocomplete="off">
    <label class="f" for="date">${esc(t("draft.date"))}</label><input type="date" id="date">
    <label class="f" for="place">${esc(t("draft.place"))}</label><input type="text" id="place" autocomplete="off">
    <label class="f" for="what">${esc(t("draft.what"))}</label><textarea class="t" id="what"></textarea>
    <label class="f" for="accused">${esc(t("draft.accused"))}</label><input type="text" id="accused" autocomplete="off">
    <label class="f">${esc(t("draft.ev"))}</label>${keys.map((k) => `<label class="toggle"><span>${esc(t(`draft.ev.${k}`))}</span><input type="checkbox" data-ev="${k}"></label>`).join("")}
    <label class="f" for="wit">${esc(t("draft.witness"))}</label><input type="text" id="wit" autocomplete="off">
    <label class="f" for="ll">${esc(t("draft.letterLang"))}</label><select id="ll"><option value="en">English</option><option value="hi">हिन्दी</option></select>
    <button class="btn" id="mk">${esc(t("draft.create"))}</button><div id="out"></div><p class="fine">${esc(t("draft.note"))}</p>`;
  app.querySelector("#ll").value = S.lang === "hi" ? "hi" : "en";
  const v = (id) => app.querySelector("#" + id).value;
  app.querySelector("#mk").onclick = () => {
    const text = buildDraft({ to: v("to"), lang: v("ll"), name: v("name"), date: v("date"), place: v("place"), what: v("what"), accused: v("accused"), witness: v("wit"), ev: [...app.querySelectorAll("[data-ev]:checked")].map((c) => c.dataset.ev) });
    const out = app.querySelector("#out");
    out.innerHTML = `<h2 class="sec">${esc(t("draft.yours"))}</h2><pre class="out">${esc(text)}</pre><div class="btnrow"><button class="btn outline" id="cp">${esc(t("draft.copy"))}</button><button class="btn outline" id="dl">${esc(t("draft.download"))}</button></div>`;
    out.querySelector("#cp").onclick = async () => { try { await navigator.clipboard.writeText(text); ctx.toast(t("draft.copied")); } catch { ctx.toast(t("draft.copy")); } };
    out.querySelector("#dl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })); a.download = "complaint-draft.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    out.scrollIntoView({ behavior: "smooth" });
  };
}
