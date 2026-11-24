// Seven languages. English is the source of truth; every other file must define exactly the same keys.
import en from "./en.js";
import hi from "./hi.js";
import hn from "./hn.js";
import mr from "./mr.js";
import bn from "./bn.js";
import ta from "./ta.js";
import te from "./te.js";

export const DICTS = { en, hi, hn, mr, bn, ta, te };

/** `model` is how the language is named to the AI model; `html` is the lang attribute. */
export const LANGS = [
  { id: "en", html: "en", model: "English" },
  { id: "hi", html: "hi", model: "Hindi in Devanagari script" },
  { id: "hn", html: "en", model: "Hinglish: Hindi written in Roman (English) letters, mixed naturally with English words" },
  { id: "mr", html: "mr", model: "Marathi in Devanagari script" },
  { id: "bn", html: "bn", model: "Bengali in Bengali script" },
  { id: "ta", html: "ta", model: "Tamil in Tamil script" },
  { id: "te", html: "te", model: "Telugu in Telugu script" },
];
export const LANG_IDS = LANGS.map((l) => l.id);
export const langInfo = (id) => LANGS.find((l) => l.id === id) || LANGS[0];

/** Translate. Falls back to English, then to the key itself, so a gap never shows a blank. */
export function t(lang, key, vars) {
  let s = (DICTS[lang] && DICTS[lang][key]) ?? DICTS.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Pick a starting language from the browser (before login there is no saved preference, by design). */
export function detectLang(preferred) {
  for (const raw of preferred || []) {
    const code = String(raw).toLowerCase().split("-")[0];
    if (DICTS[code] && code !== "hn") return code;
  }
  return "en";
}

/** Keys present in `base` but missing from `other`, and keys `other` has that `base` lacks. */
export function diffKeys(base, other) {
  const b = Object.keys(base), o = new Set(Object.keys(other));
  return { missing: b.filter((k) => !o.has(k)), extra: [...o].filter((k) => !(k in base)) };
}
