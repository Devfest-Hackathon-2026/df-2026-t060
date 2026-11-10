// 探究ノートへの追加機能。
// 音・天体など、登録済みの全モデルで共通に使う。
// 説明・根拠・次の検証の関係を見せる。
import { el } from './common.js';
import {
  checkedConfig,
  conditionLabel,
  conditionUnit,
  encodeContext
} from './inquiry-data.js';
import { currentSelf } from './understanding-core.js';
import { guideTo, guideRecords } from './inquiry-flow.js';

const PARTS = [
  ['result', '結果'],
  ['evidence', '根拠'],
  ['reason', '理由'],
  ['unknown', 'まだ分からないこと']
];

const LIMITS = {
  question: 200,
  hypothesis: 160,
  alternative: 160,
  criterion: 200
};

// 見せ方だけの設定は、物理条件の違いから除く。
const IGNORED = new Set([
  'render', 'speed', 'controls', 'curriculum',
  'view', 'view3d', 'showValues'
]);

const clean = value => String(value ?? '').trim();

const equal = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  const keys = Object.keys(a).sort();
  const other = Object.keys(b).sort();

  return keys.length === other.length &&
    keys.every((key, index) =>
      key === other[index] && equal(a[key], b[key])
    );
};

// 記録を比較する前に、変えた設定とそろっていない条件を調べる。
// 注意がないことは、説明の正しさを保証する意味ではない。
export function inspectPair(a, b) {
  const out = { changes: [], warnings: [], measures: [] };

  if (!a || !b) {
    out.warnings.push('履歴から記録をちょうど2件選ぼう。');
    return out;
  }

  if (a.id === b.id) {
    out.warnings.push('違う2件を選ぼう。');
    return out;
  }

  try {
    checkedConfig(a.config);
    checkedConfig(b.config);
  } catch (error) {
    out.warnings.push(error.message);
    return out;
  }

  if (a.config.system !== b.config.system) {
    out.warnings.push('違うモデルの記録です。同じモデルで比べよう。');
    return out;
  }

  if (a.version !== b.version) {
    out.warnings.push('モデルの版が違います。同じ版で再実験しよう。');
  }

  function walk(left, right, path = '') {
    const keys = new Set([
      ...Object.keys(left ?? {}),
      ...Object.keys(right ?? {})
    ]);

    for (const key of keys) {
      if (!path && IGNORED.has(key)) continue;

      const x = left?.[key];
      const y = right?.[key];
      const name = path ? path + '.' + key : key;

      if (equal(x, y)) continue;

      if (
        x && y &&
        typeof x === 'object' &&
        typeof y === 'object' &&
        !Array.isArray(x) &&
        !Array.isArray(y)
      ) {
        walk(x, y, name);
      } else {
        out.changes.push({
          key: name,
          label: name.startsWith('params.')
            ? conditionLabel(a.config, key)
            : name,
          unit: name.startsWith('params.')
            ? conditionUnit(a.config, key)
            : '',
          before: x,
          after: y
        });
      }
    }
  }

  walk(a.config, b.config);

  if (out.changes.length !== 1) {
    out.warnings.push(
      out.changes.length
        ? '設定が複数変わっています。何の影響か分けて確かめよう。'
        : '設定は同じです。再現性を調べる比較として使えます。'
    );
  }

  if (
    !Number.isFinite(a.elapsed) ||
    !Number.isFinite(b.elapsed) ||
    Math.abs(a.elapsed - b.elapsed) > 1e-6
  ) {
    out.warnings.push(
      '観察時間が違います。同じ時刻の比較が必要か考えよう。'
    );
  }

  if (a.dt !== b.dt) {
    out.warnings.push(
      '計算の刻み幅が違います。数値計算の条件も確認しよう。'
    );
  }

  for (const measure of a.measures ?? []) {
    const other = (b.measures ?? []).find(
      item => item.key === measure.key && item.unit === measure.unit
    );

    if (other) {
      out.measures.push({
        key: measure.key,
        label: measure.label,
        unit: measure.unit ?? '',
        before: measure.value,
        after: other.value
      });
    }
  }

  if (
    out.measures.some(
      item =>
        !Number.isFinite(item.before) ||
        !Number.isFinite(item.after)
    )
  ) {
    out.warnings.push(
      '未測定の値があります。「変化なし」や0とは扱いません。'
    );
  }

  return out;
}

