import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAB_PRESETS, cosmicSpeeds, labMaterial, makeLabPlan } from '../public/js/hybrid-lab.js';
import { captureRun, encodeContext, parseContext } from '../public/js/inquiry-data.js';
import { createEngine, runHeadless } from '../public/js/sim2/core/engine.js';
import { getSystem } from '../public/js/sim2/systems/index.js';
import { proposeLab } from '../server/lab-plan.js';

function experiment(preset, seconds, edits = []) {
  const { config } = makeLabPlan(preset, { edits, grade: '中3' });
  return runHeadless(getSystem(config.system), config, seconds);
}
const close = (a, b, error) => assert.ok(Math.abs(a - b) <= error, a + ' versus ' + b);

test('工房の11実験は共通プレーヤーで計算でき、配信と根拠保存に同じ条件を使う', () => {
  assert.equal(LAB_PRESETS.length, 11);
  for (const preset of LAB_PRESETS) {
    const plan = makeLabPlan(preset.id, { grade: '小6' });
    const lesson = labMaterial(plan);
    const cfg = lesson.sim.config;
    const system = getSystem(cfg.system);
    const engine = createEngine(system, cfg);
    for (let i = 0; i < 12; i++) engine.step();
    assert.equal(cfg.curriculum.grade, '小6');
    assert.ok(engine.y.every(Number.isFinite), preset.id);
    const run = captureRun({ engine, config: cfg, materialId: 'lab-m1', seat: 1 });
    const packed = parseContext(encodeContext({ schema: 1, rootId: 'lab-m1', materialId: 'lab-m1', runs: [run] }));
    assert.deepEqual(packed.runs[0].config, cfg, preset.id);
  }
});

test('浮くときは密度比まで沈み、底に着いたときは底も物体を支える', () => {
  const floating = experiment('buoyancy', 16).observe();
  close(floating.percent, 65, 0.01);
  close(floating.up, floating.down, 0.005);
  const sunken = experiment('buoyancy', 16, [{ key: 'rhoObject', value: 2200 }]).observe();
  assert.equal(sunken.contact, true);
  assert.equal(sunken.percent, 100);
  close(sunken.up + sunken.normal, sunken.down, 0.0001);
});

test('ドップラー効果は前後で周波数が分かれ、超音速で不正な前方周波数を出さない', () => {
  const subsonic = experiment('doppler', 0.04).observe();
  close(subsonic.front, 880, 1e-8);
  close(subsonic.back, 440 / 1.5, 1e-8);
  const supersonic = experiment('doppler', 0.04, [{ key: 'mach', value: 1.25 }]).observe();
  assert.equal(supersonic.front, null);
  close(supersonic.cone, Math.asin(0.8) * 180 / Math.PI, 1e-8);
});

test('二重振り子は同じ条件を再現でき、初期角度を変えても各実験のエネルギーは保存する', () => {
  const a = experiment('doublependulum', 8);
  assert.deepEqual(a.y, experiment('doublependulum', 8).y);
  const b = experiment('doublependulum', 8, [{ key: 'angle2', value: 101 }]);
  assert.notDeepEqual(a.observe().second, b.observe().second);
  for (const run of [a, b]) close(run.observe().energy.total, run.system.model.energy(run.y0, run.p).total, 0.002);
});

test('板の近似は間隔に応じて連鎖し、届かないときは最初の板だけが倒れる', () => {
  assert.equal(experiment('domino', 8).observe().fallen, 10);
  const wide = experiment('domino', 8, [{ key: 'gap', value: 0.25 }]).observe();
  assert.equal(wide.fallen, 1);
  assert.equal(wide.hitCount, 0);
});

test('宇宙速度の参考値は地表の円軌道、地球脱出、順方向の太陽脱出を区別する', () => {
  const speeds = cosmicSpeeds();
  [7.91, 11.19, 16.65].forEach((value, i) => close(speeds[i], value, 0.02));
});

test('Gemmaの案は登録済み条件だけ。未対応、範囲外、コード付きの提案を区別する', async () => {
  const response = (json) => async (request) => {
    assert.ok(request.user.includes('物体の密度'));
    return { json };
  };
  const query = (json) => proposeLab('水に浮くものを比べたい', 6, response(json));
  const ok = await query({ preset: 'buoyancy', edits: [{ key: 'rhoObject', value: 810 }], reason: '物体の密度だけ変える' });
  assert.equal(ok.plan.config.params.rhoObject, 810);
  assert.equal(ok.plan.config.curriculum.grade, '小6');
  assert.equal((await query({ preset: 'unsupported', edits: [], reason: '扱うモデルがない' })).unsupported, true);
  await assert.rejects(query({ preset: 'buoyancy', edits: [{ key: 'rhoObject', value: -1 }], reason: '' }), /範囲外/);
  await assert.rejects(query({ preset: 'buoyancy', edits: [], reason: '', code: 'alert(1)' }), /形式/);
});
