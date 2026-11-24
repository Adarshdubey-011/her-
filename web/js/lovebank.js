// Love personality: look the user's message up in the hard-coded bank (data/love_qna.js) before asking the local model.
import { LOVE_QNA } from "./data/love_qna.js";

const SAME = 0.88, CLOSE = 0.8;          // similarity needed: near-identical text / mostly the same words

/** Lowercase, unify quotes, drop punctuation and emoji, collapse spaces (keeps letters and digits of any script). */
export const norm = (s) => String(s ?? "").toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/'/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const bigrams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
/** Dice coefficient on character bigrams: 1 = identical, 0 = nothing in common. */
export function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b); let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) || 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}
const jaccard = (a, b) => { const A = new Set(a.split(" ")), B = new Set(b.split(" ")); let i = 0; for (const w of A) if (B.has(w)) i++; return i / (A.size + B.size - i); };

const BANK = LOVE_QNA.map(([style, q, a]) => ({ style, q, a, n: norm(q), words: norm(q).split(" ").length }));

/** Best bank entry for `text`, or null. Matches: same text, near-same text (typos), or the full question inside a longer message. */
export function findLoveReply(text, rand = Math.random) {
  const n = norm(text);
  if (n.length < 3) return null;
  let best = 0, picks = [];
  for (const e of BANK) {
    let s = dice(n, e.n);
    if (s < SAME && jaccard(n, e.n) >= CLOSE && Math.abs(n.length - e.n.length) <= 6) s = SAME;               // same words, small edits
    if (s < SAME && e.words >= 3 && n.length <= e.n.length * 2 + 12 && ` ${n} `.includes(` ${e.n} `)) s = SAME;  // question quoted inside a short message
    if (s < SAME) continue;
    if (s > best + 1e-9) { best = s; picks = [e]; } else if (Math.abs(s - best) <= 1e-9) picks.push(e);
  }
  return picks.length ? picks[Math.floor(rand() * picks.length)].a : null;
}
