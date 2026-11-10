// 児童の「実験助手」の画面。シミュレーションの下に置く。
// - 生徒が言葉で頼む → 端末のAI(Gemma 4 E2B / 3 1B)が「変更の内容」の JSON だけを出す
//   (AIがないときは、ことばの照らし合わせで読む)→ アプリで計算・範囲・説明を行う
// - 変更前と変更後の値を見せる。範囲の外は「〜までだよ」
// - くらべる:2〜3つの条件をならべて同時に動かす
// - わからないとき:「こんなふうに言ってみてね」の例文を3つ
import { el } from '../../common.js';
import { assistantPrompt, actionSchema, applyAction, localAction, exampleSentences } from '../core/assistant.js';
import { isElementary } from '../core/constants.js';
import { rubyNodes } from '../core/ruby.js';
import { mountSimulation } from './player.js';
import { recordMiss, listMisses, clearMisses, exportMisses } from '../core/word-log.js';

/**
 * @param {HTMLElement} host
 * @param {{ getConfig: () => object, setConfig: (c: object) => void, base: object,
 *           ai?: { ready: () => boolean, label: () => string, generateJSON: (prompt, schema, maxTokens, system) => Promise<{json, ms}> } }} o
 */
export function mountAssistant(host, o) {
  const cfg0 = o.getConfig();
  const elem = isElementary(cfg0.curriculum.grade);
  const T = (s) => (elem ? rubyNodes(s) : [s]);
  const input = el('input', { type: 'text', class: 's2-text', maxlength: 100, placeholder: '例:ひもをながくして / 月でやったらどうなる?', 'aria-label': '実験助手へのおねがい' });
  const btn = el('button', { type: 'button', class: 's2-btn primary' }, ...T('おねがいする'));
  const status = el('p', { class: 's2-note' });
  const out = el('div', { class: 's2-panel', 'aria-live': 'polite' });
  const compareHost = el('div', { class: 's2-compare' });

  const setStatus = () => {
    const ready = o.ai?.ready?.();
    status.replaceChildren(...T(ready ? `実験助手:${o.ai.label()}(この端末の中で動いています)` : '実験助手:AIなしで、ことばを読みます(スライダーでも変えられます)'));
  };
  setStatus();
  

  async function ask(textArg) {
    const text = (textArg ?? input.value).trim();
    if (!text) return;
    btn.disabled = true;
    const t0 = performance.now();
    const config = o.getConfig();
    let action, how;
    // まずAIなし(ことばの照らし合わせ)で読む。読めないときだけ端末のAIにたのむ
    // (評価:ことばだけ 88%、小さいAIだけ 40%。ことばを先にしたほうが、速くて正しい)
    action = localAction(config, text); how = 'ことば';
    try {
      if (action.action === 'unknown' && o.ai?.ready?.()) {
        out.replaceChildren(el('p', { class: 's2-note' }, ...T('考えています…')));
        // Gemma は「システムの指示」の欄がないので、指示を生徒の言葉の前にまとめて入れる
        // (WebLLM でシステムの欄に入れると、指示が届かず、いつも同じ答えになった)
        const r = await o.ai.generateJSON(`${assistantPrompt(config.system, config.curriculum.grade)}\n\n生徒:${text}`, actionSchema(config.system, config.curriculum.grade), 120, null);
        action = r.json ?? { action: 'unknown' };
        how = o.ai.label();
      }
    } catch { action = { action: 'unknown' }; }
    const ms = Math.round(performance.now() - t0);
    const result = applyAction(config, action, { base: o.base });
    // ことばで読めなかったとき(AIが読んだときも)は、この端末の中だけに記録する(先生が辞書を育てるため)
    if (how !== 'ことば' || result.kind === 'unknown') {
      recordMiss({ text, system: config.system, grade: config.curriculum.grade, how, action: how !== 'ことば' && result.kind !== 'unknown' ? action : null });
      updateLog();
    }
    show(result, how, ms);
    btn.disabled = false;
    setStatus();
  }
  btn.addEventListener('click', () => ask());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } });

  function changeTable(changes) {
    return el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, ...T('条件')), el('th', {}, ...T('前')), el('th', {}, ''), el('th', {}, ...T('後')))),
      el('tbody', {}, ...changes.map((c) => el('tr', {}, el('td', { style: 'text-align:left' }, ...T(c.label)),
        el('td', { class: 'num' }, `${c.before} ${c.unit}`), el('td', {}, '→'), el('td', { class: 'num' }, `${c.after} ${c.unit}`)))));
  }

  function show(r, how, ms) {
    compareHost.replaceChildren();
    const meta = el('p', { class: 's2-note' }, `(${how}・${ms} ms)`);
    const msgs = r.messages.map((m) => el('p', { class: 's2-q' }, ...T(m)));
    if (r.kind === 'set' || r.kind === 'preset' || r.kind === 'reset') {
      o.setConfig(r.config);
      out.replaceChildren(...msgs, r.changes?.length ? changeTable(r.changes) : null, meta);
    } else if (r.kind === 'compare') {
      out.replaceChildren(el('p', { class: 's2-q' }, ...T('条件をならべて、同時に動かしてくらべよう')), ...msgs, meta);
      const grid = el('div', { class: 's2-compare-grid' });
      r.variants.forEach((c, i) => {
        const box = el('div', {});
        const label = (r.changes[i] ?? []).map((x) => `${x.label} ${x.after}${x.unit}`).join('、') || 'いまの条件';
        grid.append(el('div', {}, el('p', { class: 's2-note' }, ...T(label)), box));
        mountSimulation(box, c, { compact: true });
      });
      compareHost.replaceChildren(grid);
    } else if (r.kind === 'explain') {
      out.replaceChildren(el('div', { class: 's2-explain' }, el('b', {}, ...T(r.explanation.title)), el('p', {}, ...T(r.explanation.text))), meta);
    } else {
      out.replaceChildren(...msgs,
        el('div', { class: 's2-choices' }, ...(r.examples ?? []).map((s) => {
          const b = el('button', { type: 'button', class: 's2-btn' }, ...T(s));
          b.addEventListener('click', () => { input.value = s; ask(s); });
          return b;
        })), meta);
    }
  }

  // わからなかったことば(この端末の中だけ)。生徒が押したときだけ、先生にわたすファイルを作る
  const logCount = el('span', {});
  const logBox = el('details', { class: 's2-note s2-wordlog' },
    el('summary', {}, ...T('わからなかったことば'), ' ', logCount),
    el('p', {}, ...T('実験助手がわからなかった言い方を、この端末の中だけに記録しています。先生にわたすと、次から読めるようになります。')),
    el('div', { class: 's2-btns' },
      el('button', { type: 'button', class: 's2-btn', onclick: () => {
        const list = listMisses();
        if (!list.length) return;
        const blob = new Blob([JSON.stringify(exportMisses(list), null, 2)], { type: 'application/json' });
        const a = el('a', { href: URL.createObjectURL(blob), download: `ことばの記録-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } }, ...T('先生にわたすファイルを作る')),
      el('button', { type: 'button', class: 's2-btn', onclick: () => { clearMisses(); updateLog(); } }, ...T('記録を消す'))));
  function updateLog() { const n = listMisses().reduce((a, x) => a + (x.count ?? 1), 0); logCount.textContent = `(${n}件)`; logBox.hidden = n === 0; }
  updateLog();

  host.replaceChildren(el('div', { class: 's2 s2-assistant' },
    el('p', { class: 's2-q' }, ...T('実験助手にたのもう')),
    el('div', { class: 'stack tight' }, input, btn), status, out, compareHost, logBox));
  let unsubscribe = o.ai?.subscribe?.(() => { if (!host.isConnected) { unsubscribe?.(); return; } setStatus(); });
  return { ask };
}
