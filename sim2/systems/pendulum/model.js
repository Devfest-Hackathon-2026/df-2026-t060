// 単振り子。状態 y = [θ(rad), ω(rad/s)]。ベルレ法では 位置=θ、速度=ω。
//   θ'' = −(g/L) sin θ − b ω   (b:空気の抵抗。0 ならエネルギーが保存する)
// 1往復の時間は、θ が 0 を同じ向きに2回横切る間の時間で計る(公式は使わない)。

export const solver = 'velocityVerlet';
/** 実験モードで記録するもの */
export const experiment = { measure: 'period' };
export const dt = 1 / 1000;

export function prepare(config) {
  const q = config.params;
  return { L: q.L, m: q.m, g: q.g, b: q.b ?? 0, theta0: (q.theta0 * Math.PI) / 180, theta0Deg: q.theta0 };
}

export const init = (p) => [p.theta0, 0];
export const makeState = () => ({ crossings: [], period: null, swings: 0 });

export const accel = ([th], [om], t, p) => [-(p.g / p.L) * Math.sin(th) - p.b * om];
export const deriv = ([th, om], t, p) => [om, -(p.g / p.L) * Math.sin(th) - p.b * om];

/** 1往復を数える(θ が − から + へ 0 を横切った時刻を、線でつないで正確に出す) */
export function after(prev, next, t, p, s, dt) {
  if (prev[0] < 0 && next[0] >= 0) {
    const f = -prev[0] / (next[0] - prev[0]);
    s.crossings.push(t - dt + f * dt);
    if (s.crossings.length > 50) s.crossings.shift();
    if (s.crossings.length >= 2) { s.period = s.crossings.at(-1) - s.crossings.at(-2); s.swings++; }
  }
  return null;
}

export function energy([th, om], p) {
  const K = 0.5 * p.m * (p.L * om) ** 2;
  const U = p.m * p.g * p.L * (1 - Math.cos(th));
  return { K, U, total: K + U };
}
/** エネルギーのずれをくらべる大きさ(はじめの位置エネルギー) */
export const energyScale = (p) => p.m * p.g * p.L * (1 - Math.cos(p.theta0)) || 1e-9;

/** 振れはばが大きいときも正しい周期:T = 2π√(L/g) / AGM(1, cos(θ0/2))(算術幾何平均を使う厳密な式) */
export function exactPeriod(p) {
  let a = 1, b = Math.cos(p.theta0 / 2);
  for (let i = 0; i < 30 && Math.abs(a - b) > 1e-15; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return (2 * Math.PI * Math.sqrt(p.L / p.g)) / a;
}
/** 振れはばが小さいときの公式 T = 2π√(L/g) */
export const smallAnglePeriod = (p) => 2 * Math.PI * Math.sqrt(p.L / p.g);

export function observe(y, t, p, s) {
  const [th, om] = y;
  const E = energy(y, p);
  return {
    t, theta: th, omega: om,
    x: p.L * Math.sin(th), y: -p.L * Math.cos(th),
    speed: Math.abs(p.L * om),
    height: p.L * (1 - Math.cos(th)),
    energy: E,
    period: s.period, swings: s.swings,
  };
}

/** 絵(2D の共通の部品で書く)。r は render/canvas2d.js */
export function draw(r, o, p, opt = {}) {
  const L = p.L, pad = 0.25 * L;
  r.view({ x0: -L - pad, x1: L + pad, y0: -L - pad, y1: pad * 0.6 });
  r.line(-0.3 * L, 0, 0.3 * L, 0, 'muted', 4);
  // 振れはばの目安(点線の弧)と、いちばん下の高さ
  r.arc(0, 0, L, -Math.PI / 2 - p.theta0, -Math.PI / 2 + p.theta0, 'grid', true);
  r.line(0, 0, 0, -L - pad * 0.3, 'grid', 1, true);
  r.trail(o.x, o.y, 'accent2');
  r.line(0, 0, o.x, o.y, 'ink', 2);
  r.ball(o.x, o.y, 0.05 * L + 0.04 * Math.cbrt(p.m), 'warm', opt.labels ? `${p.m} kg` : '');
  if (opt.arrows) r.arrow(o.x, o.y, p.L * o.omega * Math.cos(o.theta) * 0.15, p.L * o.omega * Math.sin(o.theta) * 0.15, 'accent', '速さ');
}

/** 中学生向けに出す式(小学生には出さない) */
export function formulas(p, o) {
  return [
    `T = 2π√(L/g) = ${smallAnglePeriod(p).toFixed(3)} s(振れはばが小さいとき)`,
    `Ek = ½mv² , Ep = mgh , Ek + Ep = 一定`,
  ];
}

/** 画面に出す計った値 */
export function readouts(o, p) {
  return [
    { key: 'period', label: '1往復の時間', value: o.period, unit: '秒', digits: 3 },
    { key: 'swings', label: '往復した回数', value: o.swings, unit: '回', digits: 0 },
    { key: 'speed', label: '速さ', value: o.speed, unit: 'm/s', digits: 2, jhs: true },
    { key: 'height', label: '高さ', value: o.height, unit: 'm', digits: 3, jhs: true },
  ];
}