// 文章の変化を比べる。
// 書き直しただけで「理解が向上した」とは判定しない。
export function explanationChanges(before = {}, after = {}) {
  return PARTS.map(([key, label]) => {
    const a = clean(before[key]);
    const b = clean(after[key]);

    return {
      key,
      label,
      before: a,
      after: b,
      status: a === b
        ? '同じ'
        : !a
          ? '書き加えた'
          : !b
            ? '記述を外した'
            : '書き直した'
    };
  });
}

function validatePlan(plan) {
  const result = {};

  for (const [key, max] of Object.entries(LIMITS)) {
    result[key] = clean(plan[key]);

    if (result[key].length > max) {
      throw new Error(`${key}は${max}字以内で書こう。`);
    }
  }

  if (!result.question || !result.hypothesis || !result.criterion) {
    throw new Error(
      '次の問い・仮説・見分ける方法を入力しよう。'
    );
  }

  return result;
}

// 既存の説明を黙って切り落とさない。
function appendWithin(original, addition, label) {
  const text = [clean(original), addition]
    .filter(Boolean)
    .join('\n');

  if (text.length > 600) {
    throw new Error(
      `${label}と研究計画が合わせて600字を超えます。短く整理してから送ろう。`
    );
  }

  return text;
}

// 既存の「根拠つき質問」に研究計画を添える。
// 元の説明は上書きせず、送信用のコピーだけを編集する。
export function buildResearchContext({
  context = {},
  data,
  sources = [],
  selectedIds,
  plan
}) {
  const p = validatePlan(plan);
  const ids = new Set(selectedIds);
  const own = data.runs.filter(run => ids.has(run.id));

  if (!own.length) {
    throw new Error(
      '自分で実行した記録を1件以上、履歴で選ぼう。'
    );
  }

  if (own.length > 4) {
    throw new Error('自分の根拠は4件以内に絞ろう。');
  }

  const incoming = sources.filter(run => ids.has(run.id));

  const ancestors = sources.filter(
    run => own.some(item => item.sourceIds?.includes(run.id))
  ).slice(-2);

  const runs = [
    ...new Map(
      [...ancestors, ...incoming, ...own]
        .map(run => [run.id, run])
    ).values()
  ];

  if (runs.length > 6) {
    throw new Error('引き継いだ根拠を含め6件以内に絞ろう。');
  }

  const reflection = { ...data.reflection };

  reflection.reason = appendWithin(
    reflection.reason,
    `【生徒の未確認の仮説】${p.hypothesis}${
      p.alternative ? '\n【別の説明】' + p.alternative : ''
    }`,
    '理由'
  );

  reflection.unknown = appendWithin(
    reflection.unknown,
    `【次の実験で見分ける方法】${p.criterion}`,
    'まだ分からないこと'
  );

  const text = encodeContext({
    schema: 1,
    rootId: context.rootId ?? context.materialId ?? 'local',
    materialId: context.materialId ?? '',
    revision: context.revision ?? 1,
    question: p.question,
    runs,
    reflection,
    understanding: currentSelf(data, context, runs)
  });

  return {
    text: p.question,
    inquiryContext: text
  };
}

