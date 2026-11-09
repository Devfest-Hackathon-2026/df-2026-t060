// 児童の実験助手の「ことばの読みとり」(AIなし)。辞書 student-words.json を編集したら、これが通るか確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localAction } from '../public/js/sim2/core/assistant.js';
import { getSystem } from '../public/js/sim2/systems/index.js';
import { judge } from '../eval/run-student.mjs';

const cfg = (s, i = 0) => getSystem(s).examples[i].config;
const rate = (file) => {
  const reqs = readFileSync(new URL(`../eval/${file}`, import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return reqs.filter((r) => { const [sys, n] = r.base.split('#'); return !judge(r, localAction(cfg(sys, Number(n)), r.text)).length; }).length / reqs.length;
};

test('「いと」を「糸」にするのは、糸のときだけ(「高いところ」「したいとき」はそのまま)', () => {
  assert.equal(localAction(cfg('projectile'), 'はじめの高さを高いところにして').changes?.[0]?.param, 'h0');
  assert.equal(localAction(cfg('pendulum'), 'いとをながくして').changes?.[0]?.param, 'L');
});
test('数と単位だけで条件が1つに決まるとき(30度で投げて)', () => {
  const a = localAction(cfg('projectile'), 'ボールを30度で投げて');
  assert.deepEqual(a.changes?.[0], { param: 'angle', op: 'set', value: 30 });
});
test('条件の名前のあとのプリセットのことばは、プリセットにしない(焦点をもっと遠くに)', () => {
  assert.equal(localAction(cfg('lens'), '焦点をもっと遠くにして').changes?.[0]?.param, 'f');
  assert.equal(localAction(cfg('lens'), '遠くにおいて').action, 'preset');
});
test('0 の条件も「速く」で動く', () => {
  const a = localAction(cfg('projectile'), 'ボールを速く投げて');
  assert.equal(a.changes?.[0]?.param, 'v0');
  assert.ok(a.changes[0].value > 0);
});
test('評価セットの正答率が下がっていない', () => {
  assert.ok(rate('student-requests.jsonl') >= 0.98);
  assert.ok(rate('student-holdout.jsonl') >= 0.95);
  assert.ok(rate('student-blind.jsonl') >= 0.9);
});
