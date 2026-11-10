// 児童の「わからなかったことば」の記録と、先生が足した辞書。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordMiss, listMisses, clearMisses, exportMisses, aggregate, addEntry, loadExtra, saveExtra } from '../public/js/sim2/core/word-log.js';
import { localAction, reloadWords } from '../public/js/sim2/core/assistant.js';
import { getSystem } from '../public/js/sim2/systems/index.js';

// node には localStorage がないので、メモリで代わりをする
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const cfg = (s) => getSystem(s).examples[0].config;

test('端末の中だけに記録し、同じ文が続いたら数を足す', () => {
  clearMisses();
  recordMiss({ text: 'ぶんぶんふって', system: 'pendulum', grade: '小5' });
  recordMiss({ text: 'ぶんぶんふって', system: 'pendulum', grade: '小5' });
  recordMiss({ text: '', system: 'pendulum' });
  assert.equal(listMisses().length, 1);
  assert.equal(listMisses()[0].count, 2);
});

test('いくつかの端末のファイルをまとめる(多い順)', () => {
  const a = exportMisses([{ text: 'ぶんぶんふって', system: 'pendulum', count: 2 }]);
  const b = exportMisses([{ text: 'ぶんぶんふって', system: 'pendulum', count: 1 }, { text: 'でんきを強く', system: 'circuit', count: 1 }]);
  const list = aggregate([a, b, { kind: 'ちがうファイル' }]);
  assert.deepEqual(list.map((x) => [x.text, x.count]), [['ぶんぶんふって', 3], ['でんきを強く', 1]]);
});

test('先生が足した言い回しで、読めなかった言い方が読めるようになる', () => {
  saveExtra({});
  reloadWords();
  assert.equal(localAction(cfg('pendulum'), 'ぶんぶんふって').action, 'unknown');
  saveExtra(addEntry(loadExtra(), { type: 'phrase', system: 'pendulum', match: 'ぶんぶん', param: 'theta0', dir: 'up' }));
  reloadWords();
  const a = localAction(cfg('pendulum'), 'ぶんぶんふって');
  assert.equal(a.changes?.[0]?.param, 'theta0');
  assert.ok(a.changes[0].value > cfg('pendulum').params.theta0);
  saveExtra({}); reloadWords();
});

test('先生が足した別名で、条件の名前として読める', () => {
  saveExtra(addEntry({}, { type: 'alias', system: 'circuit', param: 'V', word: 'でんきのつよさ' }));
  reloadWords();
  assert.equal(localAction(cfg('circuit'), 'でんきのつよさを上げて').changes?.[0]?.param, 'V');
  saveExtra({}); reloadWords();
});