// 友達が編集している全体レイアウトへ影響しにくい専用CSS。
const CSS = `
.inq-advance{
  border:2px solid #96c5c1;
  border-radius:14px;
  background:#f3faf9;
  padding:16px;
  margin:16px 0;
  min-width:0
}
.inq-advance summary{cursor:pointer;font-weight:700}
.inq-advance h4{margin:18px 0 8px}
.inq-advance label{display:block;margin:10px 0;font-weight:600}
.inq-advance textarea,.inq-advance select{
  display:block;box-sizing:border-box;width:100%;
  font:inherit;line-height:1.6;padding:9px;
  border:1px solid #9db8bb;border-radius:8px;
  background:white;color:#18334c
}
.inq-advance button{
  font:inherit;min-height:44px;
  border:1px solid #9db8bb;border-radius:9px;
  background:white;color:#18334c;
  padding:9px 12px;cursor:pointer
}
.inq-advance button:disabled{opacity:.55;cursor:default}
.inq-advance .ia-row{
  display:flex;gap:9px;flex-wrap:wrap;margin:10px 0
}
.inq-advance .ia-row>label{flex:1;min-width:160px}
.inq-advance .ia-scroll{overflow:auto}
.inq-advance table{
  width:100%;border-collapse:collapse;background:white
}
.inq-advance th,.inq-advance td{
  padding:9px;border:1px solid #cedcde;
  text-align:left;vertical-align:top;
  white-space:pre-wrap;overflow-wrap:anywhere
}
.inq-advance .ia-note{font-size:13px;color:#4d666f}
.inq-advance .ia-msg{color:#71451e;white-space:pre-wrap}
.inq-advance article{
  padding:10px;margin:8px 0;
  border:1px solid #cfdfdf;border-radius:8px;background:white
}
.inq-advance :focus-visible{
  outline:3px solid #e9ae36;outline-offset:2px
}
.inq-advance small{display:block;color:#506770}
@media(max-width:600px){
  .inq-advance{padding:10px}
  .inq-advance table{min-width:460px}
}
`;

function ensureStyle() {
  if (!document.getElementById('inquiryAdvanceStyle')) {
    document.head.append(
      el('style', { id: 'inquiryAdvanceStyle' }, CSS)
    );
  }
}

const fmt = (value, unit = '') =>
  Number.isFinite(value)
    ? `${Number(value.toPrecision(5))} ${unit}`
    : value == null
      ? '未測定・未指定'
      : String(value);

const table = (headers, rows) =>
  el(
    'div',
    { class: 'ia-scroll' },
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          ...headers.map(
            header => el('th', { scope: 'col' }, header)
          )
        )
      ),
      el(
        'tbody',
        {},
        ...rows.map(
          row => el(
            'tr',
            {},
            ...row.map(value => el('td', {}, value))
          )
        )
      )
    )
  );

