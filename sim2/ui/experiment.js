// 全単元共通の探究ノート。観測の保存・比較・説明・次の問いを担当する。
import { el } from '../../common.js';
import { downloadCsv } from '../../sim-data.js';
import { captureRun, openNotebook, encodeContext, copy, describeConditions, modelLabel } from '../../inquiry-data.js';
import { createComparison } from './inquiry-compare.js';
import { createInquiryAdvance } from '../../inquiry-advance.js';
import { createUnderstandingPanel } from '../../understanding-panel.js';
import { currentSelf } from '../../understanding-core.js';
import { createInquiryFlow, guideTo, guideRecords } from '../../inquiry-flow.js';

export function createExperiment(o) {
  const ctx = o.inquiry ?? {}, book = openNotebook(ctx, o.config().system), data = book.data;
  const rows = data.runs, sourceRuns = ctx.sources ?? [];
  const selected = new Set(rows.slice(-2).map((r) => r.id));
  let flow = null;
  const message = el('p', { class: 'inq-message', role: 'status' });
  const save = () => { try { book.save(); return true; } catch (e) { message.textContent = e.message; return false; } };
  function input(label, key, placeholder, max = 600) {
    const f = el('textarea', { rows: 2, maxlength: max, 'aria-label': label, placeholder });
    f.value = data.drafts[key] ?? '';
    f.oninput = () => { data.drafts[key] = f.value; save(); };
    
    return f;
  }
  const prediction = input('予想', 'prediction', '何を変えると、何が変わると思う？ 理由も書こう');
  const observation = input('観察したこと', 'observation', '実際に見えたこと・測れたことを書こう');
  const predictPanel = el('div', { class: 's2-panel inq-predict' }, el('h3', {}, '① 予想をつくる'), el('label', {}, '実験の前に考えてみよう', prediction));
  const recordBtn = el('button', { type: 'button', class: 's2-btn primary', 'data-action': 'record-run' }, 'この実験を記録');
  const recordBox = el('div', { class: 'inq-record' }, el('h3', {}, '② 観察して記録する'), el('label', {}, '何が起きた？', observation), recordBtn, message);
  recordBtn.onclick = () => {
    if (!(o.engine().t > 0)) { guideTo(o.playButton, 'まず「再生」で実験を動かそう。'); return; }
    if (!observation.value.trim()) { guideTo(observation, 'ここに、実験で見えたこと・気づいたことを書こう。'); return; }
    try {
      o.pause();
      const run = captureRun({ engine: o.engine(), config: o.config(), prediction: prediction.value, observation: observation.value,
        seat: ctx.seat ?? 0, materialId: ctx.materialId ?? '', sourceIds: sourceRuns.map((r) => r.id), trace: o.trace() });
      if (rows.some((r) => r.elapsed === run.elapsed && JSON.stringify(r.config) === JSON.stringify(run.config) && r.observation === run.observation)) throw new Error('同じ記録は保存済みです');
      rows.push(run); selected.add(run.id);
      if (save()) message.textContent = `記録${rows.length}を保存しました。再読込しても残ります`;
      renderResult(); api.show('結果');
    } catch (e) { message.textContent = e.message; }
  };
  const resultPanel = el('div', { class: 's2-panel inq-results' });
  const reflection = el('div', { class: 'inq-reflection' });
  const history = el('details', { class: 'inq-history' });
  const parts = [['result', '結果', '何が分かった？'], ['evidence', '根拠', 'どの記録のどの数値・軌道から言える？'], ['reason', '理由', 'なぜそう考えた？ モデルのしくみとつなげよう'], ['unknown', 'まだ分からないこと', '次に測りたいこと・このモデルで確かめられないことは？']];
  const meters = el('div', { class: 'inq-aspects', 'aria-label': '説明に記述した観点' }), fields = {};
  function updateAspects() { meters.replaceChildren(...parts.map(([k, l]) => el('span', { class: data.reflection[k]?.trim() ? 'written' : '' }, `${data.reflection[k]?.trim() ? '●' : '○'} ${l}`))); }
  for (const [k, label, placeholder] of parts) {
    const f = el('textarea', { rows: 2, maxlength: 600, 'aria-label': `説明の${label}`, placeholder }); f.value = data.reflection[k] ?? ''; fields[k] = f;
    f.oninput = () => { data.reflection[k] = f.value; updateAspects(); save(); };
    reflection.append(el('label', {}, label, f)); 
  }
  function showHistory() {
    history.replaceChildren(el('summary', {}, `これまでの説明（${data.savedExplanations.length}件）`), ...[...data.savedExplanations].reverse().map((r) => el('article', {}, el('p', { class: 's2-note' }, new Date(r.at).toLocaleString('ja-JP')), ...parts.map(([k, l]) => el('p', {}, el('b', {}, `${l}：`), r.text[k] || '（記述なし）')))));
  }
  const reflectMsg = el('p', { role: 'status', class: 'inq-message' });
  const saveReflection = el('button', { type: 'button', class: 's2-btn', onclick: () => {
    if (!Object.values(data.reflection).some((v) => v.trim())) { guideTo(fields.result, '結果・根拠・理由のうち、説明を1つ以上書こう。'); return; }
    data.savedExplanations.push({ at: Date.now(), text: copy(data.reflection), recordIds: [...selected] });
    if (save()) { reflectMsg.textContent = '説明を保存しました。前の説明と見比べられます'; showHistory(); }
  } }, 'この説明を保存');
  reflection.prepend(el('h3', {}, '④ 実験を見ながら、自分の言葉で説明する'), el('p', { class: 's2-note' }, '下の印は「書いた観点」です。正しさや理解度の点数ではありません。'), meters);
  reflection.append(saveReflection, reflectMsg, history); updateAspects(); showHistory();
  const question = input('次の問い', 'question', '記録を根拠に、次は何を確かめたい？', 200);
  const shareMsg = el('p', { role: 'status', class: 'inq-message' });
  const share = el('button', { type: 'button', class: 's2-btn primary', disabled: !ctx.onShare }, '根拠と問いを先生へ送る');
  share.onclick = async () => {
    if (!question.value.trim()) { guideTo(question, 'ここに、次に確かめたい問いを書こう。'); return; }
    const own = rows.filter((r) => selected.has(r.id));
    if (!own.length) { guideRecords(questionPanel, '自分で実行した記録を1件以上選ぼう。記録がなければ、まず実験を記録しよう。'); return; }
    try {
      share.disabled = true;
      const runs = [...sourceRuns.slice(-2), ...own.slice(-4)].filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i);
      const inquiryContext = encodeContext({ schema: 1, rootId: ctx.rootId ?? ctx.materialId ?? 'local', materialId: ctx.materialId ?? '', revision: ctx.revision ?? 1, question: question.value.trim(), runs, reflection: data.reflection, understanding: currentSelf(data, ctx, runs) });
      const delivery = await ctx.onShare({ text: question.value.trim(), inquiryContext });
      shareMsg.textContent = delivery?.queued ? '根拠つきの問いを送信待ちに入れました。Bluetoothでつながると先生へ届きます。' : '根拠つきの問いを送りました。先生が確認してからクラスへ届きます';
    } catch (e) { shareMsg.textContent = `送れませんでした: ${e.message}。記録は端末に残っています`; }
    finally { share.disabled = false; }
  };
  const questionPanel = el('div', { class: 'inq-next' }, el('h3', {}, '⑤ 次の問いをクラスにつなぐ'), el('label', {}, '次に調べること（200字まで）', question), share, shareMsg, !ctx.onShare ? el('p', { class: 's2-note' }, 'クラスの教材を開くと、先生に送れます') : null);
  // 発展パネルも元の探究ノートへ保存する。
  const advance = createInquiryAdvance({
    book,
    context: ctx,
    sources: sourceRuns,
    selectedIds: () => [...selected],
    onQuestion: (text) => {
      question.value = text;
      data.drafts.question = text;
      save();
    },
    replay: (run) => {
      o.apply(run.config);
      api.show('実験');
    }
  });
  saveReflection.addEventListener(
    'click',
    () => queueMicrotask(() => advance.refresh())
  );
  resultPanel.addEventListener('change', (event) => {
    if (event.target.type === 'checkbox') advance.refresh();
  });
  const understanding = createUnderstandingPanel({ book, context: ctx, selectedIds: () => [...selected], replay: (id) => {
    const run = [...sourceRuns, ...rows].find(r => r.id === id);
    if (!run) { shareMsg.textContent = 'その記録はこの端末では見つかりません。'; return; }
    o.apply(run.config); api.show('実験');
  } });
  resultPanel.addEventListener('input', (event) => { if (event.target.matches('textarea[aria-label^="説明の"], textarea[aria-label^="研究計画の"], textarea[aria-label="次の問い"]')) understanding.refresh(); });
  resultPanel.addEventListener('change', (event) => { if (event.target.type === 'checkbox') understanding.refresh(); });
  function compareOptions() { return { onStart: o.pause, context: { prediction: prediction.value, seat: ctx.seat ?? 0, materialId: ctx.materialId ?? '', sourceIds: sourceRuns.map((r) => r.id) }, onRecord: (runs) => { rows.push(...runs); selected.clear(); runs.forEach((r) => selected.add(r.id)); save(); renderResult(true); message.textContent = '比較の2件を保存しました。「比較・説明・次の問い」を開き直すと履歴に出ます'; } }; }
  let comparison = null;
  function renderResult(preserve = false) {
    const kept = preserve ? comparison : null;
    if (!preserve) { comparison?.destroy(); comparison = null; }
    const compareHost = el('div', {}), compareMsg = el('p', { class: 'inq-message', role: 'status' }), all = [...sourceRuns, ...rows];
    const detailList = el('details', { class: 'inq-history', open: false }, el('summary', {}, `実験の履歴（自分${rows.length}件・引き継いだ根拠${sourceRuns.length}件）`));
    for (const r of all) {
      const own = rows.includes(r), cb = el('input', { type: 'checkbox', checked: selected.has(r.id), 'aria-label': `${own ? '自分の' : '引き継いだ'}記録を比較に選ぶ` });
      cb.onchange = () => cb.checked ? selected.add(r.id) : selected.delete(r.id);
      detailList.append(el('article', { class: 'inq-run', 'data-run-id': r.id }, el('label', { class: 'inq-pick' }, cb, `${own ? '自分の記録' : `${r.seat}番からの根拠`} · ${modelLabel(r.config)} · ${r.status}`),
        el('p', { class: 's2-note' }, describeConditions(r.config)), el('p', {}, `予想：${r.prediction || '（未記述）'}`), el('p', {}, `観察：${r.observation}`),
        el('p', { class: 's2-note' }, r.measures.map((m) => `${m.label}：${m.value == null ? '未測定' : Number(m.value.toPrecision(5)) + ' ' + m.unit}`).join(' / ')),
        el('button', { type: 'button', class: 's2-btn', onclick: () => { o.apply(r.config); message.textContent = '記録と同じ条件に戻しました。「再生」で自分でも確かめよう'; api.show('実験'); } }, '同じ条件で再実験'),
        own ? el('button', { type: 'button', class: 's2-btn', onclick: () => { if (!confirm('この端末の記録を削除しますか？ 送信済みの記録は残ります。')) return; rows.splice(rows.indexOf(r), 1); selected.delete(r.id); save(); renderResult(); } }, 'この記録を削除') : null));
    }
    const compare = el('button', { type: 'button', class: 's2-btn', 'data-action': 'compare-runs', onclick: () => {
      const chosen = all.filter((r) => selected.has(r.id)); if (chosen.length !== 2) { if (all.length) guideTo(detailList, '比較したい記録を、ちょうど2件選ぼう。'); else guideRecords(resultPanel, 'まず実験を記録しよう。比較には2件の記録を使います。'); return; }
      comparison?.destroy(); try { comparison = createComparison(compareHost, chosen.map((r) => r.config), compareOptions()); compareMsg.textContent = '記録の条件から新しく計算する再現です。元の観測時間は書き換えません'; } catch (e) { compareMsg.textContent = e.message; }
    } }, '選んだ2件を同じ時間・倍率で比べる');
    const plan = ctx.comparison;
    const planBtn = plan?.configs?.length === 2 ? el('button', { type: 'button', class: 's2-btn primary', 'data-action': 'approved-comparison', onclick: () => { comparison?.destroy(); comparison = createComparison(compareHost, plan.configs, compareOptions()); compareMsg.textContent = `先生が確認した比較案：${plan.rationale}`; } }, '先生の比較案を2つ同時に動かす') : null;
    const csv = () => [['ID', '出席番号', 'モデル', '観察時間(s)', '条件JSON', '予想', '観察'], ...rows.map((r) => [r.id, r.seat, r.config.system, r.elapsed, JSON.stringify(r.config.params), r.prediction, r.observation])];
    const exportJSON = el('button', { class: 's2-btn', type: 'button', onclick: () => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); el('a', { href: url, download: '探究ノート.json' }).click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } }, 'ノートを書き出す(JSON)');
    resultPanel.replaceChildren(el('h3', {}, '③ 根拠を選んで比べる'), detailList, el('div', { class: 's2-btns' }, compare, planBtn, el('button', { type: 'button', class: 's2-btn', onclick: () => downloadCsv('実験の記録.csv', csv()) }, 'CSV'), exportJSON), compareMsg, compareHost, reflection, understanding.node, advance.node, questionPanel);
        if (kept) compareHost.append(kept.root);
    advance.refresh(); understanding.refresh(); flow?.refresh();
  }
  const tabBtns = ['予想', '実験', '結果'].map((name) => [name, el('button', { type: 'button', class: 's2-tab', 'aria-pressed': 'false', onclick: () => api.show(name) }, name === '結果' ? '比較・説明・次の問い' : name)]);
  const tabs = el('div', { class: 's2-tabs' }, ...tabBtns.map(([, b]) => b));
  const api = { tabs, predictPanel, resultPanel, recordBox, rows,
    show(name) { if (name === '結果') renderResult(); o.onTab?.(name); flow?.show(name); }, destroy() { comparison?.destroy(); flow?.destroy(); advance.destroy(); understanding.destroy(); } };
  renderResult();
  flow = createInquiryFlow({ api, data, rows, prediction, observation, reflection, questionPanel, understanding: understanding.node, advance: advance.node, recordBox, engine: o.engine, playButton: o.playButton, pause: o.pause, save });
  return api;
}
