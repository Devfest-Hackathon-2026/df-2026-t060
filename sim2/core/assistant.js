// 児童の「実験助手」(端末のAI:Gemma 4 E2B)。
// AIは「変更の内容を表す JSON」だけを出す。計算(2倍など)・範囲・説明の文は、すべてここ(アプリ)で行う。
//   set     {"action":"set","changes":[{"param":"L","op":"mul","value":2}]}   op: set / mul / add
//   preset  {"action":"preset","id":"moon"}          値はプリセットの表から(presets.js)
//   compare {"action":"compare","variants":[{"L":1},{"L":2}]}   2〜3つをならべて動かす
//   explain {"action":"explain","id":"pendulum.period"}       文は確かめ済みのものから(explain.js)
//   reset / unknown
import { getSystem, paramInfo, validateConfig } from '../systems/index.js';
import { presetsFor } from './presets.js';
import { explanationsFor, explanation, explanationText } from './explain.js';
import { patchLocal } from './intent.js';
import { applyPatch } from './patch.js';
import { isElementary } from './constants.js';
import BASE_WORDS from '../systems/student-words.json.js';
import { loadExtra, mergeWords } from './word-log.js';

// 辞書:元の辞書(student-words.json)+ 先生がこの端末で足した辞書(words.html)
let WORDS = mergeWords(BASE_WORDS, loadExtra());
let KANA_EXTRA = [];
/** 先生が辞書を足したあとなどに、読みなおす(extra を渡すと、それを使う。テスト用) */
export function reloadWords(extra = loadExtra()) {
  WORDS = mergeWords(BASE_WORDS, extra);
  KANA_EXTRA = (WORDS.kana ?? []).map(([from, to]) => [new RegExp(String(from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), to]);
}

const ACTIONS = ['set', 'preset', 'compare', 'explain', 'reset', 'unknown'];

/** AIの出力の形(JSON Schema)。その系の条件・プリセット・説明の ID だけをえらべるようにする */
export function actionSchema(system, grade) {
  const keys = paramInfo(system).filter((p) => !p.options).map((p) => p.key);
  const presets = presetsFor(system).map((p) => p.id);
  const expl = explanationsFor(system, grade).map((e) => e.id);
  return {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ACTIONS },
      changes: { type: 'array', maxItems: 3, items: { type: 'object', properties: { param: { type: 'string', enum: keys }, op: { type: 'string', enum: ['set', 'mul', 'add'] }, value: { type: 'number' } }, required: ['param', 'op', 'value'] } },
      id: { type: 'string', enum: [...new Set([...presets, ...expl, ''])] },
      variants: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'object', properties: Object.fromEntries(keys.map((k) => [k, { type: 'number' }])) } },
    },
    required: ['action'],
  };
}

// 系ごとに、{{...}} をうめて作る(小さいモデル向けに 500 トークン以内)
const TEMPLATE = `あなたは理科の実験助手です。生徒の言葉を、実験条件を変えるJSONに変換します。
JSONだけを出力してください。説明文や計算は書かないでください。

# 今の実験
{{system_name}}

# 変えられる条件
{{params_table}}

# 用意された条件
{{presets}}

# 説明のID
{{explanations}}

# 決まり
- 「30度に」「2mに」のように数字の値が言われたら op:"set"
- 「2倍」「半分」は op:"mul"、「少し増やす」は op:"add" を使う
- 数字が言われていないときは、ふつうの変化(1.5倍など)にする
- 場所や星の名前は preset を使う
- 「どうして」「なぜ」は explain を使う
- わからないときは {"action":"unknown"}

# 例
{{examples}}`;

