import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAB_SYSTEM_IDS } from '../public/js/lab-scope.js';
import { LAB_PRESETS, makeLabPlan, labMaterial } from '../public/js/hybrid-lab.js';
import { STUDIO } from '../public/js/studio-metrics.js';
import { validateConfig, SYSTEM_NAMES, getSystem } from '../public/js/sim2/systems/index.js';
import { runHeadless } from '../public/js/sim2/core/engine.js';
import { studioView } from '../public/js/sim2/render/studio-views.js';
import { checkView3d } from '../public/js/sim2/render/view3d.js';
import { changesBetween } from '../public/js/inquiry-data.js';

test('工房・登録モデル・教材を11件に揃え、別モデルや実行コードを配信しない', () => {
  const ids = [...LAB_SYSTEM_IDS].sort();
  assert.deepEqual(LAB_PRESETS.map(x => x.system).sort(), ids);
  assert.deepEqual([...SYSTEM_NAMES].sort(), ids);
  assert.deepEqual(Object.keys(STUDIO).sort(), ids);
  const { config } = makeLabPlan('solar');
  for (const patch of [{ system:'spring' }, { system:'constructor' }, { gen:'return 1' }, { ext:{ id:'freeform' } }]) {
    assert.notEqual(validateConfig({ ...config, ...patch }).length, 0);
    assert.throws(() => labMaterial({preset:'solar'}, { ...config, ...patch }));
  }
});

test('全11実験でおすすめの条件は1件だけ変わり、観察時刻まで計算・表示できる', () => {
  for (const preset of LAB_PRESETS) {
    const { config } = makeLabPlan(preset.id);
    const profile = STUDIO[config.system], system = getSystem(config.system);
    const variants = profile.pair.map(value => makeLabPlan(preset.id,{edits:[{key:profile.target,value}]}).config);
    assert.deepEqual(changesBetween(...variants), [profile.target], preset.id);
    for (const c of variants) {
      const e = runHeadless(system, c, profile.time);
      const observed = e.observe();
      const scene = studioView(e);
      assert.ok(e.steps > 0 && e.y.every(Number.isFinite), preset.id);
      assert.deepEqual(checkView3d(scene), [], preset.id);
      assert.ok(scene.bodies.length > 0 && scene.bodies.every(b => Number.isFinite(b.radius)), preset.id);
      assert.ok((scene.guides ?? []).every(g => g.points.every(p=>p.every(Number.isFinite))), preset.id);
      assert.ok(system.model.readouts(observed, e.p).some(r=>r.key===profile.key), preset.id);
    }
  }
});

test('8惑星を計算し、土星の環と月の模式表示を加える。測定値は3D表示用の縮尺に左右されない', () => {
  const { config } = makeLabPlan('solar');
  const e=runHeadless(getSystem('solar'), config, 1.05);
  const values=e.observe(), scene=studioView(e);
  assert.equal(values.planets.length, 8);
  assert.ok(Math.abs(values.Tmain-1)<.01);
  assert.ok(scene.bodies.find(b=>b.id==='saturn')?.ring);
  assert.ok(scene.bodies.find(b=>b.id==='moon')?.label.includes('模式'));
  assert.deepEqual(e.observe(),values);
});

test('板の接触が狭い間隔では最後へ届き、広げると隣に届かない', () => {
  const { config } = makeLabPlan('domino');
  const run = gap => runHeadless(getSystem('domino'),{...config,params:{...config.params,gap}}, 4).observe();
  const near=run(.08), far=run(.23);
  assert.equal(near.fallen,10);
  assert.equal(near.hitCount,9);
  assert.ok(near.lastHit > 0);
  assert.equal(far.fallen,1);
  assert.equal(far.hitCount,0);
  assert.deepEqual(run(.08),near);
});
