// 自由落下・投射運動のテスト(数値計算 ⇔ 等加速度運動の式)。
//   node --test tests/sim2-projectile.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHeadless } from "../public/js/sim2/core/engine.js";
import { getSystem, defaultConfig, validateConfig } from "../public/js/sim2/systems/index.js";

const sys = getSystem("projectile");
const cfg = (params, extra = {}) => ({ ...defaultConfig("projectile"), params: { ...defaultConfig("projectile").params, ...params }, ...extra });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-9), `${msg}: ${a} / ${b}`);

test("自由落下:着地の時間 √(2h/g)・速さ √(2gh)・加速度が g(どの積分器でも)", () => {
  for (const solver of ["analytic", "rk4", "velocityVerlet"]) {
    for (const [h0, g] of [[20, 9.8], [5, 1.62], [100, 24.79]]) {
      const e = runHeadless(sys, cfg({ h0, v0: 0, g }, { solver }), 30);
      near(e.state.landed, Math.sqrt((2 * h0) / g), 0.002, `${solver} 時間`);
      near(e.state.vEnd, Math.sqrt(2 * g * h0), 0.002, `${solver} 速さ`);
      assert.ok(e.monitor.results.every((r) => r.ok) && e.monitor.warnings.length === 0, JSON.stringify(e.monitor.warnings));
    }
  }
});

test("自由落下:質量を変えても落ちる時間は同じ", () => {
  const a = runHeadless(sys, cfg({ h0: 30, m: 0.1 }), 30).state.landed;
  const b = runHeadless(sys, cfg({ h0: 30, m: 10 }), 30).state.landed;
  assert.ok(Math.abs(a - b) < 1e-9);
});

test("重力がほぼ最小でも、加速度は設定した g と一致する(a = Δv/Δt)", () => {
  for (const g of [0.5, 1.62, 9.8]) {
    const e = runHeadless(sys, cfg({ h0: 100, v0: 0, g }), 1);
    near(-e.observe().vy / e.t, g, 1e-6, `g=${g}`);
  }
});

test("投射運動:水平の速さは一定で、飛んだきょり・いちばん高いところが式と合う", () => {
  const e = createAt(cfg({ h0: 0, v0: 20, angle: 45 }), 0.5);
  near(e.observe().vx, 20 * Math.cos(Math.PI / 4), 1e-12, "水平の速さ");
  const done = runHeadless(sys, cfg({ h0: 0, v0: 20, angle: 45 }), 30);
  const vx = 20 * Math.cos(Math.PI / 4), vy = 20 * Math.sin(Math.PI / 4);
  near(done.state.range, (20 * 20) / 9.8, 0.002, "到達きょり v²sin2θ/g");
  near(done.state.maxH, (vy * vy) / (2 * 9.8), 0.002, "最高点");
  near(done.state.landed, (2 * vy) / 9.8, 0.002, "滞空時間");
  assert.ok(vx > 0 && done.monitor.warnings.length === 0, JSON.stringify(done.monitor.warnings));
});

test("投射運動:45度で最も遠くに飛ぶ(h0 = 0)", () => {
  const range = (angle) => runHeadless(sys, cfg({ h0: 0, v0: 20, angle }), 30).state.range;
  assert.ok(range(45) > range(30) && range(45) > range(60));
  near(range(30), range(60), 1e-6, "30度と60度は同じきょり");
});

test("投射運動:積分器(rk4・速度ベルレ)でも解析解と合い、力学的エネルギーが保存する", () => {
  for (const solver of ["rk4", "velocityVerlet"]) {
    const e = runHeadless(sys, cfg({ h0: 10, v0: 15, angle: 30 }, { solver }), 30, { every: 20 });
    near(e.state.landed, (15 * 0.5 + Math.sqrt((7.5) ** 2 + 2 * 9.8 * 10)) / 9.8, 0.002, solver);
    assert.ok(e.monitor.energyDrift < 1e-3, `${solver} energyDrift ${e.monitor.energyDrift}`);
  }
});

test("下向きに投げる(角度が負)と、同じ高さから落とすより早く着く", () => {
  const down = runHeadless(sys, cfg({ h0: 20, v0: 10, angle: -90 }), 30).state.landed;
  const fall = runHeadless(sys, cfg({ h0: 20, v0: 0 }), 30).state.landed;
  assert.ok(down < fall);
  near(down, (-10 + Math.sqrt(100 + 2 * 9.8 * 20)) / 9.8, 0.002, "下投げ");
});

test("設定の確認:範囲の外・NaN・Infinity・ほかの項目は断られる、用意した例は通る", () => {
  assert.deepEqual(validateConfig(cfg({})), []);
  for (const bad of [{ g: 0 }, { g: -9.8 }, { v0: -1 }, { h0: 1000 }, { m: 0 }, { angle: 91 }, { g: NaN }, { v0: Infinity }]) {
    assert.ok(validateConfig(cfg(bad)).length > 0, JSON.stringify(bad));
  }
  assert.ok(validateConfig({ ...cfg({}), params: { ...cfg({}).params, extra: 1 } }).length > 0);
  for (const ex of sys.examples) {
    assert.deepEqual(validateConfig(ex.config), [], ex.title);
    const e = runHeadless(sys, ex.config, 30);
    assert.ok(e.stopped && e.monitor.warnings.length === 0, `${ex.title}: ${e.monitor.warnings}`);
  }
});

function createAt(config, sec) { return runHeadless(sys, config, sec); }
