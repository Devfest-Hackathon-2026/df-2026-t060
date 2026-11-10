// 人工衛星の運動(万有引力、3次元)。状態 y = [x, y, z, vx, vy, vz](地球の中心が原点、SI単位)。
//   a = −GM r / |r|³   (地球は動かない)
// はじめは地表から alt の高さの (r0, 0, 0) から、地球の中心に垂直な向きに、回り続ける速さ vc の ratio 倍で打ち出す。
// 打ち出す向きは (0, cos i, sin i)。i が 0 でない軌道は、z 方向にも動く(軌道面が傾く)。
// ratio = 1 で円軌道、1 より大きいと楕円、√2 倍(第二宇宙速度)以上で飛んでいき、小さすぎると地球に落ちる。
import { GM_EARTH, R_EARTH } from '../../core/constants.js';

export const solver = 'velocityVerlet';
export const dt = 10;
// 実時間1秒でモデルの600秒を進める。積分は引き続き10秒刻み。
export const timeScale = 600;

export function prepare(config) {
  const q = config.params;
  const i = (q.incl * Math.PI) / 180;
  const r0 = R_EARTH + q.alt * 1000;
  const vc = Math.sqrt(GM_EARTH / r0);
  const v0 = q.ratio * vc;
  const eps = 0.5 * v0 * v0 - GM_EARTH / r0; // 質量あたりの全エネルギー
  const e = Math.abs((r0 * v0 * v0) / GM_EARTH - 1); // 離心率(はじめは近点か遠点)
  let a = null, period = null, rmin = null;
  if (eps < 0) {
    a = -GM_EARTH / (2 * eps);
    rmin = a * (1 - e);
    if (rmin > R_EARTH) period = 2 * Math.PI * Math.sqrt((a * a * a) / GM_EARTH);
    else period = null; // 地球にぶつかる
  }
  return { ...q, GM: GM_EARTH, R: R_EARTH, i, ci: Math.cos(i), si: Math.sin(i), r0, vc, v0, vesc: Math.SQRT2 * vc, eps, e, a, period, rmin, bound: eps < 0 };
}

export const init = (p) => [p.r0, 0, 0, 0, p.v0 * p.ci, p.v0 * p.si];
export const makeState = () => ({ sweep: 0, lastAng: 0, period: null, crashed: null, maxR: 0, minR: Infinity, maxAbsZ: 0 });

export const accel = (pos, v, t, p) => {
  const r2 = pos[0] ** 2 + pos[1] ** 2 + pos[2] ** 2, k = -p.GM / (r2 * Math.sqrt(r2));
  return [k * pos[0], k * pos[1], k * pos[2]];
};
export const deriv = (y, t, p) => [y[3], y[4], y[5], ...accel(y.slice(0, 3), y.slice(3), t, p)];

const planeAngle = (y, p) => Math.atan2(y[1] * p.ci + y[2] * p.si, y[0]); // 軌道面の中の角度
export const speedOf = (y) => Math.hypot(y[3], y[4], y[5]);

export function after(prev, next, t, p, s, dt) {
  const r = Math.hypot(next[0], next[1], next[2]);
  s.maxR = Math.max(s.maxR, r); s.minR = Math.min(s.minR, r); s.maxAbsZ = Math.max(s.maxAbsZ, Math.abs(next[2]));
  // 1周(軌道面の中で 2π 回ったとき)の時間を、線でつないで出す
  let d = planeAngle(next, p) - s.lastAng;
  if (d < -Math.PI) d += 2 * Math.PI; else if (d > Math.PI) d -= 2 * Math.PI;
  const prevSweep = s.sweep;
  s.sweep += d; s.lastAng = planeAngle(next, p);
  if (s.period === null && s.sweep >= 2 * Math.PI) s.period = t - dt + (dt * (2 * Math.PI - prevSweep)) / (s.sweep - prevSweep);
  if (r <= p.R) { s.crashed = t; const k = p.R / r; return { y: [next[0] * k, next[1] * k, next[2] * k, 0, 0, 0], stop: true }; }
  return null;
}

export function energy(y, p) {
  const r = Math.hypot(y[0], y[1], y[2]);
  const K = 0.5 * p.m * speedOf(y) ** 2, U = (-p.GM * p.m) / r;
  return { K, U, total: K + U };
}
export const energyScale = (p) => (p.GM * p.m) / p.r0;

