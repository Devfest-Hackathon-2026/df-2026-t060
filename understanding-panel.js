import { guideTo, guideRecords } from './inquiry-flow.js';
// 理解の3D振り返り。
// 本人の入力と、先生から受け取った確認を混ぜない。

import { el } from './common.js';

import {
  ASPECTS,
  emptyLevels,
  parseLevels,
  sameBasis,
  makeSelf,
  parseSelf,
  currentSelf,
  makeReview,
  parseReview
} from './understanding-core.js';

import {
  createUnderstandingView,
  disposeUnderstandingViews
} from './understanding-view3d.js';

export { disposeUnderstandingViews };

const received = new Map();
const subscribers = new Map();

const keyOf = context =>
  `${context.code ?? 'local'}:${context.seat ?? 0}`;

const quietly = fn => {
  try {
    return fn();
  } catch {
    return null;
  }
};

const time = value =>
  new Date(value).toLocaleString('ja-JP');

const stage = value =>
  value === null
    ? '未評価'
    : `段階${value}`;

// 他のレイアウトへ影響を広げないよう、
// このパネルの中に限定して装飾する。
const CSS = `
.iu-panel {
  border: 1px solid #9eb8d1;
  border-radius: 16px;
  background: #f4f8fd;
  padding: 16px;
  margin: 16px 0;
  min-width: 0;
  color: #18334c;
}

.iu-panel summary {
  font-weight: 700;
  cursor: pointer;
}

.iu-panel p {
  line-height: 1.65;
}

.iu-panel .iu-note {
  font-size: 13px;
  color: #52687c;
}

.iu-panel .iu-message {
  white-space: pre-wrap;
  color: #795024;
}

.iu-panel .iu-layout {
  display: grid;
  grid-template-columns:
    minmax(0, 1.3fr) minmax(190px, 1fr);
  gap: 16px;
  margin: 12px 0;
}

.iu-panel .iu-figure,
.iu-panel .iu-layout > div {
  min-width: 0;
}

.iu-panel canvas {
  display: block;
  width: 100%;
  height: 340px;
  border-radius: 13px;
  touch-action: none;
  background: #102236;
}

.iu-panel label {
  display: block;
  margin: 9px 0;
  font-weight: 600;
}

.iu-panel select,
.iu-panel textarea {
  font: inherit;
  box-sizing: border-box;
  width: 100%;
  padding: 8px;
  border: 1px solid #a4b8ce;
  border-radius: 8px;
  background: white;
  color: #18334c;
}

.iu-panel button {
  font: inherit;
  padding: 8px 12px;
  min-height: 42px;
  border: 1px solid #a4b8ce;
  border-radius: 8px;
  background: white;
  color: #18334c;
  cursor: pointer;
}

.iu-panel button:disabled {
  opacity: .55;
  cursor: default;
}

.iu-panel .iu-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 10px 0;
}

.iu-panel .iu-table {
  overflow: auto;
}

.iu-panel table {
  border-collapse: collapse;
  width: 100%;
  background: white;
}

.iu-panel td,
.iu-panel th {
  border: 1px solid #ccd8e5;
  padding: 8px;
  text-align: left;
  font-size: 13px;
}

.iu-panel .iu-rubric {
  font-size: 13px;
}

.iu-panel .iu-rubric li {
  margin: 7px 0;
}

.iu-panel .iu-basis p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.iu-panel :focus-visible {
  outline: 3px solid #edb54a;
  outline-offset: 2px;
}

@media (max-width: 900px) {
  .iu-panel .iu-layout {
    grid-template-columns: 1fr;
  }

  .iu-panel canvas {
    height: 320px;
  }
}
`;

function style() {
  if (
    !document.getElementById(
      'understandingStyle'
    )
  ) {
    document.head.append(
      el(
        'style',
        { id: 'understandingStyle' },
        CSS
      )
    );
  }
}

function levelSelect(
  aspect,
  prefix,
  value = null
) {
  const select = el(
    'select',
    {
      'aria-label':
        `${prefix}：${aspect.label}`
    },
    el(
      'option',
      { value: '' },
      '未評価'
    ),
    ...aspect.steps.map((s, i) =>
      el(
        'option',
        { value: i },
        `${i}：${s}`
      )
    )
  );

  select.value =
    value === null ? '' : String(value);

  return select;
}

function levelsFrom(fields) {
  return parseLevels(
    Object.fromEntries(
      ASPECTS.map(a => [
        a.key,
        fields[a.key].value === ''
          ? null
          : Number(fields[a.key].value)
      ])
    )
  );
}

