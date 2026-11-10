// 3D 表示に使う、計算の側の部分(座標の直し方・view3d の形)のテスト。Three.js 自体は Node では動かさない。
//   node --test tests/sim2-view3d.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { toThree, checkView3d, cameraPosition } from "../public/js/sim2/render/view3d.js";
import { runHeadless } from "../public/js/sim2/core/engine.js";
import { getSystem, defaultConfig } from "../public/js/sim2/systems/index.js";

const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

test("座標の直し方:物理の z(上)が Three.js の y(上)になり、向き(右手系)は変わらず、長さも変わらない", () => {
  assert.deepEqual(toThree([0, 0, 5]), [0, 5, -0]);
  assert.deepEqual(toThree([1, 0, 0]), [1, 0, -0]);
  assert.deepEqual(toThree([0, 1, 0]), [0, 0, -1]);
  const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(toThree); // 行列の列
  assert.equal(det([0, 1, 2].map((r) => cols.map((c) => c[r]))), 1);
  const v = [3, -4, 12]; assert.equal(Math.hypot(...toThree(v)), 13);
});

test("カメラ:球座標から正しい位置。きょりは変わらず、真上・真下には行かない", () => {
  for (const [th, ph, d] of [[0, 1, 20], [2, 0.3, 26], [-1, 3.2, 8]]) assert.ok(Math.abs(Math.hypot(...cameraPosition(th, ph, d)) - d) < 1e-9);
  assert.ok(Math.abs(cameraPosition(0, 0, 10)[0]) < 1);
  assert.ok(cameraPosition(0, -5, 10)[1] < 10 && cameraPosition(0, 99, 10)[1] > -10);
});

test("orbit の view3d:3次元の位置・速度が、計算した値のままわたされ、形が正しい", () => {
  const sys = getSystem("orbit");
  const cfg = { ...defaultConfig("orbit"), params: { ...defaultConfig("orbit").params, incl: 50, ratio: 1.2, alt: 20000 } };
  const e = runHeadless(sys, cfg, 5000);
  const o = e.observe(), v = sys.model.view3d(o, e.p);
  assert.deepEqual(checkView3d(v), []);
  assert.deepEqual(v.bodies.find((b) => b.id === "sat").pos, e.y.slice(0, 3));
  assert.notEqual(v.bodies.find((b) => b.id === "sat").pos[2], 0, "z 方向に動いている");
  assert.ok(Math.abs(Math.hypot(...v.vectors[0].dir) - v.extent * 0.2) < 1e-6 * v.extent, "矢印の長さは一定");
  // 衛星は見せる範囲の中にいる
  for (const sec of [0, 2000, 20000, 60000]) {
    const x = runHeadless(sys, cfg, sec || 1), w = sys.model.view3d(x.observe(), x.p);
    assert.ok(Math.hypot(...w.bodies[1].pos) <= w.extent, `t=${sec}`);
  }
});

test("checkView3d:2次元の位置・正でない半径・NaN を見つける", () => {
  assert.ok(checkView3d({ extent: 1, bodies: [{ id: "a", pos: [0, 0], radius: 1 }] }).length > 0);
  assert.ok(checkView3d({ extent: 1, bodies: [{ id: "a", pos: [0, 0, 0], radius: 0 }] }).length > 0);
  assert.ok(checkView3d({ extent: NaN, bodies: [] }).length > 0);
  assert.ok(checkView3d({ extent: 1, bodies: [], vectors: [{ from: [0, 0, NaN], dir: [0, 0, 1] }] }).length > 0);
});

test("projectile の view3d:物理の高さ y が 3D の z(上)になり、着地したら矢印を消す", () => {
  const sys = getSystem("projectile");
  const cfg = { ...defaultConfig("projectile"), params: { h0: 0, v0: 20, angle: 45, m: 1, g: 9.8 } };
  const mid = runHeadless(sys, cfg, 1);
  const v = sys.model.view3d(mid.observe(), mid.p);
  assert.deepEqual(checkView3d(v), []);
  assert.deepEqual(v.bodies[0].pos, [mid.y[0], 0, mid.y[1]]);
  assert.equal(v.vectors.length, 2);
  assert.ok(v.vectors[1].dir[2] < 0 && v.vectors[1].dir[0] === 0, "加速度は真下");
  const end = runHeadless(sys, cfg, 30);
  assert.equal(sys.model.view3d(end.observe(), end.p).vectors.length, 0);
});

test("orbit の view3d:加速度の矢印は地球の中心を向く(万有引力)", () => {
  const sys = getSystem("orbit");
  const e = runHeadless(sys, { ...defaultConfig("orbit"), params: { ...defaultConfig("orbit").params, incl: 30 } }, 1000);
  const o = e.observe(), a = sys.model.view3d(o, e.p).vectors[1].dir;
  const cos = -(a[0] * o.pos[0] + a[1] * o.pos[1] + a[2] * o.pos[2]) / (Math.hypot(...a) * o.r);
  assert.ok(Math.abs(cos - 1) < 1e-12);
});

test("エネルギーの単位:大きさに合わせて J・kJ・MJ・GJ にする", async () => {
  const { energyUnit } = await import("../public/js/sim2/render/graphs.js");
  assert.equal(energyUnit(12.3).unit, "J");
  assert.equal(energyUnit(4500).unit, "kJ");
  const u = energyUnit(4.232e9);
  assert.equal(u.unit, "GJ");
  assert.equal(u.fmt(-4232000000), "-4.232");
  assert.equal(energyUnit(-3.1e7).unit, "MJ");
});

test("簡易3Dの投影:原点が画面のまん中・物理の z が画面の上・x が右・遠いほど小さい・カメラの後ろは描かない", async () => {
  const { projectPoint } = await import("../public/js/sim2/render/view3d.js");
  const view = { extent: 10, w: 800, h: 500 }, side = { theta: 0, phi: Math.PI / 2, dist: 26 };
  const o = projectPoint([0, 0, 0], side, view);
  assert.ok(Math.abs(o.x - 400) < 1e-9 && Math.abs(o.y - 250) < 1e-9, "原点はまん中");
  assert.ok(projectPoint([0, 0, 5], side, view).y < o.y, "z が大きいほど上");
  assert.ok(projectPoint([5, 0, 0], side, view).x > o.x, "x が大きいほど右");
  // 手前(カメラに近い)ほど大きく、奥ほど小さい。横から見て y が手前向き(theta=0 のカメラは +z_three = −y_物理 側)
  const near = projectPoint([0, -5, 0], side, view), far = projectPoint([0, 5, 0], side, view);
  assert.ok(near.k > far.k && near.depth < far.depth);
  // 回転しても、原点からの見かけの大きさ(dist)は変わらない → 原点はいつもまん中
  for (const th of [0.5, 2, -1.3]) assert.ok(Math.abs(projectPoint([0, 0, 0], { theta: th, phi: 1, dist: 26 }, view).x - 400) < 1e-9);
  // 中心(center)をずらすと、その点がまん中になる
  const c = projectPoint([7, 3, 1], side, { ...view, center: [7, 3, 1] });
  assert.ok(Math.abs(c.x - 400) < 1e-9 && Math.abs(c.y - 250) < 1e-9);
  // カメラの後ろ
  assert.equal(projectPoint([0, -400, 0], { theta: 0, phi: Math.PI / 2, dist: 26 }, { ...view, extent: 10 }), null);
});
