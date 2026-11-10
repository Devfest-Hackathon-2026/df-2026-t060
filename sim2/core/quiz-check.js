// AIが書いた確認問題(3択)の正解を、シミュレーションで計った結果と照らして確かめる。
//   checkQuiz({ q, choices, answer }, data) → { answer, fixed, warnings, notes }
//   data は core/facts.js の cfgFacts(config).data(計った値 quantities と、条件を変えたときの変わり方 trends)
// 2つの確かめ方:
//   ① 数の問題:「約 7.7 km/s」のような数と単位を読み、計った値(同じ種類の単位)と合うかを見る
//   ② 変わり方の問題:「質量を大きくすると、着地する時間は?」→ 計った変わり方(大きくなる・小さくなる・変わらない)と合うか
// 直すのは、確かだと言えるときだけ(問いに、計った量の名前が出てくる・ほかの条件を変える話でない・
// 合う選択肢がちょうど1つ)。それ以外で食いちがうときは、直さずに警告を出す(先生が確かめる)。

const Z2H = (s) => String(s).replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// 単位 → [量の種類, SI にするかけ算]
const UNITS = [
  ['km/s', 'speed', 1000], ['km/h', 'speed', 1 / 3.6], ['m/s²', 'accel', 1], ['m/s', 'speed', 1],
  ['km', 'length', 1000], ['cm', 'length', 0.01], ['mm', 'length', 0.001], ['m', 'length', 1],
  ['kg', 'mass', 1], ['g', 'mass', 0.001],
  ['秒', 'time', 1], ['分', 'time', 60], ['時間', 'time', 3600], ['日', 'time', 86400], ['年', 'time', 365.25 * 86400],
  ['Hz', 'freq', 1], ['kJ', 'energy', 1000], ['MJ', 'energy', 1e6], ['J', 'energy', 1], ['N', 'force', 1],
  ['mA', 'current', 0.001], ['A', 'current', 1], ['V', 'voltage', 1], ['Ω', 'resist', 1], ['度', 'angle', 1], ['°', 'angle', 1], ['℃', 'temp', 1],
];
const unitOf = (u) => UNITS.find(([name]) => name === String(u).trim());
const NUM_RE = new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(${UNITS.map(([n]) => n.replace(/[/²]/g, (c) => (c === '/' ? '\\/' : c))).join('|')})`, 'g');

/** 文の中の「数+単位」を読む → [{ kind, si, digits }](digits:小数点以下のけた数。まるめのはばに使う) */
export function readNumbers(text) {
  const out = [];
  for (const m of Z2H(text).matchAll(NUM_RE)) {
    const [, num, u] = m;
    const [, kind, f] = unitOf(u);
    // 「1分」の「分」が「半分」などの一部でないかは、数のすぐあとなので気にしない
    out.push({ kind, si: Number(num) * f, step: 10 ** -((num.split('.')[1] ?? '').length) * f, text: m[0] });
  }
  return out;
}

const CHANGE_COND = /(に|を)?(すると|したら|変えると|変えたら|増やすと|減らすと|かえると|かえたら)/;
const COND_UP = /大きく|長く|重く|高く|増や|強く|上げ|速く|遠く|多く/;
const COND_DOWN = /小さく|短く|軽く|低く|減ら|弱く|下げ|遅く|近く|少なく/;
const RES = { up: /大きくなる|長くなる|増える|高くなる|遠くなる|多くなる/, down: /小さくなる|短くなる|減る|低くなる|近くなる|少なくなる/, same: /変わらない|同じ|変化しない|かわらない/ };
const GENERIC = new Set(['時間', '速さ', '大きさ', '値', '結果']);

/** 問いに、その量の名前(または名前の大事な部分)が出てくるか */
function mentions(text, label) {
  if (!label) return false;
  const core = label.replace(/\(.*?\)|(.*?)/g, '');
  if (text.includes(core)) return true;
  // 量の名前を、ことばの要素に分け、その全部が問いに出ているときだけ「その量を聞いている」とする。
  // (「木星の重力加速度」を聞かれたとき、ほかの天体の重力加速度まで当てはめないため)
  const words = core.split(/の|で|は|に|を|が|した|する|[、・ ]/).filter((w) => (w.length >= 2 || /^\p{Script=Han}$/u.test(w)) && !GENERIC.has(w));
  return words.length > 0 && words.every((w) => text.includes(w));
}

/** 選択肢の「変わり方」(up / down / same / null) */
function trendOf(choice) {
  const hits = Object.entries(RES).filter(([, re]) => re.test(choice)).map(([k]) => k);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * @param {{q: string, choices: string[], answer: number}} quiz
 * @param {{measure: string, quantities: {label: string, value: number, unit: string}[], trends: {label: string, aliases: string[], how: string}[]}} data
 * @returns {{answer: number, fixed: boolean, warnings: string[], notes: string[], reason: string|null}}
 */
export function checkQuiz(quiz, data) {
  const res = { answer: quiz.answer, fixed: false, warnings: [], notes: [], reason: null };
  if (!data || !quiz?.choices?.length) return res;
  const q = Z2H(quiz.q);
  const otherCondition = CHANGE_COND.test(q);

  // ② 変わり方の問題(条件を変える問い)
  if (otherCondition) {
    const cut = q.search(CHANGE_COND);
    const cond = q.slice(0, cut + 4), rest = q.slice(cut);
    const tr = (data.trends ?? []).find((t) => [t.label.replace(/\(.*?\)/g, ''), ...t.aliases].some((w) => w && cond.includes(w)));
    const dir = COND_UP.test(cond) && !COND_DOWN.test(cond) ? 1 : COND_DOWN.test(cond) && !COND_UP.test(cond) ? -1 : 0;
    if (tr && (tr.how === 'same' || (dir && (tr.how === 'up' || tr.how === 'down')))) {
      const want = tr.how === 'same' ? 'same' : (tr.how === 'up') === (dir === 1) ? 'up' : 'down';
      const kinds = quiz.choices.map(trendOf);
      const good = kinds.map((k, i) => (k === want ? i : -1)).filter((i) => i >= 0);
      if (kinds[quiz.answer] && kinds[quiz.answer] !== want) {
        const sure = mentions(rest, data.measure) && good.length === 1;
        const why = `シミュレーションでは「${tr.label.replace(/\(.*?\)/g, '')}」を${dir === 1 ? '大きく' : dir === -1 ? '小さく' : '変え'}すると、${data.measure}は${{ up: '大きく(長く)なる', down: '小さく(短く)なる', same: '変わらない' }[want]}`;
        if (sure) {
          res.answer = good[0]; res.fixed = true; res.reason = why;
          res.notes.push(`確認問題の正解を「${quiz.choices[quiz.answer]}」から「${quiz.choices[good[0]]}」に直しました(${why})`);
        } else res.warnings.push(`確認問題の正解「${quiz.choices[quiz.answer]}」が、シミュレーションの結果と合わないかもしれません(${why})`);
      }
    }
    return res; // 条件を変える問いの数は、いまの設定で計った値とはくらべない
  }

  // ① 数の問題(いまの設定のまま)
  const nums = quiz.choices.map(readNumbers);
  const kinds = new Set(nums.flat().map((n) => n.kind));
  if (!kinds.size) return res;
  // 問いに名前が出てくる量を先に使う。なければ、同じ種類の単位の量ぜんぶ(このときは直さず、警告だけ)
  const named = (data.quantities ?? []).filter((x) => unitOf(x.unit) && mentions(q, x.label));
  const pool = named.length ? named : (data.quantities ?? []).filter((x) => unitOf(x.unit));
  const matches = (n) => pool.some((x) => {
    const [, kind, f] = unitOf(x.unit);
    if (kind !== n.kind) return false;
    const v = x.value * f;
    return Math.abs(n.si - v) <= Math.max(0.03 * Math.abs(v), n.step / 2 + 1e-12);
  });
  const covered = (n) => pool.some((x) => unitOf(x.unit)[1] === n.kind);
  const status = nums.map((ns) => {
    const cs = ns.filter(covered);
    if (!cs.length) return 'unknown';
    return cs.some(matches) ? 'match' : 'nomatch';
  });
  if (status[quiz.answer] !== 'nomatch') return res;
  const good = status.map((s, i) => (s === 'match' ? i : -1)).filter((i) => i >= 0);
  const show = pool.filter((x) => kinds.has(unitOf(x.unit)[1])).slice(0, 3).map((x) => `${x.label} ${Number(x.value.toPrecision(3))} ${x.unit}`).join('、');
  if (named.length && good.length === 1) {
    res.answer = good[0]; res.fixed = true; res.reason = `計った値:${show}`;
    res.notes.push(`確認問題の正解を「${quiz.choices[quiz.answer]}」から「${quiz.choices[good[0]]}」に直しました(シミュレーションで計った値:${show})`);
  } else {
    res.warnings.push(`確認問題の正解「${quiz.choices[quiz.answer]}」が、シミュレーションで計った値(${show})と合わないかもしれません`);
  }
  return res;
}
