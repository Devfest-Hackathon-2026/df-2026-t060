// 教材を根の問いごとにまとめ、クラスでの改訂と根拠のつながりを見せる。
import { el } from './common.js';
import { materialGroups } from './inquiry-data.js';
export function growthView(materials, open) {
  return el('div', { class: 'inq-growth' }, el('h3', {}, 'クラスで育った問い'),
    el('p', { class: 's2-note' }, '問いが増えただけでなく、誰のどの観測から次の教材になったかをたどれます。'),
    ...materialGroups(materials).filter((ms) => ms.some((m) => m.inquiry)).map((ms) => {
      const old = [...ms].reverse();
      return el('details', { class: 'inq-root', open: true }, el('summary', {}, `${ms[0].title} · 改訂${ms[0].inquiry?.revision ?? 1}`),
        el('ol', {}, ...old.map((m) => el('li', {},
          open ? el('button', { type: 'button', class: 's2-btn', onclick: () => open(m) }, `改訂${m.inquiry?.revision ?? 1}：${m.lesson?.question ?? m.title}`) : el('b', {}, `改訂${m.inquiry?.revision ?? 1}：${m.lesson?.question ?? m.title}`),
          el('p', { class: 's2-note' }, m.inquiry?.sources?.length ? `出発点：${[...new Set(m.inquiry.sources.map((r) => `${r.seat}番`))].join('・')}の実験${m.inquiry.sources.length}件。根拠の記録IDは教材に保存済み。` : '最初の問い'),
          ...(m.inquiry?.sourceQuestions ?? []).map((q) => el('p', {}, `生徒の問い：${q.text}`)),
          m.inquiry?.comparison ? el('p', {}, `比較を選んだ理由：${m.inquiry.comparison.rationale}`) : null))));
    }));
}
