import test from "node:test";
import assert from "node:assert/strict";
import { findLoveReply, norm } from "../../web/js/lovebank.js";
import { LOVE_QNA } from "../../web/js/data/love_qna.js";
import { reply } from "../../web/js/engine.js";

test("love bank: 150 entries, every question finds a reply of its own", () => {
  assert.equal(LOVE_QNA.length, 150);
  for (const [, q, a] of LOVE_QNA) assert.ok(findLoveReply(q, () => 0), q), assert.ok(a.length > 3);
});
test("love bank: ignores case, punctuation, curly quotes and small typos", () => {
  assert.match(findLoveReply("GOOD NIGHT!!"), /sleep/i);
  assert.match(findLoveReply("Im going"), /Don't trip/);
  assert.match(findLoveReply("i’m goin"), /Don't trip/);
  assert.match(findLoveReply("shes so nice."), /Why are you telling me/);
});
test("love bank: unrelated or empty text goes to the model", () => {
  assert.equal(findLoveReply("what is the capital of france"), null);
  assert.equal(findLoveReply(""), null);
  assert.equal(findLoveReply("ok"), null);
  assert.equal(norm("It’s  OK!!"), "its ok");
});
test("engine: Love answers from the bank first; safety and other personas skip it", async () => {
  const base = { vault: null, lang: "en", msgs: [], modelReady: false };
  assert.equal((await reply({ ...base, persona: "love", text: "Good night" })).status, "bank");
  assert.equal((await reply({ ...base, persona: "listener", text: "Good night" })).status, "demo");
  const r = await reply({ ...base, persona: "love", text: "he is following me home and I am scared" });
  assert.equal(r.status, "demo");
});
