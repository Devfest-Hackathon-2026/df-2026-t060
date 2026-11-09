// 新しい作り(sim2)の、共通の部品と単振り子のテスト。
//   node --test tests/sim2-core.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../public/js/sim2/core/schema.js";
import { applyPatch, diff } from "../public/js/sim2/core/patch.js";
import { rk4, velocityVerlet, backwardEuler } from "../public/js/sim2/core/integrators.js";
import { createEngine, runHeadless } from "../public/js/sim2/core/engine.js";
import { getSystem, validateConfig, defaultConfig, findExamples, SYSTEMS } from "../public/js/sim2/systems/index.js";
import { exactPeriod, smallAnglePeriod, prepare } from "../public/js/sim2/systems/pendulum/model.js";

const pend = getSystem("pendulum");
const cfg = (params, extra = {}) => ({ ...defaultConfig("pendulum"), ...extra, params: { ...defaultConfig("pendulum").params, ...params } });

test("設定の形:範囲・必要なもの・使えない名前を見つける", () => {
  assert.deepEqual(validateConfig(cfg({})), []);
  assert.ok(validateConfig(cfg({ L: 99 })).some((e) => e.startsWith("/params/L")));
  assert.ok(validateConfig({ ...cfg({}), extra: 1 }).some((e) => e.includes("/extra")));
  assert.ok(validateConfig({ ...cfg({}), curriculum: { grade: "高1", unit: "x" } }).some((e) => e.includes("/curriculum/grade")));
  const bad = cfg({}); delete bad.params.g;
  assert.ok(validateConfig(bad).some((e) => e.includes("/params/g")));
  assert.deepEqual(validate({ type: "array", items: { enum: ["a"] }, maxItems: 1 }, ["a", "b"]).length, 2);
  // 用意した例は、全部が形に合う
  for (const s of Object.values(SYSTEMS)) for (const ex of s.examples) assert.deepEqual(validateConfig(ex.config), [], ex.title);
});

test("JSON Patch(RFC 6902):add / remove / replace / move / copy / test と、失敗したら何も変えない", () => {
  const doc = { params: { g: 9.8, L: 1 }, controls: ["L"] };
  assert.deepEqual(applyPatch(doc, [{ op: "replace", path: "/params/g", value: 1.62 }]).params.g, 1.62);
  assert.equal(doc.params.g, 9.8, "もとは書きかえない");
  assert.deepEqual(applyPatch(doc, [{ op: "add", path: "/controls/-", value: "g" }]).controls, ["L", "g"]);
  assert.deepEqual(applyPatch(doc, [{ op: "remove", path: "/controls/0" }]).controls, []);
  assert.deepEqual(applyPatch(doc, [{ op: "copy", from: "/params/L", path: "/params/L2" }]).params.L2, 1);
  assert.deepEqual(Object.keys(applyPatch(doc, [{ op: "move", from: "/params/L", path: "/params/len" }]).params), ["g", "len"]);
  assert.throws(() => applyPatch(doc, [{ op: "replace", path: "/params/g", value: 2 }, { op: "test", path: "/params/L", value: 5 }]));
  assert.throws(() => applyPatch(doc, [{ op: "replace", path: "/nope/x", value: 1 }]));
  // RFC 6901 のエスケープ
  assert.equal(applyPatch({ "a/b": { "c~d": 1 } }, [{ op: "replace", path: "/a~1b/c~0d", value: 2 }])["a/b"]["c~d"], 2);
  assert.deepEqual(diff(doc, applyPatch(doc, [{ op: "replace", path: "/params/g", value: 1.62 }])), [{ path: "/params/g", before: 9.8, after: 1.62 }]);
});

test("積分器:ばね(x'' = −x)で、1周期後のずれと、エネルギーのふるまい", () => {
  const osc = { deriv: ([x, v]) => [v, -x], accel: ([x]) => [-x] };
  const run = (f, dt) => { let y = [1, 0]; const n = Math.round((2 * Math.PI) / dt); for (let i = 0; i < n; i++) y = f(osc, y, i * dt, dt, {}); return y; };
  const dt = (2 * Math.PI) / 1000;
  const err = (y) => Math.hypot(y[0] - 1, y[1]);
  assert.ok(err(run(rk4, dt)) < 1e-9, "RK4 は4次でとても正確");
  assert.ok(err(run(velocityVerlet, dt)) < 1e-4, "ベルレ法は2次");
  const be = run(backwardEuler, dt);
  assert.ok(Math.hypot(...be) < 1, "後退オイラー法はエネルギーが減る(安定)");
});

