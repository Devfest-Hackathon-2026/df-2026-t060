// 中1 凸レンズの像のテスト(光線追跡 ⇔ レンズの公式)。
//   node --test tests/sim2-lens.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHeadless } from "../public/js/sim2/core/engine.js";
import { getSystem, defaultConfig } from "../public/js/sim2/systems/index.js";
import { imageByRays, traceRays } from "../public/js/sim2/systems/lens/model.js";

const lens = getSystem("lens");
const cfg = (params) => ({ ...defaultConfig("lens"), params: { ...defaultConfig("lens").params, ...params } });

test("凸レンズ:光線追跡の像の位置が、レンズの公式 1/a + 1/b = 1/f と合い、3本の光線が1点で交わる", () => {
  for (const [a, f] of [[30, 10], [20, 10], [15, 10], [60, 25], [6, 10], [2, 5]]) {
    const img = imageByRays({ a, f, h: 4 });
    const b = (a * f) / (a - f);
    assert.ok(Math.abs(img.x - b) < 1e-9, `a=${a} f=${f}: ${img.x} / ${b}`);
    assert.ok(img.spread < 1e-9, "3本が1点で交わる");
    assert.equal(img.real, a > f, "焦点の外は実像、内は虚像");
    const e = runHeadless(lens, cfg({ a, f }), 0.1);
    assert.ok(e.monitor.results.every((r) => r.ok), JSON.stringify(e.monitor.results));
  }
});

test("凸レンズ:教科書のきまり(2F に置くと同じ大きさの実像が 2F に、焦点に置くと像ができない)", () => {
  const two = imageByRays({ a: 20, f: 10, h: 4 });
  assert.ok(Math.abs(two.x - 20) < 1e-9 && Math.abs(Math.abs(two.y) - 4) < 1e-9 && two.y < 0, "同じ大きさで上下が逆");
  assert.equal(imageByRays({ a: 10, f: 10, h: 4 }), null);
  const near = imageByRays({ a: 5, f: 10, h: 4 });
  assert.ok(near.x < 0 && near.y > 4, "焦点の内側:同じ側に、同じ向きで大きい虚像");
  // ①の光はレンズのあと焦点を通る、③の光はレンズのあと光軸に平行
  const [r1, , r3] = traceRays({ a: 30, f: 10, h: 4 });
  assert.ok(Math.abs(r1.y0 + r1.s1 * 10) < 1e-12);
  assert.ok(Math.abs(r3.s1) < 1e-12);
});