// 説明の比較・根拠の確認・研究計画の画面を作る。
export function createInquiryAdvance({
  book,
  context = {},
  sources = [],
  selectedIds,
  onQuestion,
  replay
}) {
  ensureStyle();

  const data = book.data;

  data.advance ??= { draft: {}, savedPlans: [] };
  data.advance.draft ??= {};
  data.advance.savedPlans ??= [];

  const draft = data.advance.draft;

  const node = el(
    'details',
    { class: 'inq-advance' },
    el('summary', {}, '発展：根拠から次の実験を設計する')
  );

  const pairBox = el('div', {});
  const before = el(
    'select',
    { 'aria-label': '比較する前の説明' }
  );
  const after = el(
    'select',
    { 'aria-label': '比較する後の説明' }
  );
  const diffBox = el('div', {});

  const message = el(
    'p',
    { class: 'ia-msg', role: 'status' }
  );

  const history = el('details', {});
  const fields = {};

  const save = () => {
    try {
      book.save();
      return true;
    } catch (error) {
      message.textContent = error.message;
      return false;
    }
  };

  const available = () => [
    ...new Map(
      [...sources, ...data.runs].map(run => [run.id, run])
    ).values()
  ];

  const picks = () => available().filter(
    run => new Set(selectedIds()).has(run.id)
  );

  function drawDiff() {
    const list = data.savedExplanations;

    if (!list.length) {
      diffBox.replaceChildren(
        el(
          'p',
          { class: 'ia-note' },
          '上の「この説明を保存」で説明を残すと、前後を比べられます。'
        )
      );
      return;
    }

    const get = value =>
      value === 'current'
        ? data.reflection
        : list[Number(value)]?.text ?? {};

    diffBox.replaceChildren(
      table(
        ['観点', '前の説明', '後の説明', '文章の変化'],
        explanationChanges(
          get(before.value),
          get(after.value)
        ).map(item => [
          item.label,
          item.before || '（記述なし）',
          item.after || '（記述なし）',
          item.status
        ])
      )
    );

    const chosen = after.value === 'current'
      ? [...selectedIds()]
      : list[Number(after.value)]?.recordIds ?? [];

    diffBox.append(
      el(
        'p',
        { class: 'ia-note' },
        'この説明で選んだ根拠。条件を戻して、自分でも確かめられます。'
      )
    );

    for (const id of chosen) {
      const run = available().find(item => item.id === id);

      if (run) {
        diffBox.append(
          el(
            'button',
            {
              type: 'button',
              onclick: () => replay(run)
            },
            `根拠を再実験：${run.observation.slice(0, 35)}`
          )
        );
      } else {
        diffBox.append(
          el(
            'p',
            { class: 'ia-note' },
            `記録 ${id} はこの端末では見つかりません。削除前のノート等を確認してください。`
          )
        );
      }
    }
  }

  before.onchange = after.onchange = drawDiff;

  const definitions = [
    [
      'question',
      '次に確かめたい問い',
      '例：条件を少し変えると、結果はどこから変わる？'
    ],
    [
      'hypothesis',
      '自分の仮説（まだ未確認の考え）',
      '例：変えた条件が、結果の違いに関係している。'
    ],
    [
      'alternative',
      '別の説明・違う予想（任意）',
      '例：観察した時間の違いが原因かもしれない。'
    ],
    [
      'criterion',
      '何を測れば、考えを見分けられる？',
      '例：ほかの条件と観察時間をそろえ、同じ項目を測る。'
    ]
  ];

  for (const [key, label, placeholder] of definitions) {
    const field = el(
      'textarea',
      {
        rows: 2,
        maxlength: LIMITS[key],
        'aria-label': `研究計画の${label}`,
        placeholder
      }
    );

    field.value = draft[key] ?? '';
    fields[key] = field;

    field.oninput = () => {
      draft[key] = field.value;
      save();
    };
  }

  function readyPlan(sharing = false) {
    for (const key of ['question', 'hypothesis', 'criterion']) {
      if (!clean(draft[key])) return guideTo(fields[key], ({question:'次に確かめたい問い', hypothesis:'自分の仮説', criterion:'測るもの・見分ける方法'})[key] + 'をここに書こう。');
    }
    if (sharing) {
      const own = data.runs.filter(r => new Set(selectedIds()).has(r.id));
      if (!own.length || own.length > 4) return guideRecords(node, '自分の記録を1〜4件選んでから、研究計画を送ろう。');
      if ([clean(data.reflection.reason), '【生徒の未確認の仮説】' + clean(draft.hypothesis) + (clean(draft.alternative) ? '\n【別の説明】' + clean(draft.alternative) : '')].filter(Boolean).join('\n').length > 600) return guideTo(fields.hypothesis, '説明の理由と仮説を合わせて600字以内になるよう、短く整理しよう。');
      if ([clean(data.reflection.unknown), '【次の実験で見分ける方法】' + clean(draft.criterion)].filter(Boolean).join('\n').length > 600) return guideTo(fields.criterion, 'まだ分からないことと見分ける方法を合わせて600字以内に整理しよう。');
    }
    return true;
  }
  const savePlan = el(
    'button',
    {
      type: 'button',
      onclick: () => {
        try {
          if (!readyPlan()) return;
      const plan = validatePlan(draft);

          const item = {
            id: crypto.randomUUID(),
            at: Date.now(),
            ...plan,
            recordIds: [...selectedIds()]
          };

          data.advance.savedPlans.push(item);

          if (!save()) {
            data.advance.savedPlans.pop();
            return;
          }

          message.textContent =
            '研究計画をこの端末に保存しました。先生への送信は別のボタンです。';

          refresh();
        } catch (error) {
          message.textContent = error.message;
        }
      }
    },
    '研究計画を保存'
  );

  const share = el(
    'button',
    {
      type: 'button',
      disabled: !context.onShare,
      onclick: async () => {
        try {
          if (!readyPlan(true)) return;
      const payload = buildResearchContext({
            context,
            data,
            sources,
            selectedIds: selectedIds(),
            plan: draft
          });

          share.disabled = true;
          await context.onShare(payload);
          onQuestion(payload.text);

          message.textContent =
            '研究計画と実験の根拠を送りました。先生が確認してからクラスへ返します。';
        } catch (error) {
          message.textContent =
            '送れませんでした：' + error.message;
        } finally {
          share.disabled = !context.onShare;
        }
      }
    },
    '研究計画と根拠を先生へ送る'
  );

  const labels = {
    question: '次の問い',
    hypothesis: '自分の仮説',
    alternative: '別の説明・違う予想',
    criterion: '測るもの・見分ける方法'
  };

  node.append(
    el(
      'p',
      { class: 'ia-note' },
      '観察から考えを作り、別の説明と見分ける実験へつなげよう。文章の変化は理解度の点数ではありません。'
    ),
    el('h4', {}, '1．説明は、どこが変わった？'),
    el(
      'div',
      { class: 'ia-row' },
      el('label', {}, '前', before),
      el('label', {}, '後', after)
    ),
    diffBox,
    el('h4', {}, '2．根拠に選んだ2件を確かめる'),
    pairBox,
    el('h4', {}, '3．次の実験で、考えを見分ける'),
    ...Object.entries(fields).map(
      ([key, field]) => el('label', {}, labels[key], field)
    ),
    el(
      'div',
      { class: 'ia-row' },
      savePlan,
      el(
        'button',
        {
          type: 'button',
          onclick: () => {
            if (!clean(draft.question)) {
              guideTo(fields.question, 'ここに、次に確かめたい問いを書こう。');
              return;
            }

            onQuestion(clean(draft.question));
            message.textContent =
              '下の「次の問い」に入れました。';
          }
        },
        'この問いを下の欄に入れる'
      ),
      share
    ),
    message,
    history
  );

  function refresh() {
    const oldA = before.value;
    const oldB = after.value;
    const list = data.savedExplanations;

    before.replaceChildren(
      ...list.map(
        (item, index) => el(
          'option',
          { value: index },
          `説明${index + 1}：${new Date(item.at).toLocaleString('ja-JP')}`
        )
      )
    );

    after.replaceChildren(
      ...list.map(
        (item, index) => el(
          'option',
          { value: index },
          `説明${index + 1}：${new Date(item.at).toLocaleString('ja-JP')}`
        )
      ),
      el('option', { value: 'current' }, '今書いている説明')
    );

    before.value =
      oldA !== '' && list[Number(oldA)] ? oldA : '0';

    after.value =
      oldB === 'current' ||
      (oldB !== '' && list[Number(oldB)])
        ? oldB
        : 'current';

    drawDiff();

    const chosen = picks();
    const audit = inspectPair(
      ...(chosen.length === 2 ? chosen : [])
    );

    pairBox.replaceChildren(
      el(
        'p',
        { class: 'ia-note' },
        `履歴で選択中：${chosen.length}件。記録の値を表示しており、ここでは新しい測定をしていません。`
      ),
      ...audit.warnings.map(
        text => el('p', { class: 'ia-msg' }, text)
      )
    );

    if (chosen.length === 2) {
      pairBox.append(
        table(
          ['変わった設定', '記録A', '記録B'],
          audit.changes.map(item => [
            item.label,
            fmt(item.before, item.unit),
            fmt(item.after, item.unit)
          ])
        ),
        table(
          ['測定項目', '記録A', '記録B'],
          audit.measures.map(item => [
            item.label,
            fmt(item.before, item.unit),
            fmt(item.after, item.unit)
          ])
        )
      );

      if (!audit.warnings.length) {
        pairBox.append(
          el(
            'p',
            { class: 'ia-note' },
            '設定の差は1つで、観察時間と計算の刻みは同じです。これだけで仮説が正しいとは決まりません。'
          )
        );
      }
    }

    history.replaceChildren(
      el(
        'summary',
        {},
        `保存した研究計画（${data.advance.savedPlans.length}件）`
      ),
      ...[...data.advance.savedPlans].reverse().map(
        plan => el(
          'article',
          {},
          el('b', {}, plan.question),
          el('p', {}, `仮説：${plan.hypothesis}`),
          plan.alternative
            ? el('p', {}, `別の説明：${plan.alternative}`)
            : null,
          el('p', {}, `見分ける方法：${plan.criterion}`),
          el(
            'small',
            {},
            `根拠${plan.recordIds.length}件／先生の確認前の計画`
          ),
          el(
            'button',
            {
              type: 'button',
              onclick: () => {
                for (const key of Object.keys(LIMITS)) {
                  draft[key] = plan[key] ?? '';
                  fields[key].value = draft[key];
                }

                save();
                message.textContent =
                  '保存した計画を編集欄へ戻しました。';
              }
            },
            'この計画を編集する'
          ),
          el(
            'button',
            {
              type: 'button',
              onclick: () => {
                if (!confirm(
                  'この端末の研究計画を削除しますか？ 送信済みの計画は先生側に残ります。'
                )) return;

                const index =
                  data.advance.savedPlans.indexOf(plan);

                if (index < 0) return;

                data.advance.savedPlans.splice(index, 1);

                if (!save()) {
                  data.advance.savedPlans.splice(index, 0, plan);
                  return;
                }

                message.textContent =
                  'この端末の研究計画を削除しました。';

                refresh();
              }
            },
            'この計画を削除'
          )
        )
      )
    );
  }

  node.addEventListener('toggle', () => {
    if (node.open) refresh();
  });

  return {
    node,
    refresh,
    destroy() {
      node.remove();
    }
  };
}

