// 先生の要望を、AIを使わずに読む(よくある要望はこれで足りる。足りないときだけ Gemma を呼ぶ)。
//   classifyLocal("中2の回路の教材を作って") → { grade: '中2', unit: '電流', system: 'circuit' }
//   patchLocal(config, "重力を月面にして") → { patch: [{op:'replace', path:'/params/g', value:1.62}], note }
import { SURFACE_GRAVITY, GRAVITY_WORDS, GRADES } from './constants.js';
import { SYSTEMS, paramInfo } from '../systems/index.js';

const Z2H = (s) => String(s).replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[一二三四五六]/g, (c) => '一二三四五六'.indexOf(c) + 1);

/** 学年(小3〜中3)を読む */
export function readGrade(text) {
  const m = /(小|中)(?:学)?(?:校)?\s*([1-6１-６一二三四五六])(?:年)?/.exec(text);
  if (!m) return null;
  const g = `${m[1]}${Z2H(m[2])}`;
  return GRADES.includes(g) ? g : null;
}

// 系をさがすことば(schema の x-words と、ここに足したもの)
const SYSTEM_WORDS = {
  pendulum: ['ふりこ', '振り子', 'ブランコ', '往復'],
  incline: ['斜面', '坂', 'すべり', '滑り', '記録タイマー', '台車'],
  roller: ['ジェットコースター', 'コースター', 'ローラー'],
  lens: ['凸レンズ', 'レンズ', '実像', '虚像', '焦点', '虫めがね'],
  projectile: ['投げた', 'ボールを投げ', '自由落下', '落下', '投射', 'なげ上げ', '投げ上げ', '放物線', 'ボール投げ', '投げたボール'],
  wave: ['波長', '振動数', '振幅', '音の高さ', '音の大きさ', '波'],
  heat: ['あたたまり方', '温まり方', '熱の伝わり', '熱伝導', '金属の棒'],
  planetg: ['惑星ごと', '星ごと', '天体ごと', '各惑星', '引力を比', '重力を比', '引力をくら', '重力をくら', '惑星の引力', '惑星の重力', '表面重力', '月の重力', '重さのちがい', '月で', '火星で', '木星で', '地球と月', '月と地球', '月と火星', '火星と月'],
  solar: ['太陽系', '惑星', '公転', 'ケプラー'],
  orbit: ['人工衛星', '衛星', '宇宙速度', '万有引力', '軌道'],
  circuit: ['回路', '直列', '並列', '抵抗', '電流', '電圧', 'オームの法則'],
};
// 単元をさがすことば
const UNIT_WORDS = [
  [/力学的エネルギー|エネルギー/, '力学的エネルギー'],
  [/運動の規則性|記録タイマー|速さの変わり/, '運動の規則性'],
  [/振り子の運動|ふりこの運動|1往復|周期/, '振り子の運動'],
  [/凸レンズ|レンズ|光と音/, '光と音(凸レンズのはたらき)'],
  [/回路|電流|電圧|直列|並列/, '電流と電圧'],
  [/引力|重力|重さ/, '力の性質(重力・重さ)'],
  [/音の性質|振動数|波長|音の高さ/, '光と音(音の性質)'],
  [/あたたまり方|温まり方|熱の伝わり/, 'もののあたたまり方'],
];

/** 要望から、系・学年・単元を読む(読めないところは null) */
export function classifyLocal(text) {
  const t = String(text);
  const grade = readGrade(t);
  const unit = UNIT_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
  let system = Object.entries(SYSTEM_WORDS).find(([, ws]) => ws.some((w) => t.includes(w)))?.[0] ?? null;
  if (system && !SYSTEMS[system]) system = null;
  // 系がわからなくても、学年と単元から、その単元の系が1つだけならそれにする
  if (!system && (grade || unit)) {
    const cands = Object.values(SYSTEMS).filter((s) => s.schema['x-units'].some((u) => (!grade || u.grade === grade) && (!unit || u.unit === unit)));
    if (cands.length === 1) system = cands[0].name;
  }
  return { system, grade, unit };
}