// 立体だけに頼らず、同じ内容を表でも表示する。
function levelsTable(
  levels,
  comparison,
  comparisonLabel
) {
  return el(
    'div',
    { class: 'iu-table' },
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          ...[
            '観点',
            '表示中',
            comparisonLabel ?? '比較対象'
          ].map(t =>
            el(
              'th',
              { scope: 'col' },
              t
            )
          )
        )
      ),
      el(
        'tbody',
        {},
        ...ASPECTS.map(a =>
          el(
            'tr',
            {},
            el(
              'th',
              { scope: 'row' },
              a.label
            ),
            el(
              'td',
              {},
              `${stage(levels[a.key])}${
                levels[a.key] !== null
                  ? '：' + a.steps[levels[a.key]]
                  : ''
              }`
            ),
            el(
              'td',
              {},
              comparison
                ? stage(comparison[a.key])
                : '比較なし'
            )
          )
        )
      )
    )
  );
}

function rubric() {
  return el(
    'details',
    { class: 'iu-rubric' },
    el(
      'summary',
      {},
      '段階の目安を見る'
    ),
    el(
      'p',
      {},
      '0〜3はこの説明について振り返るための目安です。学力の総合点や他の人との順位ではありません。未評価は0とは別です。'
    ),
    el(
      'ul',
      {},
      ...ASPECTS.map(a =>
        el(
          'li',
          {},
          el('b', {}, a.label + '：'),
          a.steps.map(
            (s, i) => `${i} ${s}`
          ).join(' ／ ')
        )
      )
    )
  );
}

// 評価した時点の説明と実験記録を表示する。
function basisCard(assessment, replay) {
  const names = {
    result: '結果',
    evidence: '根拠',
    reason: '理由',
    unknown: '未解決',
    question: '次の問い',
    plan: '研究計画'
  };

  return el(
    'details',
    { class: 'iu-basis' },
    el(
      'summary',
      {},
      `評価した時点の説明と根拠（${
        time(assessment.at)
      }）`
    ),
    ...Object.entries(names).map(
      ([k, label]) =>
        el(
          'p',
          {},
          el('b', {}, label + '：'),
          assessment.basis[k] ||
            '（記述なし）'
        )
    ),
    ...assessment.recordIds.map(id =>
      replay
        ? el(
            'button',
            {
              type: 'button',
              onclick: () => replay(id)
            },
            `根拠の条件に戻る：${
              id.slice(0, 8)
            }`
          )
        : el(
            'p',
            { class: 'iu-note' },
            `根拠ID：${id}`
          )
    )
  );
}

// 既存の「自分宛の先生の返事」から確認結果を受け取る。
// 自己評価を、先生の確認として扱わない。
export function receiveUnderstandingReplies(
  replies,
  context
) {
  const scope = keyOf(context);

  const items =
    received.get(scope) ?? new Map();

  let changed = false;

  for (const reply of replies) {
    if (!reply.understandingReview) {
      continue;
    }

    const review = quietly(() =>
      parseReview(
        reply.understandingReview
      )
    );

    if (
      !review ||
      review.assessment.seat !== context.seat ||
      items.has(review.id)
    ) {
      continue;
    }

    items.set(review.id, review);
    changed = true;
  }

  received.set(scope, items);

  if (changed) {
    for (
      const fn of subscribers.get(scope) ??
        []
    ) {
      fn();
    }
  }
}

