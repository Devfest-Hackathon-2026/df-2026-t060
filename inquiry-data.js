// 探究の共通データ。AIの文章と、計算で得た観測値を混ぜずに保存する。
// Nodeのテスト・先生側サーバー・生徒画面で同じ検査を使う。
import { SYSTEMS, validateConfig } from './sim2/systems/index.js';
import { parseSelf } from './understanding-core.js';

export const MODEL_VERSION = 'classroom-physics-2026-11-07.2';
export const copy = (x) => JSON.parse(JSON.stringify(x));
export const newId = () => globalThis.crypto.randomUUID();
const short = (x, n = 600) => String(x ?? '').slice(0, n);
const finite = (x) => typeof x === 'number' && Number.isFinite(x);

// 他人の実験を再現する入口では、検証済みの組み込み計算だけを受け取る。
export function checkedConfig(config) {
  if (!config || config.gen || config.ext || !SYSTEMS[config.system] || SYSTEMS[config.system].generated)
    throw new Error('この記録のモデルは、共通の再現機能の対応範囲外です');
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`実験条件を確認してください: ${errors[0]}`);
  return copy(config);
}

export function observedText(o, system) {
  if (o.crashed != null) return '地表に到達した';
  if (finite(o.t)) return `${Number(o.t.toFixed(3))}${system === 'solar' ? '年' : '秒'}まで観察した`;
  return '観測を保存した';
}

export function captureRun({ engine, config, prediction = '', observation = '', seat = 0, materialId = '', sourceIds = [], trace = [] }) {
  const cfg = checkedConfig(config), o = engine.observe();
  if (!(engine.t > 0)) throw new Error('先に「再生」で実験を動かしてください');
  // 測定できていない周期は null のまま。衝突・途中経過も立派な記録になる。
  const measures = engine.system.model.readouts(o, engine.p).map((r) => ({
    key: r.key, label: r.label, unit: r.unit ?? '', value: finite(r.value) ? r.value : null,
    ...(r.text != null ? { text: short(r.text) } : {}),
  }));
  const observed = copy(o);
  if (cfg.system === 'orbit') delete observed.outcome; // 事前のモデル判定は観測欄から分離。
  const run = { id: newId(), version: MODEL_VERSION, config: cfg, seat, materialId,
    createdAt: Date.now(), elapsed: engine.t, steps: engine.steps, dt: engine.dt,
    prediction: short(prediction), observation: short(observation),
    sourceIds: [...new Set(sourceIds)].slice(0, 8), measures, observed,
    status: observedText(o, cfg.system), trace: trace.filter((p) => Array.isArray(p) && p.every(finite)).slice(-180),
    quality: { energyDrift: engine.monitor.energyDrift, warnings: [...engine.monitor.warnings] } };
  // これは初期条件を式に入れた推論。観察による「戻らない」証明とは区別する。
  if (cfg.system === 'orbit') run.inference = {
    initialSpecificEnergy: engine.p.eps, bound: engine.p.bound, outcome: o.outcome,
    note: '初期条件と万有引力だけの理想モデルからの推論。観察の結果とは別です。',
  };
  return run;
}

export function validateRun(r) {
  if (!r || typeof r.id !== 'string' || r.id.length > 100 || !finite(r.elapsed) || r.elapsed <= 0)
    throw new Error('実験記録のIDまたは観察時間が不正です');
  if (r.version !== MODEL_VERSION) throw new Error('モデルの版が異なります。元の記録を確認してください');
  checkedConfig(r.config);
  if (!Array.isArray(r.measures) || r.measures.length > 40 || !Array.isArray(r.trace) || r.trace.length > 180)
    throw new Error('実験記録の大きさが不正です');
  if (r.trace.some((p) => !Array.isArray(p) || p.length > 4 || !p.every(finite))) throw new Error('軌跡の値が不正です');
  if (r.config.system === 'orbit' && (!Array.isArray(r.observed?.pos) || !r.observed.pos.every(finite)))
    throw new Error('軌道の観測値がありません');
  return copy(r);
}

// 通信はJSON文字列1項目に統一。FirestoreとBluetoothの双方で同じ上限にする。
export function encodeContext(context) {
  const packed = copy(context);
  packed.runs = packed.runs.map((r) => ({ ...r, trace: r.trace.filter((_, i) => i % Math.max(1, Math.ceil(r.trace.length / 60)) === 0).map((p) => p.map((v) => Number(v.toPrecision(8)))) }));
  const c = parseContext(JSON.stringify(packed));
  const text = JSON.stringify(c);
  if (text.length > 40000 || new TextEncoder().encode(text).byteLength > 48 * 1024) throw new Error('記録が大きすぎます。根拠を2件程度に絞ってください');
  return text;
}
export function parseContext(text) {
  if (typeof text !== 'string' || text.length > 40000) throw new Error('根拠データは40000字以内です');
  const c = JSON.parse(text);
  if (c?.schema !== 1 || typeof c.rootId !== 'string' || c.rootId.length > 100 || !Array.isArray(c.runs) || c.runs.length > 6)
    throw new Error('根拠データの形式が異なります');
  const ids = new Set();
  const runs = c.runs.map(validateRun);
  for (const r of runs) { if (ids.has(r.id)) throw new Error('同じ記録が重複しています'); ids.add(r.id); }
  const understanding = c.understanding == null ? null : parseSelf(c.understanding);
  if (understanding && (understanding.rootId !== c.rootId || understanding.materialId !== short(c.materialId, 100) || understanding.recordIds.some(id => {
    const run = runs.find(r => r.id === id);
    return !run || run.seat !== understanding.seat || run.config.system !== understanding.system;
  }))) throw new Error('自己評価と、送った説明の教材・根拠が一致しません');
  return { schema: 1, rootId: c.rootId, materialId: short(c.materialId, 100),
    revision: Number.isInteger(c.revision) && c.revision > 0 ? c.revision : 1,
    question: short(c.question, 200), runs,
    reflection: Object.fromEntries(['result', 'evidence', 'reason', 'unknown'].map((k) => [k, short(c.reflection?.[k])])),
    ...(understanding ? { understanding } : {}) };
}