test("単振り子:ベルレ法で60秒動かしても、エネルギーのずれは 0.1% 未満", () => {
  for (const theta0 of [5, 30, 80]) {
    const e = runHeadless(pend, cfg({ theta0 }), 60, { every: 10 });
    assert.ok(e.monitor.energyDrift < 1e-3, `θ0=${theta0}: ${e.monitor.energyDrift}`);
    assert.deepEqual(e.monitor.warnings, []);
  }
});

test("単振り子:計った周期は厳密な式(AGM)と 0.1% 以内。小さい振れはばでは 2π√(L/g) とも合う", () => {
  for (const [L, theta0] of [[0.5, 5], [1, 30], [2, 60], [1, 80]]) {
    const e = runHeadless(pend, cfg({ L, theta0 }), 10);
    const p = prepare(e.config);
    const rel = Math.abs(e.state.period - exactPeriod(p)) / exactPeriod(p);
    assert.ok(rel < 1e-3, `L=${L} θ0=${theta0}: 計った ${e.state.period} / 厳密 ${exactPeriod(p)}`);
    if (theta0 <= 5) assert.ok(Math.abs(e.state.period - smallAnglePeriod(p)) / smallAnglePeriod(p) < 1e-3);
    assert.ok(e.monitor.results.every((r) => r.ok !== false), JSON.stringify(e.monitor.results));
  }
  // 振れはば80度では、2π√(L/g) より約 14% 長い(理論どおり)
  const p80 = prepare(cfg({ theta0: 80 }));
  assert.ok(Math.abs(exactPeriod(p80) / smallAnglePeriod(p80) - 1.1385) < 0.002);
});

test("単振り子:空気の抵抗があると、エネルギーが減る(警告は出さない)", () => {
  const e = runHeadless(pend, cfg({ b: 0.5 }), 10);
  const E = pend.model.energy(e.y, e.p).total, E0 = pend.model.energy(e.y0, e.p).total;
  assert.ok(E < E0 * 0.1);
  assert.deepEqual(e.monitor.warnings, []);
});

test("アキュムレータ:画面のこま数(30fps / 60fps / ばらばら)によらず、同じ時刻には同じ計算になる", () => {
  const at = (frames) => { const e = createEngine(pend, cfg({ theta0: 40 })); for (const f of frames) e.advance(f); return e; };
  const a = at(Array(300).fill(1 / 30)), b = at(Array(600).fill(1 / 60));
  const c = at(Array.from({ length: 600 }, (_, i) => (i % 2 ? 1 / 40 : 1 / 120)));
  assert.equal(a.steps, b.steps);
  assert.equal(a.steps, c.steps);
  assert.deepEqual(a.y, b.y);
});

test("ソルバーの差しかえ:同じ設定で RK4・後退オイラー法も動く(後退オイラー法はエネルギーが減ると警告)", () => {
  const r = runHeadless(pend, cfg({ theta0: 30 }, { solver: "rk4" }), 20, { every: 10 });
  assert.ok(r.monitor.energyDrift < 1e-6);
  const be = runHeadless(pend, cfg({ theta0: 30 }, { solver: "backwardEuler" }), 20, { every: 10 });
  assert.ok(be.monitor.energyDrift > 1e-3);
  assert.ok(be.monitor.warnings.some((w) => w.includes("エネルギー")));
});

test("学年・単元で、用意した例をさがす(AIを使わない)", () => {
  assert.ok(findExamples({ grade: "小5" }).some((x) => x.system === "pendulum"));
  assert.ok(findExamples({ grade: "中3", unit: "力学的エネルギー" }).length >= 1);
  assert.equal(findExamples({ grade: "小3", unit: "力学的エネルギー" }).length, 0);
});
