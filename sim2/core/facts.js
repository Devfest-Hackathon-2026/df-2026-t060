// 新しい作り(sim2)のシミュレーションで、実際に動かして計った結果を、文にする。
// AIが題名・導入・授業の流れを書くとき、この文を「シミュレーションの結果」としてわたす
// (AIに物理を思い出させず、計った結果だけをもとに書かせる)。
import { runHeadless, createEngine } from './engine.js';
import { getSystem, paramInfo, validateConfig } from '../systems/index.js';

// 系ごとに「調べるもの」(readouts の key)
const MEASURE = { buoyancy:'percent',doppler:'back',doublependulum:'angle2',domino:'fallen',sound: 'wavelength', pendulum: 'period', incline: 'arrived', roller: 'maxSpeed', lens: 'b', circuit: 'Itotal', particle: 'speed', projectile: 'landed', orbit: 'period', solar: 'Tmain', wave: 'lambda', heat: 'reached', planetg: 'weight' };
const SECONDS = 12;

async function measure(config) {
  const sys = getSystem(config.system);
  // AIが作った系は、先に閉じた場所で動きを計算する
  if (sys.model.ensure) { const err = await sys.model.ensure(config); if (err) throw new Error(err); }
  // 動かす時間:系が決めていれば(1周するまで など)それを使う
  const sec = sys.model.factSeconds ? sys.model.factSeconds(sys.model.prepare(config)) : SECONDS;
  const e = runHeadless(sys, config, sec, { every: 50 });
  // AIが作った系は、動きが終わったときに計った値(final)で、確かめる値(checks)の1つ目を見る
  const rs = sys.generated ? sys.model.readouts({ ...(e.p.table?.final ?? {}) }, e.p) : sys.model.readouts(e.observe(), e.p);
  const key = sys.generated ? (sys.def.checks?.[0]?.key ?? sys.def.readouts[0].key) : MEASURE[config.system];
  const r = rs.find((x) => x.key === key) ?? rs.find((x) => Number.isFinite(x.value));
  // AIが作った系で、理論の式が使えない条件(落ちる・飛んでいく など)か
  const na = sys.generated && (sys.def.checks ?? []).some((c) => c.key === key) && !Number.isFinite(e.p.table?.expected?.[key]);
  // はじめの値も残す(確認問題の数の検査に使う。「打ち出す速さ」などは、はじめの値で問われることが多い)
  const rs0 = sys.generated ? [] : sys.model.readouts(createEngine(sys, config).observe(), e.p);
  return { r: r && na ? { ...r, na: true } : r, monitor: e.monitor, rs, rs0 };
}
const show = (r) => (r && Number.isFinite(r.value) ? `${Number(r.value.toFixed(r.digits ?? 2))} ${r.unit}`.trim() + (r.na ? '(1周しない:落ちる・飛んでいく など)' : '') : 'はかれない');

/**
 * @returns {{ measure: string, lines: string[], goal: string }}
 *   lines:「いまの設定では…」「〜を a から b にすると、… は x から y」「… は理論値と合う」
 */
export async function cfgFacts(config) {
  // AIが作った系は、設定を確かめるときに登録される(先に確かめる)
  const errs = validateConfig(config);
  if (errs.length) throw new Error(errs.join(" / "));
  const infos = paramInfo(config.system);
  const base = await measure(config);
  const name = base.r?.label ?? '結果';
  const lines = [`いまの設定では、${name}は ${show(base.r)}。`];
  const changed = [];
  const trends = []; // 条件ごとの、計った値の変わり方(確認問題の検査に使う)
  for (const key of config.controls ?? []) {
    const p = infos.find((x) => x.key === key);
    if (!p || p.options) continue;
    // 5つの値で計る(はしだけだと、途中で大きく変わるもの(レンズの焦点の近く)を見のがす)
    const xs = [0, 0.25, 0.5, 0.75, 1].map((k) => Number((p.min + (p.max - p.min) * k).toPrecision(4)));
    const ys = [];
    for (const x of xs) ys.push((await measure({ ...config, params: { ...config.params, [key]: x } })).r);
    if (ys.some((y) => !Number.isFinite(y?.value))) continue;
    const v = ys.map((y) => y.value);
    const up = v.every((y, i) => !i || y >= v[i - 1] - 1e-9), down = v.every((y, i) => !i || y <= v[i - 1] + 1e-9);
    const rel = (Math.max(...v) - Math.min(...v)) / Math.max(Math.abs(v[0]), 1e-9);
    const how = rel < 0.01 ? "(変わらない)" : rel < 0.05 ? "(少しだけ変わる)" : up ? "(大きくなる)" : down ? "(小さくなる)" : "(途中で大きく変わる)";
    const label = p.label.replace(/\(.*\)/, "");
    const u = (x) => `${x}${p.unit ? " " + p.unit : ""}`;
    lines.push(`${label}を ${xs.map(u).join("・")} にすると、${name}は ${ys.map(show).join("・")}${how}。`);
    // 比例・反比例かどうか(AIが「比例する」と思いこんで書かないように、計った数で決める)
    if (rel >= 0.05 && xs[0] > 0 && v.every((y) => y > 0) && !ys.some((y) => y.na)) {
      const k = (f) => { const r = xs.map((x, i) => f(x, v[i])); return (Math.max(...r) - Math.min(...r)) / Math.max(...r); };
      const kind = k((x, y) => y / x) < 0.02 ? '比例する' : k((x, y) => y * x) < 0.02 ? '反比例する' : k((x, y) => y / Math.sqrt(x)) < 0.02 ? '比例しない(平方根に比例する)' : '比例も反比例もしない';
      lines.push(`→ ${name}は、${label}に${kind}。`);
    }
    if (rel >= 0.05) changed.push(label);
    trends.push({ key, label, aliases: p.aliases ?? [], how: rel < 0.01 ? 'same' : rel < 0.05 ? 'small' : up ? 'up' : down ? 'down' : 'mixed' });
  }
  for (const x of base.monitor.results ?? []) if (x.ok) lines.push(`(確かめ済み)${x.label.replace(/\(.*\)/, "")}:シミュレーションの計算は理論の式と合っている。`);
  if (base.monitor.energyDrift && base.monitor.energyDrift < 1e-3) lines.push('まさつや空気の抵抗がないとき、力学的エネルギーは一定に保たれる。');
  const vary = (config.controls ?? []).map((k) => infos.find((p) => p.key === k)?.label.replace(/\(.*\)/, '')).filter(Boolean);
  // 系が、条件を変えるだけでは出ない「くらべる値」(天体ごとの重力など)を持っているとき
  const extra = getSystem(config.system).model.facts?.(getSystem(config.system).model.prepare(config)) ?? null;
  if (extra) lines.push(...extra.lines);
  const goal = `${vary.slice(0, 2).join('や')}を変えて、${name}をくらべよう`.slice(0, 40);
  // 確認問題の検査(core/quiz-check.js)に使う、計った値そのもの
  const quantities = [...base.rs0.map((x) => ({ ...x, when: 'start' })), ...base.rs.map((x) => ({ ...x, when: 'end' }))]
    .filter((x) => x.key !== 't' && Number.isFinite(x.value)).map(({ key, label, value, unit, when }) => ({ key, label, value, unit, when }));
  if (extra) quantities.push(...extra.quantities);
  const data = { measure: name, measureKey: base.r?.key ?? null, measureValue: Number.isFinite(base.r?.value) ? base.r.value : null, measureUnit: base.r?.unit ?? '', quantities, trends };
  return { measure: name, lines, goal, changed, data };
}
