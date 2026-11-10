// 理解の振り返りに使う共通形式。
// 自己評価と先生の確認を区別する。
// 文の長さやキーワードの数から段階を自動採点しない。

export const ASPECTS = [
  {
    key: 'result',
    label: '結果',
    color: '#55a3ff',
    steps: [
      'まだ整理している',
      '起きたことを話せる',
      '条件と結果を結びつけて説明できる',
      '別の条件の結果も予想して確かめられる'
    ]
  },
  {
    key: 'evidence',
    label: '根拠',
    color: '#40d1ae',
    steps: [
      '根拠を探している',
      '実験の記録を挙げられる',
      '条件をそろえた比較から説明できる',
      '観察時間・誤差・限界まで考えられる'
    ]
  },
  {
    key: 'reason',
    label: '理由',
    color: '#ffc66b',
    steps: [
      '理由を考えている',
      '自分の考えを話せる',
      'モデルのしくみと結果を結びつけられる',
      '仮定や反例を考えて説明を確かめられる'
    ]
  },
  {
    key: 'next',
    label: '次の検証',
    color: '#ce9cff',
    steps: [
      '次の問いを探している',
      '次の疑問を挙げられる',
      '変えるもの・測るものを決められる',
      '別の仮説と見分ける実験を計画できる'
    ]
  }
];

const clone = value => JSON.parse(JSON.stringify(value));

// 文字列の型と長さを確認する。
const text = (value, max, label, empty = true) => {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim())
  ) {
    throw new Error(`${label}の形式を確認してください`);
  }

  return value.trim();
};

// 0〜3を評価の段階、nullを未評価として扱う。
// 未評価を0として扱わない。
export function parseLevels(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new Error('評価の観点がありません');
  }

  return Object.fromEntries(
    ASPECTS.map(({ key }) => {
      const v = value[key];

      if (
        v !== null &&
        (!Number.isInteger(v) || v < 0 || v > 3)
      ) {
        throw new Error(
          '段階は0〜3、未評価はnullにしてください'
        );
      }

      return [key, v];
    })
  );
}

export const emptyLevels = () => Object.fromEntries(
  ASPECTS.map(a => [a.key, null])
);

export const hasLevel = levels =>
  Object.values(levels).some(v => v !== null);

// 評価した時点の説明を確認する。
function parseBasis(basis) {
  if (!basis || typeof basis !== 'object') {
    throw new Error('振り返った説明がありません');
  }

  return Object.fromEntries(
    [
      'result',
      'evidence',
      'reason',
      'unknown',
      'question',
      'plan'
    ].map(k => [
      k,
      text(
        basis[k] ?? '',
        k === 'question' ? 200 : 600,
        '説明'
      )
    ])
  );
}

// 今入力されている説明・問い・研究計画をまとめる。
export function basisFrom(data) {
  const p = data.advance?.draft ?? {};

  return parseBasis({
    ...data.reflection,
    question:
      p.question ||
      data.drafts?.question ||
      '',
    plan: [
      p.hypothesis,
      p.alternative,
      p.criterion
    ].filter(Boolean).join('\n')
  });
}

// 保存済みの自己評価の形式を確認する。
export function parseSelf(value) {
  if (
    value?.schema !== 1 ||
    value.kind !== 'self'
  ) {
    throw new Error('自己評価の形式が異なります');
  }

  const seat = value.seat;

  if (
    !Number.isInteger(seat) ||
    seat < 0 ||
    seat > 60 ||
    !Number.isFinite(value.at) ||
    value.at <= 0
  ) {
    throw new Error('自己評価の番号・日時が不正です');
  }

  if (
    !Array.isArray(value.recordIds) ||
    value.recordIds.length < 1 ||
    value.recordIds.length > 6
  ) {
    throw new Error(
      '自己評価に根拠の記録を付けてください'
    );
  }

  const ids = value.recordIds.map(id =>
    text(id, 100, '記録ID', false)
  );

  if (new Set(ids).size !== ids.length) {
    throw new Error('自己評価の根拠が重複しています');
  }

  const levels = parseLevels(value.levels);

  if (!hasLevel(levels)) {
    throw new Error(
      '1つ以上の観点で段階を選んでください'
    );
  }

  return {
    schema: 1,
    kind: 'self',
    id: text(
      value.id, 100, '自己評価ID', false
    ),
    at: value.at,
    rootId: text(
      value.rootId, 100, '根の問いID', false
    ),
    materialId: text(
      value.materialId, 100, '教材ID'
    ),
    seat,
    system: text(
      value.system, 80, 'モデル名', false
    ),
    recordIds: ids,
    basis: parseBasis(value.basis),
    levels
  };
}