/** その系の例(テンプレートの「例」と、わからないときに見せる例文) */
function examples(system, grade) {
  const ps = paramInfo(system).filter((p) => !p.options);
  const p0 = ps[0], p1 = ps.find((p) => p.key === 'm') ?? ps[1] ?? p0;
  const pre = presetsFor(system)[0];
  const ex = explanationsFor(system, grade)[0];
  const name = (p) => (p.aliases?.[0] ?? p.label.replace(/\(.*\)/, ''));
  const out = [
    { say: `${name(p0)}をながくして`, json: { action: 'set', changes: [{ param: p0.key, op: 'mul', value: 1.5 }] } },
    pre ? { say: `${pre.label.replace(/の上$/, '')}でやったらどうなる?`, json: { action: 'preset', id: pre.id } } : null,
    { say: `${name(p1)}で結果がかわるか比べたい`, json: { action: 'compare', variants: [{ [p1.key]: p1.min + (p1.max - p1.min) * 0.2 }, { [p1.key]: p1.min + (p1.max - p1.min) * 0.8 }].map((v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x.toPrecision(2))]))) } },
    ex ? { say: `なんで${name(p0)}でかわるの`, json: { action: 'explain', id: ex.id } } : null,
  ].filter(Boolean);
  return out;
}

/** システムプロンプト(系・学年ごとに作る) */
export function assistantPrompt(system, grade) {
  const s = getSystem(system);
  const params = paramInfo(system).filter((p) => !p.options).map((p) => `${p.key}=${p.label.replace(/\(.*\)/, '')}[${p.unit || '-'}] ${p.min}〜${p.max}`).join('\n');
  const presets = presetsFor(system).map((p) => `${p.id}=${p.label}`).join(', ');
  const expl = explanationsFor(system, grade).map((e) => `${e.id}=${e.title}`).join('\n');
  const ex = examples(system, grade).map((e) => `生徒:${e.say}\n${JSON.stringify(e.json)}`).join('\n\n');
  return TEMPLATE.replace('{{system_name}}', s.label).replace('{{params_table}}', params).replace('{{presets}}', presets || 'なし')
    .replace('{{explanations}}', expl || 'なし').replace('{{examples}}', ex);
}

/** わからないときに見せる「こんなふうに言ってみてね」の例文(3つ) */
export function exampleSentences(system, grade) {
  return examples(system, grade).filter((e) => e.json.action !== 'compare').slice(0, 2).map((e) => e.say)
    .concat(examples(system, grade).filter((e) => e.json.action === 'compare').map((e) => e.say)).slice(0, 3);
}

const round = (v, step) => { const d = (String(step).split('.')[1] ?? '').length; return Number((Math.round(v / step) * step).toFixed(d)); };

/**
 * AIの出力(アクション)を、アプリで当てる。計算・範囲・メッセージはここで行う。
 * @returns {{kind: string, config?: object, variants?: object[], changes?: object[], messages: string[], explanation?: object, examples?: string[]}}
 */
