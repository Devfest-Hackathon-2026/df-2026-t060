// 確認問題の正解を、シミュレーションで計った結果と照らして直すテスト。
//   node --test tests/sim2-quiz-check.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkQuiz, readNumbers } from "../public/js/sim2/core/quiz-check.js";
import { cfgFacts } from "../public/js/sim2/core/facts.js";
import { getSystem } from "../public/js/sim2/systems/index.js";

const factsOf = async (system, i = 0, params = {}) => {
  const c = getSystem(system).examples[i].config;
  return (await cfgFacts({ ...c, params: { ...c.params, ...params } })).data;
};

test("数と単位を読む(全角の数・km/s と m/s のちがい・まるめのはば)", () => {
  const [a] = readNumbers("約７.７ km/s");
  assert.equal(a.kind, "speed"); assert.ok(Math.abs(a.si - 7700) < 1e-9); assert.ok(Math.abs(a.step - 100) < 1e-9);
  assert.equal(readNumbers("340 m/s")[0].si, 340);
  assert.equal(readNumbers("92分")[0].si, 5520);
  assert.equal(readNumbers("9.8 m/s²")[0].kind, "accel");
  assert.equal(readNumbers("速くなる").length, 0);
});

test("宇宙速度の問題:AIが正解を取りちがえたら、計った速さに合う選択肢に直す", async () => {
  const data = await factsOf("orbit");
  const quiz = { q: "高さ400kmで地球を回り続ける人工衛星の速さは、およそいくらでしょう。", choices: ["約7.7 km/s", "約11.2 km/s", "約340 m/s"], answer: 1 };
  const r = checkQuiz(quiz, data);
  assert.equal(r.fixed, true); assert.equal(r.answer, 0);
  assert.match(r.notes[0], /直しました/);
  // 正しければ、そのまま
  assert.deepEqual(checkQuiz({ ...quiz, answer: 0 }, data), { answer: 0, fixed: false, warnings: [], notes: [], reason: null });
  // まるめた答え(約 8 km/s)も合っているとみなす
  assert.equal(checkQuiz({ ...quiz, choices: ["約8 km/s", "約11 km/s", "約3 km/s"], answer: 0 }, data).fixed, false);
});

test("周期の問題:1周の時間(分)を計った値とくらべる", async () => {
  const data = await factsOf("orbit");
  const r = checkQuiz({ q: "この人工衛星が地球を1周する時間はどれくらいでしょう。", choices: ["約24時間", "約92分", "約10分"], answer: 0 }, data);
  assert.equal(r.answer, 1);
});

test("変わり方の問題:質量を変えても着地の時間は変わらない(自由落下)→ AIの「長くなる」を直す", async () => {
  const data = await factsOf("projectile");
  const quiz = { q: "物体の質量を大きくすると、着地するまでの時間はどうなるでしょう。", choices: ["長くなる", "短くなる", "変わらない"], answer: 0 };
  const r = checkQuiz(quiz, data);
  assert.equal(r.fixed, true); assert.equal(r.answer, 2);
  // 高くすると長くなる(正しい)はそのまま
  const h = checkQuiz({ q: "はじめの高さを高くすると、着地するまでの時間はどうなるでしょう。", choices: ["長くなる", "短くなる", "変わらない"], answer: 0 }, data);
  assert.equal(h.fixed, false); assert.equal(h.warnings.length, 0);
  // 重力を小さくすると長くなる(計った変わり方は「重力が大きいほど小さくなる」)
  const g = checkQuiz({ q: "重力加速度を小さくすると、着地するまでの時間はどうなるでしょう。", choices: ["長くなる", "短くなる", "変わらない"], answer: 1 }, data);
  assert.equal(g.answer, 0);
});

test("太陽系:太陽が重くなると地球の公転周期は短くなる", async () => {
  const data = await factsOf("solar");
  const r = checkQuiz({ q: "太陽の質量を大きくすると、地球の公転周期はどうなるでしょう。", choices: ["長くなる", "短くなる", "変わらない"], answer: 0 }, data);
  assert.equal(r.answer, 1);
});

test("確かでないときは直さず、警告だけ(問いに計った量の名前がない・合う選択肢が2つ以上)", async () => {
  const data = await factsOf("orbit");
  // 「速さ」と書いていない問い → 直さない
  const r = checkQuiz({ q: "この人工衛星について正しいのはどれでしょう。", choices: ["約7.7 km/s で動く", "約11.2 km/s で動く", "止まっている"], answer: 1 }, data);
  assert.equal(r.fixed, false); assert.equal(r.answer, 1); assert.equal(r.warnings.length, 1);
  // 合う選択肢が2つ → 直さない
  const two = checkQuiz({ q: "人工衛星の速さはどれでしょう。", choices: ["7.7 km/s", "7700 m/s", "11.2 km/s"], answer: 2 }, data);
  assert.equal(two.fixed, false); assert.equal(two.warnings.length, 1);
  // 数のない、計っていない話の問い → 何もしない
  assert.deepEqual(checkQuiz({ q: "人工衛星は何に使われているでしょう。", choices: ["天気予報", "料理", "散歩"], answer: 0 }, data).warnings, []);
  // データがない(シミュレーションがない教材)→ 何もしない
  assert.equal(checkQuiz({ q: "x", choices: ["a", "b", "c"], answer: 0 }, null).fixed, false);
});