// 説明と実験記録を一組にして、自己評価を作る。
export function makeSelf(
  data,
  context,
  selectedIds,
  levels
) {
  const selected = new Set(selectedIds);

  const runs = data.runs.filter(r =>
    selected.has(r.id)
  );

  if (!runs.length) {
    throw new Error(
      '自分で実行した記録を、履歴で1件以上選んでください'
    );
  }

  if (runs.length > 6) {
    throw new Error(
      '自己評価の根拠は6件以内にしてください'
    );
  }

  const basis = basisFrom(data);

  if (
    ![
      'result',
      'evidence',
      'reason',
      'unknown'
    ].some(k => basis[k])
  ) {
    throw new Error(
      '先に、実験を自分の言葉で説明してください'
    );
  }

  if (
    runs.some(
      r => r.config.system !== runs[0].config.system
    )
  ) {
    throw new Error(
      '同じモデルの記録を選んでください'
    );
  }

  return parseSelf({
    schema: 1,
    kind: 'self',
    id: crypto.randomUUID(),
    at: Date.now(),
    rootId:
      context.rootId ??
      context.materialId ??
      'local',
    materialId: context.materialId ?? '',
    seat: context.seat ?? 0,
    system: runs[0].config.system,
    recordIds: runs.map(r => r.id),
    basis,
    levels
  });
}

// 保存した時点と、現在の説明が同じか確認する。
export function sameBasis(a, b) {
  return [
    'result',
    'evidence',
    'reason',
    'unknown',
    'question',
    'plan'
  ].every(k => a[k] === b[k]);
}

// 古い説明の自己評価を、新しい説明の評価として送らない。
export function currentSelf(data, context, runs) {
  const latest = data.understanding?.selves?.at(-1);

  if (!latest) return undefined;

  try {
    const s = parseSelf(latest);
    const ids = new Set(runs.map(r => r.id));

    if (
      s.rootId !== (
        context.rootId ??
        context.materialId ??
        'local'
      ) ||
      s.materialId !== (
        context.materialId ?? ''
      ) ||
      s.seat !== (context.seat ?? 0)
    ) {
      return undefined;
    }

    if (
      !sameBasis(s.basis, basisFrom(data)) ||
      s.recordIds.some(id => !ids.has(id))
    ) {
      return undefined;
    }

    return s;
  } catch {
    return undefined;
  }
}

// 先生から届いた確認の形式を確認する。
export function parseReview(value) {
  if (
    value?.schema !== 1 ||
    value.kind !== 'teacher'
  ) {
    throw new Error(
      '先生の確認の形式が異なります'
    );
  }

  const assessment = parseSelf(value.assessment);
  const levels = parseLevels(value.levels);

  if (
    !hasLevel(levels) ||
    !Number.isFinite(value.at) ||
    value.at <= 0
  ) {
    throw new Error('先生の確認が未入力です');
  }

  return {
    schema: 1,
    kind: 'teacher',
    id: text(
      value.id, 100, '確認ID', false
    ),
    at: value.at,
    assessment,
    levels,
    note: text(
      value.note ?? '',
      400,
      '先生のコメント'
    )
  };
}

export function makeReview(
  assessment,
  levels,
  note
) {
  return parseReview({
    schema: 1,
    kind: 'teacher',
    id: crypto.randomUUID(),
    at: Date.now(),
    assessment,
    levels,
    note
  });
}

// 立体の4方向の半径を決める。
// nullは未評価で、段階0とは別の大きさにする。
export function shapeVertices(levels) {
  const v = parseLevels(levels);

  return ASPECTS.map(({ key }, i) => {
    const r =
      v[key] === null
        ? .2
        : .55 + .48 * v[key];

    const angle = i * Math.PI / 2;

    return [
      r * Math.cos(angle),
      r * Math.sin(angle),
      0
    ];
  }).concat([
    [0, 0, .95],
    [0, 0, -.95]
  ]);
}

export const copyAssessment = clone;