export function applyAction(config, action, { base } = {}) {
  const sys = config.system, grade = config.curriculum.grade;
  const infos = Object.fromEntries(paramInfo(sys).map((p) => [p.key, p]));
  const messages = [];
  const fit = (key, v) => {
    const p = infos[key];
    let x = round(v, p.step);
    if (x > p.max) { x = p.max; messages.push(`${p.label.replace(/\(.*\)/, '')}は ${p.max}${p.unit}までだよ`); }
    if (x < p.min) { x = p.min; messages.push(`${p.label.replace(/\(.*\)/, '')}は ${p.min}${p.unit}からだよ`); }
    return x;
  };
  const changeList = (from, to) => Object.keys(to.params).filter((k) => from.params[k] !== to.params[k])
    .map((k) => ({ key: k, label: infos[k].label.replace(/\(.*\)/, ''), before: from.params[k], after: to.params[k], unit: infos[k].unit }));
  const a = action && ACTIONS.includes(action.action) ? action : { action: 'unknown' };

  if (a.action === 'set') {
    const params = { ...config.params };
    for (const c of (a.changes ?? []).slice(0, 3)) {
      if (!infos[c.param] || infos[c.param].options || !Number.isFinite(c.value)) continue;
      const cur = params[c.param];
      const v = c.op === 'mul' ? cur * c.value : c.op === 'add' ? cur + c.value : c.value;
      params[c.param] = fit(c.param, v);
    }
    const next = { ...config, params };
    const changes = changeList(config, next);
    if (!changes.length) return { kind: 'unknown', messages: messages.length ? messages : ['変えるところが見つからなかったよ'], examples: exampleSentences(sys, grade) };
    return validateConfig(next).length ? { kind: 'unknown', messages: ['その変え方はできないよ'], examples: exampleSentences(sys, grade) } : { kind: 'set', config: next, changes, messages };
  }
  if (a.action === 'preset') {
    const pre = presetsFor(sys).find((p) => p.id === a.id);
    if (!pre) return { kind: 'unknown', messages: ['その条件は用意されていないよ'], examples: exampleSentences(sys, grade) };
    const vals = pre.apply(config.params);
    const params = { ...config.params };
    for (const [k, v] of Object.entries(vals)) params[k] = typeof v === 'number' ? fit(k, v) : v;
    const next = { ...config, params };
    return { kind: 'preset', config: next, changes: changeList(config, next), messages: [`「${pre.label}」にしたよ(${pre.note})`, ...messages] };
  }
  if (a.action === 'compare') {
    const variants = (a.variants ?? []).slice(0, 3).map((v) => {
      const params = { ...config.params };
      for (const [k, x] of Object.entries(v ?? {})) if (infos[k] && !infos[k].options && Number.isFinite(x)) params[k] = fit(k, x);
      return { ...config, params };
    }).filter((c) => !validateConfig(c).length);
    const uniq = variants.filter((c, i) => variants.findIndex((d) => JSON.stringify(d.params) === JSON.stringify(c.params)) === i);
    if (uniq.length < 2) return { kind: 'unknown', messages: ['くらべる条件が2つ以上いるよ'], examples: exampleSentences(sys, grade) };
    return { kind: 'compare', variants: uniq, changes: uniq.map((c) => changeList(config, c)), messages: [...new Set(messages)] };
  }
  if (a.action === 'explain') {
    const e = explanation(a.id);
    if (!e || e.system !== sys || !explanationsFor(sys, grade).includes(e)) return { kind: 'unknown', messages: ['その説明は用意されていないよ'], examples: exampleSentences(sys, grade) };
    return { kind: 'explain', explanation: { id: e.id, title: e.title, text: explanationText(e, grade) }, messages: [] };
  }
  if (a.action === 'reset') {
    const next = base ?? config;
    return { kind: 'reset', config: next, changes: changeList(config, next), messages: ['はじめの条件にもどしたよ'] };
  }
  return { kind: 'unknown', messages: ['うまくわからなかったよ。こんなふうに言ってみてね'], examples: exampleSentences(sys, grade) };
}

// ひらがなの言い方を、ことばで読める形にそろえる(AIがないときの読みとり用)
const KANA = [[/おもさ/g, '重さ'], [/ながさ/g, '長さ'], [/ふれはば/g, '振れはば'], [/じゅうりょく/g, '重力'], [/かくど/g, '角度'],
  [/たかさ/g, '高さ'], [/でんち/g, '電池'], [/でんあつ/g, '電圧'], [/まさつ/g, 'まさつ'], [/れんず/g, 'レンズ'],
  [/ながく/g, '長く'], [/みじかく/g, '短く'], [/おもく/g, '重く'], [/かるく/g, '軽く'], [/ひも(?=[をのがはおもに]|$)/g, '糸'], [/いと(?=[をのがはおもに]|$)/g, '糸'], [/おもり/g, 'おもり'],
  [/つき/g, '月'], [/かせい/g, '火星'], [/もくせい/g, '木星'], [/ばい/g, '倍'], [/はんぶん/g, '半分'], [/たかく/g, '高く'], [/ひくく/g, '低く'],
  [/へいれつ/g, '並列'], [/ちょくれつ/g, '直列'], [/きゅうに/g, '急に'], [/たかい/g, '高い'], [/ちかづけ/g, '近づけ'], [/(\S)お(長|短|重|軽|高|低)/g, '$1を$2'],
  [/(電池)を?(\d)こ/g, '$1$2'], [/くらべ|比べ|ならべ/g, '比べ'],
  [/なんで|なぜ|どうして|どうなるの|知りたい|教えて|おしえて/g, 'どうして'], [/もどして|リセット|はじめから|さいしょから|やりなおし/g, 'もどして']];

