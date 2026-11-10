// 児童の実験助手のテスト(AIの出力を当てる部分・AIがないときの読みとり)。
//   node --test tests/sim2-assistant.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantPrompt, actionSchema, applyAction, localAction, exampleSentences } from "../public/js/sim2/core/assistant.js";
import { getSystem, SYSTEM_NAMES } from "../public/js/sim2/systems/index.js";
import { validate } from "../public/js/sim2/core/schema.js";
import { EXPLANATIONS, explanationsFor } from "../public/js/sim2/core/explain.js";

const ex = (s, i = 0) => getSystem(s).examples[i].config;
const p5 = ex("pendulum", 0), p9 = ex("pendulum", 1);

test("指示(システムプロンプト):全部の系・学年で、{{ }} が残らず、短い(目安 500 トークン = 900 字以内)", () => {
  for (const s of SYSTEM_NAMES) for (const ex of getSystem(s).examples) {
    const prompt = assistantPrompt(s, ex.config.curriculum.grade);
    assert.doesNotMatch(prompt, /\{\{/);
    assert.ok(prompt.length <= 900, `${s} ${prompt.length}字`);
  }
  // 学年で説明の一覧をしぼる(小5には中3のエネルギーの説明をわたさない)
  assert.doesNotMatch(assistantPrompt("pendulum", "小5"), /pendulum\.energy/);
  assert.match(assistantPrompt("pendulum", "中3"), /pendulum\.energy/);
});

test("出力の形:例の JSON は、その系の形に合う", () => {
  const schema = actionSchema("pendulum", "小5");
  for (const a of [{ action: "set", changes: [{ param: "L", op: "mul", value: 2 }] }, { action: "preset", id: "moon" }, { action: "compare", variants: [{ m: 0.5 }, { m: 2 }] }, { action: "explain", id: "pendulum.period" }, { action: "unknown" }]) {
    assert.deepEqual(validate(schema, a), [], JSON.stringify(a));
  }
  assert.ok(validate(schema, { action: "set", changes: [{ param: "zzz", op: "mul", value: 2 }] }).length > 0);
});

test("set:2倍・増やす・数の指定はアプリで計算し、範囲の外は収めて「〜までだよ」と知らせる", () => {
  const a = applyAction(p5, { action: "set", changes: [{ param: "L", op: "mul", value: 2 }] });
  assert.equal(a.config.params.L, 2);
  assert.deepEqual(a.changes, [{ key: "L", label: "糸の長さ", before: 1, after: 2, unit: "m" }]);
  const b = applyAction(p5, { action: "set", changes: [{ param: "L", op: "mul", value: 10 }] });
  assert.equal(b.config.params.L, 3);
  assert.ok(b.messages.some((m) => m.includes("3mまでだよ")));
  const c = applyAction(p5, { action: "set", changes: [{ param: "theta0", op: "add", value: 5 }] });
  assert.equal(c.config.params.theta0, 20);
  assert.equal(applyAction(p5, { action: "set", changes: [{ param: "L", op: "set", value: 1 }] }).kind, "unknown", "変わらないときは unknown");
});

test("preset:値はプリセットの表から(月 1.62・乾電池2こ 3.0 V・レンズの 2F は焦点距離から計算)", () => {
  assert.equal(applyAction(p5, { action: "preset", id: "moon" }).config.params.g, 1.62);
  assert.equal(applyAction(ex("circuit"), { action: "preset", id: "battery2" }).config.params.V, 3);
  const l = applyAction(ex("lens"), { action: "preset", id: "at2F" });
  assert.equal(l.config.params.a, 2 * ex("lens").params.f);
  assert.equal(applyAction(p5, { action: "preset", id: "nope" }).kind, "unknown");
});

test("compare・explain・reset・unknown", () => {
  const c = applyAction(p5, { action: "compare", variants: [{ m: 0.5 }, { m: 2 }] });
  assert.equal(c.kind, "compare"); assert.equal(c.variants.length, 2); assert.equal(c.variants[1].params.m, 2);
  assert.equal(applyAction(p5, { action: "compare", variants: [{ m: 0.5 }, { m: 0.5 }] }).kind, "unknown", "同じ条件だけでは比べられない");
  const e = applyAction(p5, { action: "explain", id: "pendulum.period" });
  assert.match(e.explanation.text, /糸の長さ/);
  assert.doesNotMatch(e.explanation.text, /√/, "小学生には数式を出さない");
  assert.match(applyAction(p9, { action: "explain", id: "pendulum.period" }).explanation.text, /√/, "中学生には式");
  assert.equal(applyAction(p5, { action: "explain", id: "pendulum.energy" }).kind, "unknown", "小5には中3の説明を出さない");
  assert.equal(applyAction(p5, { action: "explain", id: "circuit.ohm" }).kind, "unknown", "ほかの系の説明は出さない");
  const changed = applyAction(p5, { action: "preset", id: "moon" }).config;
  assert.equal(applyAction(changed, { action: "reset" }, { base: p5 }).config.params.g, 9.8);
  const u = applyAction(p5, { action: "unknown" });
  assert.equal(u.examples.length, 3);
});

test("AIがないときの読みとり:ひらがな・話しことばも、ある程度読む", () => {
  const t = (text, cfg = p5) => localAction(cfg, text);
  assert.deepEqual(t("ひもをながくして"), { action: "set", changes: [{ param: "L", op: "set", value: 1.5 }] });
  assert.deepEqual(t("つきでやったらどうなる"), { action: "preset", id: "moon" });
  assert.equal(t("なんでながさでかわるの").action, "explain");
  assert.equal(t("おもさでかわるかくらべたい").action, "compare");
  assert.deepEqual(t("もとにもどして"), { action: "reset" });
  // 範囲の外の数は、そのまま渡して、アプリが収めて知らせる
  const big = applyAction(p5, t("ひもを10mにして"));
  assert.equal(big.config.params.L, 3);
  assert.ok(big.messages.some((m) => m.includes("3mまでだよ")));
  assert.equal(t("ゲームしたい").action, "unknown");
  assert.deepEqual(t("でんち2こにして", ex("circuit")), { action: "preset", id: "battery2" }, "ひらがなの「でんち」も読む");
  assert.equal(t("あいうえお", ex("circuit")).action, "unknown");
});

test("説明の文は、全部の系にあり、学年の範囲が正しい", () => {
  for (const s of SYSTEM_NAMES) assert.ok(explanationsFor(s, "中3").length >= 2, s);
  assert.ok(EXPLANATIONS.filter((e) => /^小/.test(e.minGrade)).every((e) => e.textE), "小学生に出す説明には、小学生向けの文がある");
  assert.equal(exampleSentences("lens", "中1").length, 3);
});