export function observe(y, t, p, st) {
  const r = Math.hypot(y[0], y[1], y[2]), h = Math.hypot(y[1] * y[5] - y[2] * y[4], y[2] * y[3] - y[0] * y[5], y[0] * y[4] - y[1] * y[3]);
  return { t, pos: y.slice(0, 3), vel: y.slice(3, 6), r, alt: (r - p.R) / 1000, speed: speedOf(y), h, energy: energy(y, p), period: st.period, crashed: st.crashed, maxAbsZ: st.maxAbsZ,
    outcome: !p.bound ? '飛んでいく' : p.period === null ? '地球に落ちる' : '回り続ける' };
}

export function draw(r, o, p, opt = {}) {
  const box = opt.viewExtent ?? Math.max(p.r0 * 2.2, o.r * 1.2);
  r.view({ x0: -box, x1: box, y0: -box, y1: box });
  r.ball(0, 0, p.R, 'accent2', opt.labels ? '地球' : '');
  r.line(-box, 0, box, 0, 'grid', 1); r.line(0, -box, 0, box, 'grid', 1);
  // x–y 面を真上から見た図(z の高さは、文字で出す)
  if (opt.path) r.polyline(opt.path, opt.pathColor ?? 'accent', 1.8);
  else r.trail(o.pos[0], o.pos[1], 'accent', 6000);
  r.ball(o.pos[0], o.pos[1], p.R * 0.04, 'warm', opt.labels ? '衛星' : '');
  r.label(12, 22, `z = ${(o.pos[2] / 1000).toFixed(0)} km(真上から見た図)`, 'muted', 12);
  if (o.crashed !== null) r.label(12, 42, '地球に落ちました', 'warm', 14);
}

export function formulas(p) {
  return [
    'F = G·M·m / r²(万有引力)',
    `回り続ける速さ vc = √(GM/r) = ${(p.vc / 1000).toFixed(2)} km/s`,
    `飛んでいく速さ √2·vc = ${(p.vesc / 1000).toFixed(2)} km/s`,
    p.period ? `周期 T = 2π√(a³/GM) = ${(p.period / 60).toFixed(1)} 分` : '周期:1周しない',
  ];
}

export function readouts(o, p) {
  return [
    { key: 't', label: '時間', value: o.t / 60, unit: '分', digits: 1 },
    { key: 'alt', label: '高さ', value: o.alt, unit: 'km', digits: 0 },
    { key: 'speed', label: '速さ', value: o.speed / 1000, unit: 'km/s', digits: 2 },
    { key: 'period', label: '1周の時間', value: o.period === null ? null : o.period / 60, unit: '分', digits: 1 },
  ];
}

export const experiment = { measure: 'period' };

/** 3D の絵(render/three3d.js)にわたす形。計算した位置・速度だけをわたす */
export function view3d(o, p, opt = {}) {
  const ext = opt.viewExtent ?? Math.max(p.r0 * 2.2, o.r * 1.2);
  const sp = Math.hypot(...o.vel) || 1;
  return {
    extent: ext,
    bodies: [
      { id: 'earth', pos: [0, 0, 0], radius: p.R, color: 0x2d6cdf },
      { id: 'sat', pos: o.pos, radius: Math.max(p.R * 0.035, ext * 0.012), color: 0xffa94d, trail: true },
    ],
    vectors: [
      { from: o.pos, dir: o.vel.map((c) => (c / sp) * ext * 0.2), color: 0xffd43b, label: '速度の向き（長さは表示用）' },
      // 加速度(万有引力 ÷ 質量)は、いつも地球の中心を向く
      { from: o.pos, dir: o.pos.map((c) => (-c / o.r) * ext * 0.12), color: 0x69db7c, label: '重力の向き（長さは表示用）' },
    ],
  };
}

/** 動きがゆっくり(1周が約90分)なので、速さの選べる倍率を大きくする */
export const speedOptions = [1, 2, 5, 10];

/** 計った結果を文にするときに動かす時間(秒):1周するまで(1周しないときは 6 時間) */
export const factSeconds = (p) => (p.period ? p.period * 1.05 : 6 * 3600);
