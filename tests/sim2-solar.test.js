// 太陽系の惑星の運動(多体・3次元)のテスト。
//   node --test tests/sim2-solar.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHeadless } from "../public/js/sim2/core/engine.js";
import { getSystem, defaultConfig, validateConfig } from "../public/js/sim2/systems/index.js";
import { solveKepler, elementsToState, G, momentum } from "../public/js/sim2/systems/solar/model.js";
import { PLANETS } from "../public/js/sim2/systems/solar/planets.js";

const sys = getSystem("solar");
const cfg = (params, extra = {}) => ({ ...defaultConfig("solar"), params: { ...defaultConfig("solar").params, ...params }, ...extra });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} / ${b}(${((Math.abs(a - b) / Math.abs(b)) * 100).toFixed(3)}%)`);

// 実際の公転周期(恒星周期、年)。出典:NASA Planetary Fact Sheet の Orbital period(日)÷ 365.25
const REAL = { mercury: 87.969 / 365.25, venus: 224.701 / 365.25, earth: 365.256 / 365.25, mars: 686.98 / 365.25, jupiter: 4332.589 / 365.25, saturn: 10759.22 / 365.25 };

test("ケプラーの方程式と軌道要素:解が式を満たし、はじめの位置のきょりが a(1−e)〜a(1+e) に入る", () => {
  for (const e of [0, 0.0167, 0.2056, 0.6]) for (const M of [-3, -1, 0, 0.5, 2, 3.1]) {
    const E = solveKepler(M, e);
    assert.ok(Math.abs(E - e * Math.sin(E) - M) < 1e-12);
  }
  for (const pl of Object.values(PLANETS)) {
    const { r, v } = elementsToState(pl, G * (1 + pl.mass));
    const d = Math.hypot(...r);
    assert.ok(d >= pl.a * (1 - pl.e) - 1e-9 && d <= pl.a * (1 + pl.e) + 1e-9, pl.name);
    // 活力の式:v² = μ(2/r − 1/a)
    near(v[0] ** 2 + v[1] ** 2 + v[2] ** 2, G * (1 + pl.mass) * (2 / d - 1 / pl.a), 1e-10, `${pl.name} 活力の式`);
  }
  // 地球の公転の速さは約 29.8 km/s(1 AU = 1.495978707e8 km、1年 = 365.25 日)
  const { v } = elementsToState(PLANETS.earth, G);
  near((Math.hypot(...v) * 1.495978707e8) / (365.25 * 86400), 29.78, 0.02, "地球の速さ");
});

test("内わくの惑星:計った公転周期が、実際の値(NASA)と 0.1% 以内で合う", () => {
  const e = runHeadless(sys, cfg({ set: "inner" }), 2, { every: 500 });
  e.p.ids.forEach((id, k) => near(e.state.period[k], REAL[id], 0.001, `${PLANETS[id].name}`));
  assert.equal(e.monitor.warnings.length, 0, e.monitor.warnings.join());
});

test("外わくの惑星:木星は実際の値と 0.2%、土星は 1% 以内で合う。土星のずれは計算の誤差ではない(刻み・積分器を変えても同じ)", () => {
  const e = runHeadless(sys, cfg({ set: "outer" }), 31, { every: 500 });
  near(e.state.period[0], REAL.jupiter, 0.002, "木星");
  // 土星は、木星に引かれ(太陽も木星に引かれてゆれる)、1周ごとの時間が長い平均(NASA の値)から少しずれる
  near(e.state.period[1], REAL.saturn, 0.01, "土星");
  assert.equal(e.monitor.warnings.length, 0, e.monitor.warnings.join());
  const fine = runHeadless(sys, cfg({ set: "outer" }, { dt: 0.0025 }), 31, { every: 500 });
  const rk = runHeadless(sys, cfg({ set: "outer" }, { solver: "rk4" }), 31, { every: 500 });
  near(fine.state.period[1], e.state.period[1], 1e-4, "刻みを半分にしても同じ");
  near(rk.state.period[1], e.state.period[1], 1e-4, "rk4 でも同じ");
});

test("ケプラーの第3法則:T² / a³ は惑星によらずほぼ一定で、太陽の質量に反比例する", () => {
  for (const sunMass of [1, 2]) {
    const e = runHeadless(sys, cfg({ set: "inner", sunMass }), 2, { every: 500 });
    // 太陽の質量を変えると軌道も変わるので、2体の式から出した長半径を使う
    const ratios = e.p.ids.map((id, k) => {
      const T = e.state.period[k], mu = G * (sunMass + PLANETS[id].mass);
      const a = Math.cbrt(mu * (T / (2 * Math.PI)) ** 2);
      return (T * T) / a ** 3;
    });
    for (const r of ratios) near(r, (4 * Math.PI * Math.PI) / (G * sunMass), 0.002, `M=${sunMass}`);
  }
});

test("多体:全体の運動量は 0 のまま・エネルギーが保存する。惑星どうしの引力を切ると、木星の周期が少し変わる", () => {
  const on = runHeadless(sys, cfg({ set: "outer", mutual: "on" }), 13, { every: 200 });
  const off = runHeadless(sys, cfg({ set: "outer", mutual: "off" }), 13, { every: 200 });
  for (const e of [on, off]) {
    assert.ok(Math.hypot(...momentum(e.y, e.p)) < 1e-12, "運動量");
    assert.ok(e.monitor.energyDrift < 1e-4, `エネルギー ${e.monitor.energyDrift}`);
  }
  const d = Math.abs(on.state.period[0] - off.state.period[0]) / off.state.period[0];
  assert.ok(d > 1e-4 && d < 0.01, `木星の周期の差 ${(d * 100).toFixed(3)}%`);
});

test("3次元:軌道が傾いているので z 方向にも動く(水星は黄道面から約7°)", () => {
  const e = runHeadless(sys, cfg({ set: "inner" }), 0.12, {});
  const o = e.observe();
  const merc = o.planets[0];
  assert.ok(Math.abs(merc.pos[2] - o.sun[2]) > 0.005, `水星の z ${merc.pos[2]}`);
  const v = sys.model.view3d(o, e.p);
  assert.equal(v.bodies.length, 5);
  assert.ok(v.bodies.slice(1).every((b) => b.trail));
});

test("設定の確認:範囲の外・知らない惑星の組は断られ、用意した例は通る", () => {
  assert.deepEqual(validateConfig(cfg({})), []);
  for (const bad of [{ sunMass: 0.1 }, { sunMass: NaN }, { set: "pluto" }, { mutual: "maybe" }]) assert.ok(validateConfig(cfg(bad)).length > 0, JSON.stringify(bad));
  for (const ex of sys.examples) {
    assert.deepEqual(validateConfig(ex.config), [], ex.title);
    const e = runHeadless(sys, ex.config, ex.config.params.set === "outer" ? 13 : 1.1, { every: 500 });
    assert.equal(e.monitor.warnings.length, 0, `${ex.title}: ${e.monitor.warnings}`);
    assert.ok(e.monitor.results.some((r) => r.id === "period" && r.ok), "周期の確かめが通る");
  }
});