// 生徒用の入力・保存・比較パネル。
export function createUnderstandingPanel({
  book,
  context,
  selectedIds,
  replay
}) {
  style();

  const data = book.data;

  data.understanding ??= {
    selves: [],
    reviews: [],
    draft: emptyLevels()
  };

  const stored = data.understanding;

  stored.selves ??= [];
  stored.reviews ??= [];

  const initial = quietly(() =>
    parseLevels(stored.draft)
  ) ?? emptyLevels();

  const node = el(
    'details',
    {
      class: 'iu-panel',
      'data-understanding-panel':
        'student'
    },
    el(
      'summary',
      {},
      '理解のかたちを3Dで振り返る'
    )
  );

  const canvas = el('canvas', {});

  const caption = el(
    'p',
    { class: 'iu-note' }
  );

  const comparisonSelect = el(
    'select',
    {
      'aria-label': '3Dの比較対象'
    }
  );

  const tableHost = el('div', {});
  const basisHost = el('div', {});

  const message = el(
    'p',
    {
      class: 'iu-message',
      role: 'status'
    }
  );

  const fields = {};

  let view = null;
  let disposed = false;
  let comparisonTouched = false;

  const validSelves = () =>
    stored.selves.map(s =>
      quietly(() => parseSelf(s))
    ).filter(Boolean);

  const validReviews = () =>
    stored.reviews.map(r =>
      quietly(() => parseReview(r))
    ).filter(Boolean).sort(
      (a, b) => a.at - b.at
    );

  function save() {
    try {
      book.save();
      return true;
    } catch (e) {
      message.textContent = e.message;
      return false;
    }
  }

  // 同じ教材・同じ本人・同じ自己評価への返信だけ取り込む。
  function absorbReplies() {
    const selves = validSelves();

    let changed = false;

    for (
      const review of received.get(
        keyOf(context)
      )?.values() ?? []
    ) {
      const a = review.assessment;

      if (
        a.rootId !== (
          context.rootId ??
          context.materialId ??
          'local'
        ) ||
        a.materialId !== (
          context.materialId ?? ''
        ) ||
        a.seat !== (context.seat ?? 0)
      ) {
        continue;
      }

      if (
        !selves.some(s =>
          JSON.stringify(s) ===
          JSON.stringify(a)
        ) ||
        stored.reviews.some(r =>
          r.id === review.id
        )
      ) {
        continue;
      }

      stored.reviews.push(review);
      changed = true;
    }

    if (changed) save();
  }

  function refresh() {
    if (disposed) return;

    absorbReplies();

    const selves = validSelves();
    const reviews = validReviews();
    const levels = levelsFrom(fields);

    const oldChoice =
      comparisonSelect.value;

    const choices = [
      ...selves.map((s, i) => ({
        key: 'self:' + s.id,
        label:
          `自己評価${i + 1}（${
            time(s.at)
          }）`,
        levels: s.levels,
        assessment: s
      })),

      ...reviews.map(r => ({
        key: 'teacher:' + r.id,
        label:
          `先生からの確認（${
            time(r.at)
          }）`,
        levels: r.levels,
        assessment: r.assessment,
        note: r.note
      }))
    ];

    comparisonSelect.replaceChildren(
      el(
        'option',
        { value: 'none' },
        '比較しない'
      ),
      ...choices.map(c =>
        el(
          'option',
          { value: c.key },
          c.label
        )
      )
    );

    const latest = selves.at(-1);

    const latestTeacher = reviews.filter(
      r =>
        r.assessment.id === latest?.id
    ).at(-1);

    const preferred = latestTeacher
      ? 'teacher:' + latestTeacher.id
      : selves.length
        ? 'self:' + selves[
            Math.max(
              0,
              selves.length - 2
            )
          ].id
        : 'none';

    comparisonSelect.value =
      comparisonTouched &&
      (
        oldChoice === 'none' ||
        choices.some(c =>
          c.key === oldChoice
        )
      )
        ? oldChoice
        : preferred;

    const comparison = choices.find(c =>
      c.key === comparisonSelect.value
    );

    const available = data.runs.filter(r =>
      new Set(selectedIds()).has(r.id)
    );

    const current = currentSelf(
      data,
      context,
      available
    );

    const saved =
      current &&
      JSON.stringify(current.levels) ===
        JSON.stringify(levels);

    caption.textContent =
      `${
        saved
          ? '塗り：保存済みの自己評価'
          : '塗り：自己評価の入力（保存前）'
      } ／ 破線：${
        comparison?.label ?? '比較なし'
      }。自己評価${selves.length}件・先生の確認${reviews.length}件。`;

    if (latest && !current) {
      caption.textContent +=
        ' 説明または根拠が変わりました（次の問い・計画の変更も含みます）。評価も送りたい場合は、今回の内容で自己評価を保存し直してください。';
    }

    if (node.open && !view) {
      try {
        view = createUnderstandingView(
          canvas
        );
      } catch (e) {
        message.textContent = e.message;
      }
    }

    view?.set(
      levels,
      comparison?.levels ?? null
    );

    tableHost.replaceChildren(
      levelsTable(
        levels,
        comparison?.levels,
        comparison
          ? '比較対象'
          : undefined
      )
    );

    basisHost.replaceChildren(
      ...(
        comparison
          ? [
              basisCard(
                comparison.assessment,
                replay
              ),
              comparison.note
                ? el(
                    'p',
                    {},
                    '先生のコメント：' +
                      comparison.note
                  )
                : null
            ].filter(Boolean)
          : []
      )
    );
  }

  // 各観点の選択欄を作る。
  for (const a of ASPECTS) {
    const select = levelSelect(
      a,
      '自己評価',
      initial[a.key]
    );

    fields[a.key] = select;

    select.onchange = () => {
      stored.draft =
        levelsFrom(fields);

      save();
      refresh();
    };
  }

  const controls = el(
    'div',
    {},
    ...ASPECTS.map(a =>
      el(
        'label',
        {},
        a.label,
        fields[a.key]
      )
    )
  );

  const saveButton = el(
    'button',
    {
      type: 'button',

      onclick: () => {
        try {
          if (!data.runs.some(r => new Set(selectedIds()).has(r.id))) { guideRecords(node, 'この説明の根拠にする自分の記録を選ぼう。'); return; }
      if (!['result','evidence','reason','unknown'].some(k => data.reflection[k]?.trim())) { guideTo(node.closest('.s2')?.querySelector('textarea[aria-label="説明の結果"]') ?? node, '先に、実験で分かったことを自分の言葉で書こう。'); return; }
      if (!Object.values(levelsFrom(fields)).some(v => v !== null)) { guideTo(fields.result, '振り返る観点を1つ以上選ぼう。まだ分からない観点は未評価のままで大丈夫。'); return; }
      const assessment = makeSelf(
            data,
            context,
            selectedIds(),
            levelsFrom(fields)
          );

          const previous =
            validSelves().at(-1);

          // 同じ内容の二重保存を防ぐ。
          if (
            previous &&
            sameBasis(
              previous.basis,
              assessment.basis
            ) &&
            JSON.stringify(
              previous.levels
            ) === JSON.stringify(
              assessment.levels
            ) &&
            JSON.stringify(
              previous.recordIds
            ) === JSON.stringify(
              assessment.recordIds
            )
          ) {
            message.textContent =
              '同じ説明・根拠・自己評価は保存済みです。';

            return;
          }

          stored.selves.push(
            assessment
          );

          stored.draft =
            assessment.levels;

          if (!save()) {
            stored.selves.pop();
            return;
          }

          message.textContent =
            'この説明と根拠に対する自己評価を保存しました。次の問いを送ると、条件が一致する自己評価も先生へ届きます。';

          comparisonTouched = false;

          refresh();
        } catch (e) {
          message.textContent =
            e.message;
        }
      }
    },
    'この説明の自己評価を保存'
  );

  node.append(
    el(
      'p',
      { class: 'iu-note' },
      '結果・根拠・理由・次の検証を、0〜3の目安で振り返ります。形の大きさは選んだ段階を表し、文章の正しさを自動採点したものではありません。'
    ),

    el(
      'div',
      { class: 'iu-layout' },

      el(
        'div',
        { class: 'iu-figure' },
        canvas,

        el(
          'p',
          { class: 'iu-note' },
          'ドラッグ／矢印キーで回転。ホイール／2本指で拡大。灰色は未評価で、0とは別です。'
        ),

        el(
          'button',
          {
            type: 'button',
            onclick: () =>
              view?.reset()
          },
          '視点をもとに戻す'
        )
      ),

      controls
    ),

    el(
      'div',
      { class: 'iu-actions' },
      saveButton
    ),

    message,

    el(
      'label',
      {},
      '破線で重ねる比較対象',
      comparisonSelect
    ),

    caption,
    tableHost,
    rubric(),
    basisHost
  );

  comparisonSelect.onchange = () => {
    comparisonTouched = true;
    refresh();
  };

  node.addEventListener(
    'toggle',
    () => {
      if (node.open) refresh();
    }
  );

  const scope = keyOf(context);

  const listeners =
    subscribers.get(scope) ??
    new Set();

  listeners.add(refresh);

  subscribers.set(
    scope,
    listeners
  );

  return {
    node,
    refresh,

    destroy() {
      disposed = true;

      listeners.delete(refresh);

      if (!listeners.size) {
        subscribers.delete(scope);
      }

      view?.destroy();
      node.remove();
    }
  };
}

