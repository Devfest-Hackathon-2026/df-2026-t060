// 中2 直流回路のテスト(節点解析 ⇔ オームの法則・合成抵抗の式)。
//   node --test tests/sim2-circuit.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHeadless } from "../public/js/sim2/core/engine.js";
import { getSystem, defaultConfig } from "../public/js/sim2/systems/index.js";
import { solveCircuit } from "../public/js/sim2/systems/circuit/model.js";

const circ = getSystem("circuit");
const cfg = (params) => ({ ...defaultConfig("circuit"), params: { ...defaultConfig("circuit").params, ...params } });
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} / ${b}`);

test("直列:電流はどこも同じで V/(R1+R2)。電圧は抵抗に比例して分かれ、合計が電源の電圧", () => {
  const s = solveCircuit({ layout: "series2", V: 6, R1: 10, R2: 20 });
  close(s.Itotal, 6 / 30, "全体の電流");
  close(s.parts[0].I, s.parts[1].I, "同じ電流");
  close(s.parts[0].V, 2, "R1 の電圧"); close(s.parts[1].V, 4, "R2 の電圧");
});

test("並列:電圧はどれも電源と同じ。電流の合計が全体の電流。1/R = 1/R1 + 1/R2", () => {
  const s = solveCircuit({ layout: "parallel2", V: 6, R1: 10, R2: 30 });
  close(s.parts[0].V, 6, "R1"); close(s.parts[1].V, 6, "R2");
  close(s.parts[0].I + s.parts[1].I, s.Itotal, "電流の合計");
  close(6 / s.Itotal, 1 / (1 / 10 + 1 / 30), "合成抵抗");
});

test("組み合わせ・3つ:全部のつなぎ方で、見張り(オームの法則・節点の電流・電力・合成抵抗)が○", () => {
  for (const layout of ["series2", "series3", "parallel2", "parallel3", "mixed"]) {
    for (const [V, R1, R2, R3] of [[6, 10, 20, 30], [1.5, 1, 50, 7], [12, 33, 33, 33]]) {
      const e = runHeadless(circ, cfg({ layout, V, R1, R2, R3 }), 0.1);
      assert.ok(e.monitor.results.length === 4 && e.monitor.results.every((r) => r.ok), `${layout}: ${JSON.stringify(e.monitor.results)}`);
    }
  }
  const m = solveCircuit({ layout: "mixed", V: 9, R1: 10, R2: 20, R3: 20 });
  close(m.Itotal, 9 / 20, "R1 + (R2∥R3) = 20Ω");
  close(m.parts[1].I, m.parts[2].I, "同じ抵抗の並列には半分ずつ");
});
