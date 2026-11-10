// 先生が「観測の根拠 → 比較案 → 配信前の確認」を行う画面部品。
import { el } from './common.js';
import { parseContext, localPlan, checkedConfig, changesBetween, copy, describeConditions, modelLabel, conditionLabel } from './inquiry-data.js';
import { createComparison } from './sim2/ui/inquiry-compare.js';
import { teacherUnderstandingCard } from './understanding-panel.js';
const cache = new Map();
export function evidenceCard(q, { ai, useDraft, sendReview }) {
  if (!q.inquiryContext) return null;
  if (cache.get(q.id)?.data === q.inquiryContext) { const old = cache.get(q.id); if (q.status === 'done' && old.status !== 'done') old.node.open = false; old.status = q.status; return old.node; }
  let context;
  try { context = parseContext(q.inquiryContext); }
  catch (e) { return el('p', { class: 'warn' }, `根拠を開けません: ${e.message}`); }
  const box = el('details', { class: 'inq-evidence' }, el('summary', {}, `根拠つきの問い · 実験${context.runs.length}件 · 探究の改訂${context.revision}`));
  const list = el('div', {}, ...context.runs.map((r) => el('article', { class: 'inq-run' },
    el('b', {}, `${r.seat}番 · ${r.status}`), el('p', {}, r.observation),
    el('p', { class: 's2-note' }, `モデル ${modelLabel(r.config)} / ${describeConditions(r.config)}`))));
  const planHost = el('div', {}), msg = el('p', { class: 'inq-message', role: 'status' });
  let preview = null;
  function editPlan(plan) {
    const answer = el('textarea', { rows: 3, maxlength: 600, 'aria-label': '質問への答えの案' }); answer.value = plan.answer ?? '';
    const question = el('textarea', { rows: 2, maxlength: 200, 'aria-label': 'クラスで確かめる問い' }); question.value = plan.question;
    const rationale = el('textarea', { rows: 2, maxlength: 600, 'aria-label': 'この比較を選んだ理由' }); rationale.value = plan.rationale;
    const distinguish = el('textarea', { rows: 2, maxlength: 600, 'aria-label': '何を見れば見分けられるか' }); distinguish.value = plan.distinguish;
    const values = plan.configs.map((c, i) => el('input', { type: 'number', step: 'any', value: c.params[plan.target], 'aria-label': `比較${i ? 'B' : 'A'}の${plan.target}` }));
    const read = () => {
      const configs = plan.configs.map((c, i) => checkedConfig({ ...c, params: { ...c.params, [plan.target]: Number(values[i].value) } }));
      if (changesBetween(...configs).length !== 1) throw new Error('変える条件は1つにし、AとBの値を変えてください');
      if (!question.value.trim() || !rationale.value.trim() || !distinguish.value.trim()) throw new Error('問い・比較の理由・見るものを入力してください');
      return { ...plan, answer: answer.value.trim(), question: question.value.trim(), rationale: rationale.value.trim(), distinguish: distinguish.value.trim(), configs };
    };
    const simHost = el('div', {});
    const check = el('button', { class: 's2-btn', type: 'button', onclick: () => { try { const p = read(); preview?.destroy(); preview = createComparison(simHost, p.configs); } catch (e) { msg.textContent = e.message; } } }, '配信前に2つを動かして確認');
    const draft = el('button', { class: 's2-btn primary', type: 'button', 'data-action': 'prepare-inquiry-draft', onclick: () => {
      try { useDraft(read(), context, q); msg.textContent = '配信フォームに入れました。文章・実験条件・出所を確認して「配信する」を押してください'; } catch (e) { msg.textContent = e.message; }
    } }, '確認用の教材フォームに入れる');
    planHost.replaceChildren(el('p', { class: 'inq-source' }, plan.source), el('label', {}, '質問への答えの案（先生が確認）', answer), el('label', {}, 'クラスで確かめる問い', question),
      el('p', {}, `変える条件：${conditionLabel(plan.configs[0],plan.target)}（ほかの条件は同じ）`), el('div', { class: 's2-btns' }, ...values.map((v, i) => el('label', {}, i ? 'B' : 'A', v))),
      el('label', {}, 'この比較を選んだ理由', rationale), el('label', {}, '何を見れば見分けられるか', distinguish), el('div', { class: 's2-btns' }, check, draft), simHost);
  }
  const manual = el('button', { class: 's2-btn', type: 'button', 'data-action': 'manual-plan', onclick: () => { try { editPlan(localPlan(context)); } catch (e) { msg.textContent = e.message; } } }, 'Gemmaなしで比較案を編集');
  const gemma = el('button', { class: 's2-btn', type: 'button', onclick: async () => {
    gemma.disabled = true; msg.textContent = '先生PCのGemmaが、実際の実験記録を読んで比較案を考えています…';
    try { const out = await ai('/api/inquiry-plan', { inquiryContext: q.inquiryContext, question: q.text }); editPlan(out.plan); msg.textContent = 'AIの未承認案です。条件と根拠を確認してください'; }
    catch (e) { msg.textContent = `先生側AIに接続できません: ${e.message}。「Gemmaなしで比較案を編集」で続けられます`; }
    finally { gemma.disabled = false; }
  } }, '先生PCのGemmaに根拠から提案させる');
  const understandingCard = teacherUnderstandingCard(context, q, sendReview);
  box.append(list, el('details', {}, el('summary', {}, '生徒の説明'), ...Object.entries(context.reflection).map(([k, v]) => el('p', {}, `${k}: ${v}`))), ...(understandingCard ? [understandingCard] : []),
    el('div', { class: 's2-btns' }, manual, gemma), msg, planHost);
  cache.set(q.id, { data: q.inquiryContext, node: box, status: q.status });
  return box;
}