// 先生用の確認欄。
// 自己評価を先生の入力欄へ自動コピーしない。
export function teacherUnderstandingCard(
  context,
  question,
  onReply
) {
  if (!context.understanding) {
    return null;
  }

  style();

  const assessment = parseSelf(
    context.understanding
  );

  if (
    assessment.seat !== question.seat
  ) {
    return el(
      'p',
      {},
      '自己評価の番号と質問の番号が一致しません。'
    );
  }

  const node = el(
    'details',
    {
      class: 'iu-panel',
      'data-understanding-panel':
        'teacher'
    },
    el(
      'summary',
      {},
      '理解の3D：自己評価と説明を確認する'
    )
  );

  const canvas = el('canvas', {});

  const message = el(
    'p',
    {
      class: 'iu-message',
      role: 'status'
    }
  );

  const fields = {};

  const note = el(
    'textarea',
    {
      rows: 2,
      maxlength: 400,
      'aria-label':
        '理解の確認コメント',
      placeholder:
        'どの説明・根拠を確認したか、次に何を確かめてほしいか。'
    }
  );

  let view = null;

  const refresh = () => {
    try {
      if (node.open && !view) {
        view = createUnderstandingView(
          canvas
        );
      }

      view?.set(
        levelsFrom(fields),
        assessment.levels
      );
    } catch (e) {
      message.textContent =
        e.message;
    }
  };

  for (const a of ASPECTS) {
    const select = levelSelect(
      a,
      '先生の確認'
    );

    fields[a.key] = select;

    select.onchange = refresh;
  }

  const send = el(
    'button',
    {
      type: 'button',

      disabled:
        !question.uid || !onReply,

      onclick: async () => {
        try {
          if (!Object.values(levelsFrom(fields)).some(v => v !== null)) { guideTo(fields.result, '確認できた観点の段階を1つ以上選んでください。'); return; }
      const review = makeReview(
            assessment,
            levelsFrom(fields),
            note.value
          );

          send.disabled = true;

          await onReply({
            uid: question.uid,
            questionId: question.id,
            question: question.text,

            answer:
              review.note ||
              '説明と根拠を確認しました。理解の3Dで、自分の振り返りと見比べてみよう。',

            understandingReview:
              review
          });

          message.textContent =
            '本人へ確認結果を返しました。比較案の作成や問いへの回答は引き続き行えます。';
        } catch (e) {
          message.textContent =
            e.message;
        } finally {
          send.disabled =
            !question.uid ||
            !onReply;
        }
      }
    },
    '確認した段階とコメントを本人へ返す'
  );

  node.append(
    el(
      'p',
      { class: 'iu-note' },
      '塗りは先生が入力中の確認、破線は生徒の自己評価です。この説明・根拠を確認してから返してください。未入力は未評価のままです。'
    ),

    basisCard(assessment),

    el(
      'div',
      { class: 'iu-layout' },

      el(
        'div',
        { class: 'iu-figure' },
        canvas
      ),

      el(
        'div',
        {},
        ...ASPECTS.map(a =>
          el(
            'label',
            {},
            a.label,
            fields[a.key]
          )
        )
      )
    ),

    rubric(),

    el(
      'label',
      {},
      '確認した根拠・次に確かめること',
      note
    ),

    send,
    message
  );

  node.addEventListener(
    'toggle',
    () => {
      if (node.open) refresh();
    }
  );

  return node;
}