/**
 * AIがない(読みこめない)ときの読みとり。ことばの照らし合わせで、アクションにする
 * @returns {object} アクション
 */
// 辞書(student-words.json)のひらがな→漢字を先に当てる(コードを書かずに足せる)
const kana = (s) => { let t = String(s); for (const [re, to] of [...KANA_EXTRA, ...KANA]) t = t.replace(re, to); return t; };
reloadWords();

/** 条件の名前が文のどこに出てくるか(長い名前を優先し、長い名前の中の短い名前は数えない) */
function mentions(sys, t) {
  const extra = WORDS.systems?.[sys]?.aliases ?? {};
  const found = [];
  for (const p of paramInfo(sys).filter((x) => !x.options)) {
    const names = [p.label, p.label.replace(/\(.*\)/, ''), ...(p.aliases ?? []), ...(extra[p.key] ?? [])]
      .filter((n) => n && (n.length >= 2 || (p.aliases ?? []).includes(n)));
    for (const n of new Set(names)) for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + 1)) found.push({ key: p.key, at: i, end: i + n.length });
  }
  return found.filter((m) => !found.some((o) => o !== m && o.at <= m.at && o.end >= m.end && o.end - o.at > m.end - m.at))
    .sort((a, b) => a.at - b.at);
}

/** 「大きく」「近づけて」などの向きのことばで、いちばん前にあるもの */
function findDirection(t) {
  let best = null;
  for (const dir of ['up', 'down']) for (const w of WORDS[dir] ?? []) {
    const at = t.indexOf(w);
    if (at >= 0 && (!best || at < best.at || (at === best.at && w.length > best.word.length))) best = { dir, word: w, at };
  }
  return best;
}

/** 向きだけの変更を、値にする(0 から「大きく」でも動くように) */
function nudge(config, key, dir) {
  const p = paramInfo(config.system).find((x) => x.key === key);
  if (!p) return null;
  const f = WORDS.factor ?? 1.5, cur = config.params[key];
  let v;
  if (dir === 'up') v = cur > 0 ? cur * f : cur < 0 ? cur / f : p.min + (p.max - p.min) * 0.25;
  else v = cur > 0 ? cur / f : cur < 0 ? cur * f : (p.min < 0 ? p.min * 0.25 : cur);
  if (v === cur) return null;
  return { action: 'set', changes: [{ param: key, op: 'set', value: Number(v.toPrecision(6)) }] };
}

