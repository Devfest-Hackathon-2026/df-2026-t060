// 自由落下・投射運動(空気の抵抗なし)。状態 y = [x, y, vx, vy](x:水平のきょり m、y:地面からの高さ m)。
//   ax = 0, ay = −g   → 水平は等速直線運動、鉛直は等加速度運動
// 地面(y = 0)に着いたら止める(着いた時刻は、線でつないで出す)。v0 = 0 なら自由落下。

export const solver = 'analytic';
export const dt = 1 / 1000;

export function prepare(config) {
  const q = config.params;
  const th = (q.angle * Math.PI) / 180;
  return { ...q, vx0: q.v0 * Math.cos(th), vy0: q.v0 * Math.sin(th) };
}

export const init = (p) => [0, p.h0, p.vx0, p.vy0];
export const makeState = (p) => ({ landed: null, range: null, vEnd: null, maxH: p.h0, tApex: p.vy0 > 0 ? null : 0 });
export const deriv = (y, t, p) => [y[2], y[3], 0, -p.g];
export const accel = (x, v, t, p) => [0, -p.g];
/** 解析解:x = vx0 t, y = h0 + vy0 t − ½ g t², vy = vy0 − g t */
export const exact = (t, p) => [p.vx0 * t, p.h0 + p.vy0 * t - 0.5 * p.g * t * t, p.vx0, p.vy0 - p.g * t];

export function after(prev, next, t, p, s, dt) {
  if (next[1] > s.maxH) { s.maxH = next[1]; s.tApex = t; }
  if (next[1] <= 0 && next[3] < 0) {
    const f = prev[1] === next[1] ? 1 : (prev[1] - 0) / (prev[1] - next[1]);
    const lerp = (i) => prev[i] + f * (next[i] - prev[i]);
    s.landed = t - dt + f * dt;
    s.range = lerp(0);
    s.vEnd = Math.hypot(lerp(2), lerp(3));
    return { y: [lerp(0), 0, lerp(2), lerp(3)], stop: true };
  }
  return null;
}

export function energy([, y, vx, vy], p) {
  const K = 0.5 * p.m * (vx * vx + vy * vy);
  const U = p.m * p.g * y;
  return { K, U, total: K + U };
}

export function observe(y, t, p, st) {
  return { t, x: y[0], y: y[1], vx: y[2], vy: y[3], speed: Math.hypot(y[2], y[3]), energy: energy(y, p), landed: st.landed, range: st.range, vEnd: st.vEnd, maxH: st.maxH };
}

/** 絵のために、飛ぶ範囲を理論の式から見積もる(計算結果ではなく、画面の大きさを決めるだけに使う) */
function extent(p) {
  const T = (p.vy0 + Math.sqrt(p.vy0 * p.vy0 + 2 * p.g * p.h0)) / p.g;
  const top = p.h0 + (p.vy0 > 0 ? (p.vy0 * p.vy0) / (2 * p.g) : 0);
  return { W: Math.max(p.vx0 * T, 1), H: Math.max(top, 1) };
}

export function draw(r, o, p, opt = {}) {
  const { W, H } = extent(p);
  const side = Math.max(W, H * 1.2) * 0.1;
  r.view({ x0: -side, x1: Math.max(W, H * 1.2) + side, y0: -side * 0.8, y1: H + side });
  r.ground(0, -side, Math.max(W, H * 1.2) + side);
  r.line(0, 0, 0, p.h0, 'grid', 1, true);
  r.trail(o.x, o.y, 'accent2', 2000);
  r.ball(o.x, o.y, 0.02 * Math.max(W, H), 'warm', opt.labels ? `${p.m} kg` : '');
  if (opt.arrows && !o.landed) {
    const k = 0.05 * Math.max(W, H) / Math.max(o.speed, 1);
    r.arrow(o.x, o.y, o.vx * k, o.vy * k, 'accent', '速さ');
  }
}

export function formulas(p) {
  return [
    '水平:x = v₀cosθ · t(等速直線運動)',
    '鉛直:y = h₀ + v₀sinθ · t − ½gt²(等加速度運動)',
    `着地までの時間 t = ${((p.vy0 + Math.sqrt(p.vy0 ** 2 + 2 * p.g * p.h0)) / p.g).toFixed(3)} 秒`,
    'Ek + Ep = 一定',
  ];
}

export function readouts(o) {
  return [
    { key: 't', label: '時間', value: o.t, unit: '秒', digits: 2 },
    { key: 'speed', label: '速さ', value: o.speed, unit: 'm/s', digits: 2 },
    { key: 'y', label: '高さ', value: o.y, unit: 'm', digits: 2 },
    { key: 'landed', label: '着地した時間', value: o.landed, unit: '秒', digits: 3 },
    { key: 'range', label: '飛んだきょり', value: o.range, unit: 'm', digits: 2 },
    { key: 'maxH', label: 'いちばん高いところ', value: o.maxH, unit: 'm', digits: 2, jhs: true },
  ];
}

export const experiment = { measure: 'landed' };

/** 3D の絵(render/three3d.js)にわたす形。物理の座標 (x, y) を、3D では (x, 0, y)(z が上)にする */
export function view3d(o, p) {
  const { W, H } = extent(p);
  const ext = Math.max(W, H) * 0.6;
  const sp = Math.max(o.speed, 1e-9);
  return {
    extent: ext,
    center: [W / 2, 0, 0],
    bodies: [{ id: 'ball', pos: [o.x, 0, o.y], radius: 0.03 * Math.max(W, H), color: 0xff9f43, trail: true, trailColor: 0x4dabf7 }],
    vectors: o.landed === null ? [
      { from: [o.x, 0, o.y], dir: [(o.vx / sp) * ext * 0.25, 0, (o.vy / sp) * ext * 0.25], color: 0xffd43b, label: '速さ' },
      { from: [o.x, 0, o.y], dir: [0, 0, -ext * 0.15], color: 0x69db7c, label: '加速度(重力)' },
    ] : [],
  };
}

/** 計った結果を文にするときに動かす時間(秒):着地するまで */
export const factSeconds = (p) => ((p.vy0 + Math.sqrt(p.vy0 ** 2 + 2 * p.g * p.h0)) / p.g) * 1.05 + 0.01;