// 生徒が受け取った先生の確認を表示する。
// 先生の確認は、この画面から編集できない。
export function understandingReplyCard(
  reply,
  context
) {
  if (!reply.understandingReview) {
    return null;
  }

  const review = quietly(() =>
    parseReview(
      reply.understandingReview
    )
  );

  if (
    !review ||
    review.assessment.seat !==
      context.seat
  ) {
    return null;
  }

  style();

  const node = el(
    'details',
    {
      class: 'iu-panel',
      'data-understanding-panel':
        'reply'
    },
    el(
      'summary',
      {},
      '先生の確認を3Dで見る'
    )
  );

  const canvas = el('canvas', {});

  let view = null;

  node.append(
    el(
      'p',
      { class: 'iu-note' },
      '塗り：先生からの確認。破線：その説明を保存したときの自己評価。新しい説明の評価とは別です。'
    ),

    canvas,

    levelsTable(
      review.levels,
      review.assessment.levels,
      '自己評価'
    ),

    basisCard(
      review.assessment
    )
  );

  node.addEventListener(
    'toggle',
    () => {
      if (!node.open) return;

      try {
        view ??=
          createUnderstandingView(
            canvas
          );

        view.set(
          review.levels,
          review.assessment.levels
        );
      } catch (e) {
        node.append(
          el(
            'p',
            { class: 'iu-note' },
            e.message
          )
        );
      }
    }
  );

  return node;
}