/** 数と単位だけで、条件が1つに決まるときに読む(「30度で投げて」「200gにして」) */
function unitAction(config, t) {
  const m = /([0-9]+(?:\.[0-9]+)?)\s*(度|cm|センチ|mm|kg|g(?!\/)|グラム|m(?!\/|m)|V|ボルト|Ω|Hz|ヘルツ|℃|秒)/.exec(t.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  if (!m) return null;
  const n = Number(m[1]), u = { センチ: 'cm', グラム: 'g', ボルト: 'V', ヘルツ: 'Hz' }[m[2]] ?? m[2];
  const conv = { m: { cm: 0.01, mm: 0.001, m: 1 }, cm: { cm: 1, mm: 0.1, m: 100 }, kg: { kg: 1, g: 0.001 }, g: { g: 1, kg: 1000 } };
  const cands = paramInfo(config.system).filter((p) => !p.options).map((p) => {
    const f = p.unit === u ? 1 : conv[p.unit]?.[u];
    return f ? { key: p.key, value: n * f } : null;
  }).filter(Boolean);
  if (cands.length !== 1 || cands[0].value === config.params[cands[0].key]) return null;
  return { action: 'set', changes: [{ param: cands[0].key, op: 'set', value: Number(cands[0].value.toPrecision(6)) }] };
}

/** 向きのことばで読む:辞書の言い回し → 名前+向き → 向きのことばだけで決まる条件 */
export function directionAction(config, t) {
  const sys = config.system, keys = paramInfo(sys).filter((p) => !p.options).map((p) => p.key);
  for (const ph of WORDS.systems?.[sys]?.phrases ?? []) {
    if (keys.includes(ph.param) && ph.match.some((m) => t.includes(m))) return nudge(config, ph.param, ph.dir);
  }
  const d = findDirection(t);
  if (!d) return null;
  const ms = mentions(sys, t);
  const before = ms.filter((m) => m.end <= d.at);
  let key = before.length ? before[before.length - 1].key : null;
  if (!key) key = Object.entries(WORDS.implied ?? {}).find(([k, ws]) => keys.includes(k) && ws.includes(d.word))?.[0] ?? null;
  if (!key) key = ms.find((m) => m.at >= d.at + d.word.length)?.key ?? null;
  return key ? nudge(config, key, d.dir) : null;
}

export function localAction(config, text) {
  const why = /なんで|なぜ|どうして/.test(text); // 理由をたずねている(「月だとどうなるの」は、たずね方でも条件の変更)
  const t = kana(text);
  const sys = config.system, grade = config.curriculum.grade;
  if (/もどして/.test(t)) return { action: 'reset' };
  const ms0 = mentions(sys, t);
  const pre = presetsFor(sys).find((p) => p.words.some((w) => t.includes(w) && !ms0.some((m) => m.end <= t.indexOf(w) && !w.includes(t.slice(m.at, m.end))))
    && !/\d/.test(t.replace(/乾電池\d|電池\d|2F/g, '')));
  if (pre && !why) return { action: 'preset', id: pre.id };
  if (/どうして/.test(t)) {
    const list = explanationsFor(sys, grade);
    const kw = list.find((e) => (WORDS.explain?.[e.id] ?? []).some((w) => t.includes(w)));
    if (kw) return { action: 'explain', id: kw.id };
    const infos = paramInfo(sys);
    // 説明の題も、同じようにそろえてからくらべる(「ふれはば」と「振れはば」など)
    const hit = list.find((e) => infos.some((p) => [p.label, ...(p.aliases ?? [])].some((n) => t.includes(n) && kana(e.title).includes(n.replace(/^.*の/, '')))))
      ?? list.find((e) => kana(e.title).split(/[をとのでが]/).some((w) => w.length >= 2 && t.includes(w))) ?? list[0];
    return hit ? { action: 'explain', id: hit.id } : { action: 'unknown' };
  }
  if (/比べ/.test(t)) {
    const p = paramInfo(sys).filter((x) => !x.options).find((x) => [x.label, ...(x.aliases ?? [])].some((n) => t.includes(n)));
    if (p) return { action: 'compare', variants: [{ [p.key]: config.params[p.key] }, { [p.key]: Math.min(p.max, config.params[p.key] * 2) }] };
  }
  const r = patchLocal(config, t, { raw: true });
  if (r) {
    const changes = r.patch.filter((o) => o.path.startsWith('/params/') && typeof o.value === 'number' && o.value !== config.params[o.path.slice(8)])
      .map((o) => ({ param: o.path.slice(8), op: 'set', value: Number(o.value.toPrecision(6)) }));
    if (changes.length) return { action: 'set', changes };
  }
  const byUnit = unitAction(config, t);
  if (byUnit) return byUnit;
  const dir = directionAction(config, t);
  if (dir) return dir;
  return { action: 'unknown' };
}

/** 小学生かどうか(説明の文を、ふりがな・数式なしにするため) */
export const forElementary = (config) => isElementary(config.curriculum.grade);
