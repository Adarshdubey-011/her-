import test from "node:test";
import assert from "node:assert/strict";
import { assess, assessMessage } from "../../web/js/emergency.js";

// [text, minLevel, maxLevel]
const SINGLE = [
  // critical / urgent
  ["he said he will kill me", 3, 4], ["he is going to kill me tonight", 3, 4], ["I want to kill myself", 3, 4], ["i want to die", 3, 4],
  ["he is beating me right now", 4, 4], ["he raped me", 3, 4], ["mujhe maar raha hai abhi", 3, 4], ["mujhe marna hai, jeena nahi chahti", 3, 4],
  ["वो मुझे जान से मार देगा", 3, 4], ["मुझे आत्महत्या के ख्याल आ रहे हैं", 3, 4], ["wo mujhe roz maarta hai", 3, 4], ["he choked me", 3, 4],
  ["usne mere saath jabardasti ki", 3, 4], ["मुझे मेरा पति मारता है", 3, 4], ["I'm going to end my life", 3, 4], ["he locked me in the room", 3, 4],
  // concern
  ["a guy keeps following me home", 2, 3], ["he is blackmailing me with my photos", 2, 4], ["wo mera peecha karta hai", 2, 3], ["my boss keeps sending inappropriate messages", 2, 3],
  ["he threatened me", 2, 3], ["usne dhamki di", 2, 3], ["वह मेरा पीछा करता है", 2, 3], ["he said he will leak my nudes", 2, 4], ["my in-laws torture me for dowry", 2, 3],
  ["someone is stalking me", 2, 3], ["colleague touched me without consent", 2, 3],
  // distress only
  ["I feel scared and alone", 1, 1], ["mujhe bahut darr lag raha hai", 1, 1], ["I can't stop crying", 1, 1], ["मैं बहुत परेशान हूँ", 1, 1], ["i am having a panic attack", 1, 1],
  // none
  ["hi", 0, 0], ["what is the weather today", 0, 0], ["kaise ho tum", 0, 0], ["tell me a joke", 0, 0], ["I got a new job today", 0, 0],
  // figurative / media / negation must NOT trigger
  ["I am dying of laughter", 0, 0], ["this exam will kill me lol", 0, 1], ["we should kill time before the movie", 0, 0], ["hansi se mar jaungi yaar", 0, 0],
  ["in the movie he kills her", 0, 0], ["I watched a film about stalking", 0, 0], ["he never hit me", 0, 0], ["he doesn't threaten me", 0, 0], ["wo mujhe kabhi nahi maarta", 0, 1],
  ["I killed it in the interview", 0, 0], ["dressed to kill tonight", 0, 0], ["I will not hurt myself", 0, 1],
  // past lowers
  ["years ago my ex hit me", 2, 2],
];
for (const [text, lo, hi] of SINGLE) {
  test(`single: ${text}`, () => {
    const a = assessMessage(text);
    assert.ok(a.level >= lo && a.level <= hi, `level ${a.level} not in ${lo}..${hi} (${a.reasons})`);
  });
}

test("self-harm flag", () => { assert.equal(assess("I want to kill myself").selfHarm, true); assert.equal(assess("he will kill me").selfHarm, false); });
test("third party flagged", () => { assert.equal(assess("my sister is being beaten by her husband").thirdParty, true); });
test("context: 'he is outside' alone is not urgent", () => { assert.ok(assess("he is outside").level < 3); });
test("context: presence after stalking is urgent", () => {
  const a = assess("he is outside my door", ["a guy keeps following me home", "he threatened me"]);
  assert.ok(a.level >= 3, String(a.level)); assert.ok(a.immediate);
});
test("context: bare 'bahar hai' without history stays low", () => { assert.ok(assess("wo bahar hai").level < 3); });
test("context: bachao after threat is urgent", () => { assert.ok(assess("bachao", ["usne dhamki di", "wo mera peecha karta hai"]).level >= 3); });
test("law ids for stalking", () => { assert.ok(assess("he keeps following me").lawIds.includes("stalking")); });
test("clauses split: negation does not hide a second clause", () => { assert.ok(assess("he didn't hit me but he threatened to kill me").level >= 3); });
test("empty input", () => { assert.equal(assess("").level, 0); assert.equal(assess(null).level, 0); });
