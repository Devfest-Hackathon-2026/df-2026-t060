// HybridSim と Word 原案のルーターを、登録済み実験の選択と条件の検証に置き換える。
// 表示、AI、教材配信のどこから来ても同じ設定の形を使う。
import { SYSTEMS, defaultConfig, paramInfo } from './sim2/systems/index.js';
import { GRADES } from './sim2/core/constants.js';
import { checkedConfig } from './inquiry-data.js';

const item = (id, family, system, title, detail, question, params = {}, render) => ({ id, family, system, title, detail, question, params, render });
export const LAB_FAMILIES = [
  { id: 'space', name: '宇宙', num: '01', color: '#81b1ff' },
  { id: 'motion', name: '力学', num: '02', color: '#ffc17e' },
  { id: 'electric', name: '電気', num: '03', color: '#ffe179' },
  { id: 'wave', name: '波・光・音', num: '04', color: '#79e4ce' },
  { id: 'fluid', name: '流体', num: '05', color: '#c6a6ff' },
];
export const LAB_PRESETS = [
  item('escape', 'space', 'orbit', '地球から脱出できる？', '地球の重力だけを使い、同じ高度から打ち出した衛星を追う。大気と月の影響は扱わない。衛星と矢印は見やすく拡大。', '速さだけを変えると、地球へ戻るかどうかはどこで変わる？', { ratio: 1.4 }, '3d'),
  item('solar', 'space', 'solar', '3D太陽系', '8惑星を初期の軌道から太陽と惑星の重力で進める。天体は拡大し、外側の距離を圧縮して表示する。', '太陽からの距離と、公転にかかる時間にはどんな関係がある？', {set:'all'}, '3d'),
  item('projectile', 'motion', 'projectile', '投げた球と自由落下', '空気抵抗を省いた等加速度運動。初速0にすると自由落下になる。', '同じ速さで角度だけを変えると、飛んだ距離はどう変わる？', { v0: 24, angle: 45, h0: 12 }, '3d'),
  item('pendulum', 'motion', 'pendulum', 'ひとつの振り子', '長さ・振れ幅・重力を変え、周期を測る。', '長さだけを変えると、1往復にかかる時間はどう変わる？', {}, '3d'),
  item('doublependulum', 'motion', 'doublependulum', '二重振り子の軌跡', '質量のない2本の棒と、等しい質量のおもり。初期角度の小さな差を比べられる。', '下の初期角度を1度だけ変えたら、同じ時刻の軌跡はどれだけ違う？', {}, '3d'),
  item('domino', 'motion', 'domino', '倒れる板の連鎖', '床に置いた10枚の板が、押されて倒れたり滑ったりする。板と床の接触に反発と摩擦がはたらく。', '板の間隔をどのくらい広げると、連鎖が途中で止まる？', {dynamics:'rigid'}, '3d'),
  item('circuit', 'electric', 'circuit', '直列と並列の回路', '理想的な電源と抵抗の回路。粒の動きは電流の大きさを示す模式表示。', '電圧をそろえて回路を直列から並列に変えると、全体の電流はどうなる？'),
  item('doppler', 'wave', 'doppler', 'ドップラー効果', '静止した空気の中を等速で動く音源の波面。音速以上では前方の周波数を表示しない。', '音源が速くなるほど、前後の波面の間隔の差はどうなる？'),
  item('lens', 'wave', 'lens', '凸レンズで像をつくる', '薄いレンズの作図。焦点距離と物体の位置を変え、光線の交わる場所を追う。', '物体を焦点へ近づけると、像はどこへ動く？'),
  item('sound', 'wave', 'sound', '音と空気のふるえ', '空気の縦波。点は空気の動き、圧力の色は圧力変化を表す。', 'ふるえの速さだけを変えると、聞こえる音と波長はどう変わる？'),
  item('buoyancy', 'fluid', 'buoyancy', '浮く物体と沈む物体', '静水の中を上下する立方体。浮力・重力・底からの力を分けて表示する。', '物体の密度だけを変えると、水に入る体積の割合はどうなる？'),
];
const lookup = new Map(LAB_PRESETS.map(p => [p.id, p]));
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
export function labPreset(id) { return lookup.get(id) ?? null; }

export function makeLabPlan(id, { edits = [], grade, reason = '' } = {}) {
  const preset = labPreset(id);
  if (!preset) throw new Error('実験工房にない実験です');
  if (!Array.isArray(edits) || edits.length > 6) throw new Error('条件は6個まで指定できます');
  if (typeof reason !== 'string' || reason.length > 240) throw new Error('選んだ理由は240字以内で書いてください');
  const system = SYSTEMS[preset.system], example = system.examples[0]?.config;
  const config = structuredClone(example ?? defaultConfig(preset.system));
  if (GRADES.includes(grade)) config.curriculum.grade = grade;
  Object.assign(config.params, preset.params);
  config.render = preset.render ?? '3d';
  config.view = { ...config.view, mode: 'experiment' };
  // 先生が工房で変えた条件を、児童側でも調べられるようにする。
  config.controls = paramInfo(preset.system).filter(p=>p.key!=='dynamics').map(p => p.key).slice(0, 6);
  const info = new Map(paramInfo(preset.system).map(p => [p.key, p]));
  const used = new Set();
  for (const entry of edits) {
    const param = plain(entry) && info.get(entry.key);
    if (!param || !config.controls.includes(entry.key) || used.has(entry.key)) throw new Error('指定できない条件、または重複した条件があります');
    const v = entry.value;
    if (param.options ? !param.options.includes(v) : typeof v !== 'number' || !Number.isFinite(v) || v < param.min || v > param.max) throw new Error(`${param.label}の値が範囲外です`);
    used.add(entry.key); config.params[entry.key] = v;
  }
  return { preset: id, config: checkedConfig(config), reason: reason.trim() };
}

export function labMaterial(plan, current = plan.config) {
  const preset = labPreset(plan.preset), config = checkedConfig(current);
  if (!preset || config.system !== preset.system) throw new Error('実験と条件の種類が一致しません');
  return { title: preset.title, explanation: preset.detail,
    sim: { type: 'cfg', config, goal: preset.question }, quiz: [],
    lesson: { question: preset.question, predict: '何が起きるか、理由といっしょに予想する。', check: '一度に変える条件を1つに決め、再生して記録する。', result: '同じ時刻の測定値や軌跡を比べる。', summary: '分かったことと次の問いを書く。' },
  };
}

export function labParamGuide() {
  return LAB_PRESETS.map(p => ({ preset: p.id, label: p.title,
    conditions: paramInfo(p.system).filter(k => k.key !== 'dynamics').slice(0, 6).map(k => ({ key: k.key, label: k.label, unit: k.unit, allowed: k.options ?? [k.min, k.max] })) }));
}

// 地表付近、空気抵抗なし。第3は地球の公転と同じ向きに脱出する近似。
export function cosmicSpeeds() {
  const muEarth = 3.986004418e14, R = 6.371e6, muSun = 1.32712440018e20, AU = 149597870700;
  const first = Math.sqrt(muEarth / R), second = Math.SQRT2 * first;
  const earthAroundSun = Math.sqrt(muSun / AU);
  const third = Math.hypot(second, (Math.SQRT2 - 1) * earthAroundSun);
  return [first, second, third].map(v => v / 1000);
}
