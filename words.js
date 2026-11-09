// 先生の「ことばの辞書を育てる」画面。児童の端末の記録(word-log)を読みこみ、辞書に足す。
import { el } from './common.js';
import { aggregate, loadExtra, saveExtra, addEntry } from './sim2/core/word-log.js';
import { localAction, reloadWords, applyAction, exampleSentences } from './sim2/core/assistant.js';
import { SYSTEMS, getSystem, paramInfo } from './sim2/systems/index.js';

const $ = (id) => document.getElementById(id);
let files = [];
const baseConfig = (system, grade) => {
  const ex = getSystem(system).examples;
  const c = (grade && ex.find((e) => e.config.curriculum.grade === grade)) ?? ex[0];
  return c.config;
};
const label = (system) => getSystem(system)?.label ?? system;

/** いまの辞書でどう読まれるか(ことばだけ) */
function reading(system, grade, text) {
  const cfg = baseConfig(system, grade);
  const a = localAction(cfg, text);
  const r = applyAction(cfg, a, { base: cfg });
  if (r.kind === 'set' || r.kind === 'preset' || r.kind === 'reset') return { ok: true, text: r.changes?.map((c) => `${c.label} ${c.before}→${c.after}${c.unit}`).join('、') || r.messages.join(' ') };
  if (r.kind === 'explain') return { ok: true, text: `説明「${r.explanation.title}」` };
  if (r.kind === 'compare') return { ok: true, text: 'くらべる' };
  return { ok: false, text: '読めない' };
}

/** AIが読んだ答えから、条件と向きの候補を出す */
function guess(item) {
  const a = item.ai, cfg = baseConfig(item.system, item.grade);
  const c = a?.action === 'set' ? a.changes?.[0] : null;
  if (!c || !(c.param in cfg.params)) return null;
  const cur = cfg.params[c.param];
  const after = c.op === 'mul' ? cur * c.value : c.op === 'add' ? cur + c.value : c.value;
  return { param: c.param, dir: after >= cur ? 'up' : 'down' };
}

/** 足す前と後で、各系の例文の読み方が変わらないか(こわしていないか) */
function regression(extra) {
  const before = [], after = [];
  const sents = Object.keys(SYSTEMS).flatMap((s) => { try { return exampleSentences(s, baseConfig(s).curriculum.grade).map((t) => [s, t]); } catch { return []; } });
  reloadWords(loadExtra()); for (const [s, t] of sents) before.push(JSON.stringify(localAction(baseConfig(s), t)));
  reloadWords(extra); for (const [s, t] of sents) after.push(JSON.stringify(localAction(baseConfig(s), t)));
  reloadWords(loadExtra());
  return sents.filter((_, i) => before[i] !== after[i]).map(([s, t]) => `${label(s)}「${t}」`);
}

function row(item) {
  const params = paramInfo(item.system).filter((p) => !p.options);
  const g = guess(item);
  const kind = el('select', {}, el('option', { value: 'phrase' }, '言い回し(この言葉があれば)'), el('option', { value: 'alias' }, '条件の別名'));
  const match = el('input', { value: item.text, 'aria-label': '辞書に入れる言葉' });
  const param = el('select', {}, ...params.map((p) => el('option', { value: p.key }, p.label.replace(/\(.*\)/, ''))));
  const dir = el('select', {}, el('option', { value: 'up' }, '大きく(上げる)'), el('option', { value: 'down' }, '小さく(下げる)'));
  if (g) { param.value = g.param; dir.value = g.dir; }
  kind.addEventListener('change', () => { dir.hidden = kind.value === 'alias'; });
  const result = el('span', { class: 's2-note' });
  const entry = () => kind.value === 'alias'
    ? { type: 'alias', system: item.system, param: param.value, word: match.value.trim() }
    : { type: 'phrase', system: item.system, match: match.value.trim(), param: param.value, dir: dir.value };
  const tryIt = () => {
    if (!match.value.trim()) return null;
    const extra = addEntry(loadExtra(), entry());
    reloadWords(extra);
    const r = reading(item.system, item.grade, item.text);
    reloadWords(loadExtra());
    result.className = r.ok ? 'ok' : 'warn';
    result.textContent = `足したら:${r.text}`;
    return { extra, r };
  };
  const now = reading(item.system, item.grade, item.text);
  return el('tr', {},
    el('td', { class: 'num' }, String(item.count)),
    el('td', {}, el('b', {}, item.text), el('br'), el('span', { class: 's2-note' }, `${label(item.system)}${item.grade ? `・${item.grade}` : ''}`)),
    el('td', {}, el('span', { class: now.ok ? 'ok' : 'warn' }, now.text), g ? el('div', { class: 's2-note' }, 'AIの読み:候補に入れました') : null),
    el('td', {}, el('div', { class: 'row-tools' }, kind, match, param, dir,
      el('button', { type: 'button', class: 's2-btn', onclick: tryIt }, '試す'),
      el('button', { type: 'button', class: 's2-btn primary', onclick: () => {
        const t = tryIt(); if (!t) return;
        if (!t.r.ok) { result.textContent += '(読めないので足していません)'; return; }
        const broke = regression(t.extra);
        if (broke.length && !confirm(`次の例文の読み方が変わります。足しますか?\n${broke.join('\n')}`)) return;
        saveExtra(t.extra); reloadWords(); render(); showExtra(broke);
      } }, '辞書に足す')), result));
}

function render() {
  const items = aggregate(files);
  if (!items.length) { $('list').replaceChildren(el('p', { class: 's2-note' }, files.length ? '記録がありません。' : 'まだ読みこんでいません。')); return; }
  $('list').replaceChildren(el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, '回数'), el('th', {}, '児童の言い方'), el('th', {}, 'いまの読み方'), el('th', {}, '辞書に足す'))),
    el('tbody', {}, ...items.filter((x) => SYSTEMS[x.system]).map(row))));
}
function showExtra(broke = []) {
  $('extra').textContent = JSON.stringify(loadExtra(), null, 2);
  $('check').textContent = broke.length ? `足しました(読み方が変わった例文:${broke.join('、')})` : '';
}

$('files').addEventListener('change', async (e) => {
  let ok = 0, bad = 0;
  for (const f of e.target.files) {
    try { const j = JSON.parse(await f.text()); if (j?.kind === 's2-word-log') { files.push(j); ok++; } else bad++; } catch { bad++; }
  }
  $('loadMsg').textContent = `${ok} 件のファイルを読みこみました${bad ? `(読めなかったファイル ${bad} 件)` : ''}`;
  e.target.value = '';
  render();
});
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(loadExtra(), null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `student-words-追加-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
});
$('reset').addEventListener('click', () => { if (confirm('この端末で足した辞書を消しますか?')) { saveExtra({}); reloadWords(); render(); showExtra(); } });
showExtra();
