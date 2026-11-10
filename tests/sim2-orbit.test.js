// 人工衛星(万有引力・3次元)のテスト。
//   node --test tests/sim2-orbit.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHeadless } from "../public/js/sim2/core/engine.js";
import { getSystem, defaultConfig, validateConfig } from "../public/js/sim2/systems/index.js";
import { GM_EARTH, R_EARTH } from "../public/js/sim2/core/constants.js";

const sys = getSystem("orbit");
const cfg = (params, extra = {}) => ({ ...defaultConfig("orbit"), params: { ...defaultConfig("orbit").params, ...params }, ...extra });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-9), `${msg}: ${a} / ${b}`);
const period = (alt) => 2 * Math.PI * Math.sqrt((R_EARTH + alt * 1000) ** 3 / GM_EARTH);

test("円軌道:向心力 = 万有引力(v² / r = GM / r²)で、半径が変わらず、周期がケプラーの第3法則と合う", () => {
  for (const alt of [400, 2000, 20200, 35786]) {
    const e = runHeadless(sys, cfg({ alt }), period(alt) * 1.05, { every: 20 });
    const r0 = R_EARTH + alt * 1000;
    near(e.p.vc ** 2 / r0, GM_EARTH / r0 ** 2, 1e-12, "向心加速度");
    near(e.state.period, period(alt), 0.002, `周期 ${alt}km`);
    near(e.state.maxR, e.state.minR, 1e-4, "半径が一定");
    assert.equal(e.monitor.warnings.length, 0, e.monitor.warnings.join());
  }
});

test("静止衛星(高度 35786 km)の周期は約 23時間56分(恒星日)", () => {
  near(period(35786) / 3600, 23.934, 0.002, "恒星日");
});

test("3次元:傾いた軌道は z 方向に動き、軌道面と角運動量の向きが変わらない。傾き0なら z は 0 のまま", () => {
  const flat = runHeadless(sys, cfg({ incl: 0 }), 3000);
  assert.equal(flat.state.maxAbsZ, 0);
  const e = runHeadless(sys, cfg({ incl: 60 }), 3000);
  const r0 = R_EARTH + 400e3;
  assert.ok(e.state.maxAbsZ > 0.5 * r0 * Math.sin((60 * Math.PI) / 180) * 0.5, "z が動く");
  // 軌道面の法線 n = (0, −sin i, cos i) と位置の内積は 0
  const i = Math.PI / 3, n = [0, -Math.sin(i), Math.cos(i)];
  assert.ok(Math.abs(e.y[0] * n[0] + e.y[1] * n[1] + e.y[2] * n[2]) < 1e-6 * r0);
  // 傾きが違っても周期は同じ(重力は球対称)
  near(runHeadless(sys, cfg({ incl: 60 }), period(400) * 1.05).state.period, runHeadless(sys, cfg({ incl: 0 }), period(400) * 1.05).state.period, 1e-6, "周期は傾きによらない");
});

test("楕円軌道:周期は長半径で決まり(第3法則)、エネルギーと角運動量が保存する。衛星の質量は軌道に関係しない", () => {
  const params = { alt: 20000, ratio: 1.2, incl: 30 };
  const e = runHeadless(sys, cfg(params), 1, {});
  const T = e.p.period;
  assert.ok(T > period(20000));
  const done = runHeadless(sys, cfg(params), T * 1.05, { every: 20 });
  near(done.state.period, T, 0.002, "周期");
  assert.ok(done.monitor.energyDrift < 1e-3, `drift ${done.monitor.energyDrift}`);
  assert.equal(done.monitor.warnings.length, 0, done.monitor.warnings.join());
  const heavy = runHeadless(sys, cfg({ ...params, m: 10000 }), T * 0.5);
  const light = runHeadless(sys, cfg({ ...params, m: 1 }), T * 0.5);
  near(heavy.y[0], light.y[0], 1e-9, "質量によらない位置");
});

test("宇宙速度:√2 倍を境に、回る → 飛んでいく。遅すぎると地球に落ちて止まる", () => {
  const vc = Math.sqrt(GM_EARTH / (R_EARTH + 400e3));
  near(Math.sqrt(GM_EARTH / R_EARTH) / 1000, 7.91, 0.002, "第一宇宙速度 7.9 km/s");
  near(Math.SQRT2 * Math.sqrt(GM_EARTH / R_EARTH) / 1000, 11.19, 0.002, "第二宇宙速度 11.2 km/s");
  assert.ok(vc > 0);
  const esc = runHeadless(sys, cfg({ ratio: 1.45 }), 40000);
  assert.equal(esc.p.bound, false);
  assert.equal(esc.state.period, null);
  assert.ok(esc.observe().r > 5 * esc.p.r0 && esc.observe().outcome === "飛んでいく");
  assert.ok(esc.monitor.energyDrift < 1e-3);
  const fall = runHeadless(sys, cfg({ ratio: 0.6 }), 40000);
  assert.ok(fall.stopped && fall.state.crashed !== null && fall.observe().outcome === "地球に落ちる");
  const on = runHeadless(sys, cfg({ ratio: 1.41 }), 1000);
  assert.equal(on.p.bound, true);
});

test("積分器:rk4 でも速度ベルレ法と同じ周期(dt=10 秒)", () => {
  const T = period(400);
  const a = runHeadless(sys, cfg({}, { solver: "rk4" }), T * 1.05).state.period;
  near(a, T, 0.002, "rk4");
});

test("設定の確認:範囲の外・NaN・余計な項目は断られ、用意した例は通る", () => {
  assert.deepEqual(validateConfig(cfg({})), []);
  for (const bad of [{ alt: 0 }, { alt: 1e9 }, { ratio: 0 }, { ratio: NaN }, { incl: 120 }, { m: -1 }]) assert.ok(validateConfig(cfg(bad)).length > 0, JSON.stringify(bad));
  for (const ex of sys.examples) {
    assert.deepEqual(validateConfig(ex.config), [], ex.title);
    const e = runHeadless(sys, ex.config, 20000, { every: 50 });
    assert.equal(e.monitor.warnings.length, 0, `${ex.title}: ${e.monitor.warnings}`);
  }
});