// 実機の生成確認。モデルの準備・ダウンロードは呼ばない。
export async function probeStudentAI(ai) {
  if (!ai.isReady()) {
    throw new Error(
      '先に生徒側AIのモデルを準備してください。この確認操作では取得しません。'
    );
  }

  const model = ai.loadedModel();

  const reply = await ai.generate(
    'これは動作確認です。「準備できました」と一文で答えてください。',
    40,
    null
  );

  if (!clean(reply.text)) {
    throw new Error(
      '生成結果が空でした。端末のコンソールとメモリーを確認してください。'
    );
  }

  return {
    model: model?.label ?? '不明',
    text: reply.text,
    ms: reply.ms
  };
}

export function mountAIProbe(host, ai) {
  ensureStyle();

  const out = el(
    'p',
    { class: 'ia-msg', role: 'status' }
  );

  const button = el(
    'button',
    {
      type: 'button',
      onclick: async () => {
        button.disabled = true;

        out.textContent =
          'この端末のモデルで短い文章を生成しています…';

        try {
          const result = await probeStudentAI(ai);

          out.textContent =
            `${result.model}／${result.ms}ms\n` +
            `実際の出力：${result.text}\n` +
            '生成経路を確認できました。教材への回答の正確さは別に確認してください。';
        } catch (error) {
          out.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      }
    },
    '保存済みAIで短い文章を生成して確かめる'
  );

  host.replaceChildren(
    el(
      'details',
      { class: 'inq-advance' },
      el('summary', {}, '開発用：生徒側Gemmaの実機確認'),
      el(
        'p',
        { class: 'ia-note' },
        'この操作はモデルをダウンロードせず、準備済みのモデルだけを使います。'
      ),
      button,
      out
    )
  );
}