const NUM = '([0-9０-９]+(?:[.．][0-9０-９]+)?)';
// 条件の名前に ( ) などが入っていても、正規表現がこわれないようにする
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clampTo = (info, v) => Math.min(info.max, Math.max(info.min, Number(v.toFixed(6))));

/**
 * よくある要望を、JSON Patch にする。読めなければ null
 * @returns {{patch: object[], note: string} | null}
 */
export function patchLocal(config, text, { raw = false } = {}) {
  const t = String(text);
  const infos = paramInfo(config.system);
  const has = (k) => infos.some((p) => p.key === k);
  const info = (k) => infos.find((p) => p.key === k);
  const ops = [], notes = [];
  const setParam = (k, v, why) => {
    const i = info(k);
    if (!i) return;
    // raw:範囲に収めずにそのまま返す(児童の実験助手では、アプリが収めて「〜までだよ」と知らせる)
    const value = i.options || raw ? v : clampTo(i, Number(v));
    if (!i.options && value !== Number(v)) notes.push(`${i.label}は ${i.min}〜${i.max}${i.unit} なので ${value}${i.unit} にしました`);
    ops.push({ op: 'replace', path: `/params/${k}`, value });
    notes.push(why);
  };

  // 重力:「月面にして」「火星の重力で」「木星だったら」
  const planet = GRAVITY_WORDS.find(([re]) => re.test(t) && /重力|面|上|で|にして|だったら|なら/.test(t));
  if (planet && has('g') && !/月(曜|日)/.test(t)) {
    const g = SURFACE_GRAVITY[planet[1]];
    setParam('g', g.g, `重力を${g.label}の ${g.g} m/s² にする(NASA Planetary Fact Sheet の値)`);
  }

  // 「◯◯を 数 にして」:条件の名前と数
  for (const p of infos) {
    if (p.options) continue;
    const names = [p.label, p.label.replace(/\(.*\)/, ''), ...(p.aliases ?? []), ...(p.label.includes('の') ? [p.label.split('の').pop()] : [])]
      .sort((a, b) => b.length - a.length); // 長い名前を先に(「斜面の長さ」を「長さ」より先)
    // 1文字の名前は、schema に書いた別名(糸 など)のときだけ使う
    for (const name of [...new Set(names)].filter((n) => n.length >= 2 || (p.aliases ?? []).includes(n))) {
      // 「重さを2倍」は何倍の話、「おもりを2つ」は数の話なので、ここでは読まない
      const m = new RegExp(`${esc(name)}(?:を|は|が)?\\s*${NUM}(?![0-9０-９.．]|\\s*(?:倍|つ|個|こ|本|回|人))\\s*(cm|センチ|mm|g(?!/)|グラム|${esc(p.unit) || '$^'}|度|m|kg|秒)?`).exec(t);
      if (m && !ops.some((o) => o.path === `/params/${p.key}`)) {
        let v = Number(Z2H(m[1]));
        // 単位をそろえる(50cm → 0.5m、50g → 0.05kg)
        if (p.unit === 'm' && /^(cm|センチ)$/.test(m[2] ?? '')) v /= 100;
        if (p.unit === 'm' && m[2] === 'mm') v /= 1000;
        if (p.unit === 'kg' && /^(g|グラム)$/.test(m[2] ?? '')) v /= 1000;
        setParam(p.key, Number(v.toPrecision(6)), `${p.label}を ${Number(v.toPrecision(6))}${p.unit} にする`);
        break;
      }
    }
  }

  // 何倍:「糸を2倍に」「重さを半分に」「重力を2倍に」(条件の名前・別名のどれでも)
  for (const p of infos) {
    if (p.options || ops.some((o) => o.path === `/params/${p.key}`)) continue;
    const names = [...new Set([p.label.replace(/\(.*\)/, ''), ...(p.aliases ?? [])])].sort((a, b) => b.length - a.length);
    for (const name of names) {
      const m = new RegExp(`${esc(name)}を?\\s*(?:の)?\\s*(${NUM.slice(1, -1)}|半分)\\s*(倍|に)`).exec(t);
      if (!m || (m[1] !== '半分' && m[2] !== '倍')) continue;
      const f = m[1] === '半分' ? 0.5 : Number(Z2H(m[1]));
      setParam(p.key, config.params[p.key] * f, `${p.label}を${m[1] === '半分' ? '半分' : `${f}倍`}にする`);
      break;
    }
  }

  // 方向だけ:「長く」「重く」「急に」「高く」
  const nudge = (re, k, f, word) => { if (re.test(t) && has(k) && !ops.some((o) => o.path === `/params/${k}`)) setParam(k, config.params[k] * f, `${info(k).label}を${word}する`); };
  nudge(/(糸|ひも)を?長く/, 'L', 1.5, '長く'); nudge(/(糸|ひも)を?短く/, 'L', 1 / 1.5, '短く');
  nudge(/重く/, 'm', 2, '重く'); nudge(/軽く/, 'm', 0.5, '軽く');
  nudge(/(角度を?大きく|急に)/, 'angle', 1.5, '大きく'); nudge(/(角度を?小さく|ゆるやか)/, 'angle', 1 / 1.5, '小さく');
  nudge(/高く|高い(ところ|場所)/, 'H', 1.5, '高く'); nudge(/低く|低い(ところ|場所)/, 'H', 1 / 1.5, '低く');
  nudge(/(振れはば|ふれはば)を?大きく/, 'theta0', 1.5, '大きく'); nudge(/(振れはば|ふれはば)を?小さく/, 'theta0', 1 / 1.5, '小さく');

  // まさつ・空気の抵抗(「0.2にして」のような数は、上で読んでいる)
  const fr = ['mu', 'b'].find(has);
  if (fr && /(まさつ|摩擦|抵抗)/.test(t) && !ops.some((o) => o.path === `/params/${fr}`)) {
    if (/(なく|なし|ゼロ|ない|(まさつ|摩擦|抵抗)を?0(?![.．0-9]))/.test(t)) setParam(fr, 0, `${info(fr).label}をなくす(エネルギーが保存する)`);
    else if (/(つけ|入れ|あり|大きく|強く|ある)/.test(t)) setParam(fr, Math.max(config.params[fr] * 2, info(fr).max * 0.3), `${info(fr).label}をつける`);
  }

  // 再生の速さ:「速く」「ゆっくり」(条件ではなく、見せる速さ)
  if (/(ゆっくり|スロー)/.test(t)) { ops.push({ op: config.speed !== undefined ? 'replace' : 'add', path: '/speed', value: 0.5 }); notes.push('動きを0.5倍の速さで見せる'); }
  else if (/(早送り|速く再生|はやく再生|もっと速く動かし)/.test(t)) { ops.push({ op: config.speed !== undefined ? 'replace' : 'add', path: '/speed', value: 2 }); notes.push('動きを2倍の速さで見せる'); }

  // コースの形
  if (has('track')) {
    if (/谷が?(1|一)つ|U字|お椀/.test(t)) setParam('track', 'valley', 'コースを谷が1つの形にする');
    if (/谷が?(2|二)つ|山/.test(t) && !/山を?なく/.test(t)) setParam('track', 'twin', 'コースを谷が2つ(まん中に山)の形にする');
  }

  // 児童が変えられる条件:「重さも変えられるようにして」
  if (/(変えられる|動かせる|スライダー)/.test(t)) {
    const add = infos.filter((p) => [p.label.replace(/\(.*\)/, '').replace(/^.*の/, ''), ...(p.aliases ?? [])].some((n) => t.includes(n)) && !config.controls.includes(p.key));
    for (const p of add) { ops.push({ op: 'add', path: '/controls/-', value: p.key }); notes.push(`児童が「${p.label}」を変えられるようにする`); }
  }

  return ops.length ? { patch: ops, note: [...new Set(notes)].join('/') } : null;
}