export function changesBetween(a, b) {
  if (a.system !== b.system) return ['system'];
  const params = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
  return [...params].filter((k) => JSON.stringify(a.params[k]) !== JSON.stringify(b.params[k]));
}

// 学習の履歴を消さず、教材の改訂ごとに別キーで保存する。番号を含めデモの2人を分離。
export function openNotebook(context = {}, system = '') {
  const key = `inquiry-v1:${context.code ?? 'local'}:${context.seat ?? 0}:${context.materialId ?? 'preview'}:${system}`;
  let data;
  try { data = JSON.parse(localStorage.getItem(key)); } catch { /* 初回 */ }
  if (!data || !Array.isArray(data.runs)) data = { runs: [], reflection: {}, drafts: {}, savedExplanations: [] };
  data.savedExplanations ??= []; data.reflection ??= {}; data.drafts ??= {};
  return { key, data, save() {
    try { localStorage.setItem(key, JSON.stringify(data)); }
    catch { throw new Error('この端末に保存できませんでした。記録をJSONで書き出してください'); }
  } };
}

// 同じ根の教材をひとまとめにし、改訂前の問いも残す。
export function materialGroups(materials) {
  const groups = new Map();
  for (const m of materials) {
    const rootId = m.inquiry?.rootId ?? m.id;
    if (!groups.has(rootId)) groups.set(rootId, []);
    groups.get(rootId).push(m);
  }
  return [...groups.values()].map((ms) => ms.sort((a, b) => (b.inquiry?.revision ?? 1) - (a.inquiry?.revision ?? 1) || b.publishedAt - a.publishedAt));
}

// 先生が編集してから承認する比較案。Gemmaなしでも使える、出所を明記したひな型。
export function localPlan(c) {
  if (!c.runs.length) throw new Error('比較案には実験記録を1件以上付けてください');
  const base = checkedConfig(c.runs.at(-1).config);
  const numeric = (base.controls ?? []).find((k) => typeof base.params[k] === 'number');
  const target = base.system === 'orbit' ? 'ratio' : numeric;
  if (!target) throw new Error('変えられる数値条件がありません');
  const schema = SYSTEMS[base.system].schema.params.properties[target];
  let values;
  if (base.system === 'orbit') values = [1.4, 1.45];
  else {
    const x = base.params[target], step = schema.multipleOf ?? (schema.maximum - schema.minimum) / 10;
    const clamp = (v) => Math.max(schema.minimum, Math.min(schema.maximum, Number(v.toFixed(4))));
    values = [clamp(x - step), clamp(x + step)];
  }
  const configs = values.map((v) => checkedConfig({ ...base, params: { ...base.params, [target]: v }, speed: 1 }));
  return { source: '比較用ひな型（AIの生成ではありません）', target, configs,
    answer: base.system === 'orbit' ? '球は地球に引かれながら進みます。短時間に遠ざかる様子だけでは、その後に戻るかどうかは断定できません。観測とモデルからの推論を分けて比べましょう。' : '変えた条件と観測した結果を分けて整理し、追加の比較で確かめましょう。',
    question: base.system === 'orbit' ? '同じように遠ざかる2つは、どこを測れば見分けられる？' : `${schema['x-label'] ?? target}だけ変えると、どこが変わる？`,
    rationale: '出発点・変えない条件・観察する時刻をそろえ、1条件だけを変えるため。',
    distinguish: base.system === 'orbit' ? '同じ時間の距離と軌道を比較する。短時間では帰還の有無を断定せず、初期エネルギーによる推論と分けて説明する。' : '同じ観察時間と測定項目で比較する。',
    sourceRecordIds: c.runs.map((r) => r.id) };
}

// 画面では内部キーでなく、教材の言葉と単位で条件を示す。
export function conditionLabel(config, key) {
  return String(SYSTEMS[config.system]?.schema.params.properties[key]?.['x-label'] ?? key).replace(/\(.*?\)/g, '');
}
export function conditionUnit(config, key) { return SYSTEMS[config.system]?.schema.params.properties[key]?.['x-unit'] ?? ''; }
export function conditionValue(config, key) {
  const option = SYSTEMS[config.system]?.schema.params.properties[key]?.['x-options'];
  const value = config.params[key];
  return option && Object.hasOwn(option, value) ? option[value] : String(value) + conditionUnit(config, key);
}
export function describeConditions(config) { return Object.keys(config.params).map(k => `${conditionLabel(config,k)}：${conditionValue(config,k)}`).join(' / '); }
export function modelLabel(config) { return SYSTEMS[config.system]?.label ?? config.system; }
