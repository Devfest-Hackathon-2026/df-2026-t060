// 太陽系の惑星の運動(多体問題・3次元)。太陽と選んだ惑星が、たがいに万有引力で引き合う。
// 単位:長さ AU(天文単位)・時間 年・質量 太陽の質量。G = k² ×(365.25)²(k:ガウスの引力定数)。
// 状態 y = [x0,y0,z0, x1,y1,z1, …, vx0,vy0,vz0, …](0 が太陽)。座標は黄道面が x–y 面(z が北)。
// はじめの位置と速度は、JPL の軌道要素(2000年1月1日正午)から、ケプラーの方程式を解いて出す。
// 全体の重心が止まっているように、太陽の速度を合わせる(重心系)。
import { PLANETS } from './planets.js';

export const solver = 'velocityVerlet';
export const dt = 2e-4;
/** 刻み(年):内わくの惑星は水星(1周 0.24 年)に合わせて細かく、外わくは大きく */
export const dtFor = (config) => (config.params.set === 'outer' ? 5e-3 : 2e-4);
/** 1周が1年〜165年なので、速さの倍率を大きくする(1倍 = 1秒で1年) */
export const speedOptions = [0.25, 0.5, 1, 2, 5, 10];

/** ガウスの引力定数 k = 0.01720209895(AU^1.5 / 日 / 太陽質量^0.5。IAU 1976 の定義) → 1年 = 365.25 日 */
export const G = (0.01720209895 * 365.25) ** 2;
const SETS = { inner: ['mercury', 'venus', 'earth', 'mars'], outer: ['jupiter', 'saturn', 'uranus', 'neptune'] };
SETS.all = [...SETS.inner,...SETS.outer];
const MAIN = { inner: 'earth', outer: 'jupiter', all:'earth' };
const rad = (d) => (d * Math.PI) / 180;

/** ケプラーの方程式 E − e sin E = M を解く(ニュートン法) */
export function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 50; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

/** 軌道要素 → 太陽から見た位置と速度(AU, AU/年)。mu = G(M太陽 + m惑星) */
export function elementsToState(el, mu) {
  const { a, e } = el;
  const I = rad(el.I), O = rad(el.node), w = rad(el.peri - el.node);
  const M = rad((((el.L - el.peri) % 360) + 540) % 360 - 180);
  const E = solveKepler(M, e);
  const n = Math.sqrt(mu / (a * a * a)), Ed = n / (1 - e * Math.cos(E)), b = a * Math.sqrt(1 - e * e);
  const xp = a * (Math.cos(E) - e), yp = b * Math.sin(E);
  const vxp = -a * Math.sin(E) * Ed, vyp = b * Math.cos(E) * Ed;
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), cI = Math.cos(I), sI = Math.sin(I);
  const rot = (x, y) => [
    (cw * cO - sw * sO * cI) * x + (-sw * cO - cw * sO * cI) * y,
    (cw * sO + sw * cO * cI) * x + (-sw * sO + cw * cO * cI) * y,
    sw * sI * x + cw * sI * y,
  ];
  return { r: rot(xp, yp), v: rot(vxp, vyp) };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return a.map((c) => c / n); };

export function prepare(config) {
  const q = config.params;
  const ids = SETS[q.set];
  const planets = ids.map((id) => PLANETS[id]);
  const masses = [q.sunMass, ...planets.map((pl) => pl.mass)];
  // はじめの状態(太陽から見た値)。速度は本当の太陽の質量で決まる(太陽の質量を変えると、軌道が変わる)
  const rel = planets.map((pl) => elementsToState(pl, G * (1 + pl.mass)));
  const pos = [[0, 0, 0], ...rel.map((s) => s.r)], vel = [[0, 0, 0], ...rel.map((s) => s.v)];
  // 重心系にする(全体の重心が原点に止まる)
  const Mt = masses.reduce((s, m) => s + m, 0);
  const com = [0, 1, 2].map((k) => pos.reduce((s, r, i) => s + masses[i] * r[k], 0) / Mt);
  const vcm = [0, 1, 2].map((k) => vel.reduce((s, v, i) => s + masses[i] * v[k], 0) / Mt);
  const P0 = pos.map((r) => sub(r, com)), V0 = vel.map((v) => sub(v, vcm));
  // 惑星ごとの「軌道面の中の角度」をはかるための向き(はじめの位置と、角運動量の向き)
  const frames = rel.map((s) => { const e1 = unit(s.r), nrm = unit(cross(s.r, s.v)); return { e1, e2: cross(nrm, e1) }; });
  // ケプラーの第3法則で予想する周期(太陽と惑星の2体として、はじめの位置・速度から)
  const expected = rel.map((s, i) => {
    const mu = G * (q.sunMass + planets[i].mass);
    const inv = 2 / norm(s.r) - dot(s.v, s.v) / mu; // 1/a(活力の式)
    return inv > 0 ? 2 * Math.PI * Math.sqrt(1 / inv ** 3 / mu) : null;
  });
  // 絵のための軌道の形(2体として計算した楕円。点線で出す)
  const paths = rel.map((s, i) => {
    const mu = G * (q.sunMass + planets[i].mass), inv = 2 / norm(s.r) - dot(s.v, s.v) / mu;
    if (inv <= 0) return [];
    const a = 1 / inv, hv = cross(s.r, s.v), ev = sub(cross(s.v, hv).map((c) => c / mu), unit(s.r));
    const e = norm(ev), pdir = e > 1e-9 ? unit(ev) : unit(s.r), qdir = cross(unit(hv), pdir);
    return Array.from({ length: 97 }, (_, k) => {
      const E = (2 * Math.PI * k) / 96, x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
      return [0, 1, 2].map((c) => x * pdir[c] + y * qdir[c]);
    });
  });
  const reach = Math.max(...planets.map((pl) => pl.a * (1 + pl.e)));
  const mainIndex = ids.indexOf(MAIN[q.set]);
  return { ...q, ids, planets, masses, N: masses.length, P0, V0, frames, expected, paths, reach, mainIndex, mutualOn: q.mutual !== 'off' };
}

export const init = (p) => [...p.P0.flat(), ...p.V0.flat()];
export const makeState = (p) => ({ sweep: p.ids.map(() => 0), last: p.ids.map(() => 0), period: p.ids.map(() => null) });

export function accel(x, v, t, p) {
  const a = new Array(x.length).fill(0);
  for (let i = 0; i < p.N; i++) {
    for (let j = i + 1; j < p.N; j++) {
      if (!p.mutualOn && i > 0) continue; // 太陽とだけ引き合う(惑星どうしは引き合わない)
      const dx = x[3 * j] - x[3 * i], dy = x[3 * j + 1] - x[3 * i + 1], dz = x[3 * j + 2] - x[3 * i + 2];
      const r2 = dx * dx + dy * dy + dz * dz, k = G / (r2 * Math.sqrt(r2));
      a[3 * i] += k * p.masses[j] * dx; a[3 * i + 1] += k * p.masses[j] * dy; a[3 * i + 2] += k * p.masses[j] * dz;
      a[3 * j] -= k * p.masses[i] * dx; a[3 * j + 1] -= k * p.masses[i] * dy; a[3 * j + 2] -= k * p.masses[i] * dz;
    }
  }
  return a;
}
export const deriv = (y, t, p) => { const n = y.length / 2; return [...y.slice(n), ...accel(y.slice(0, n), y.slice(n), t, p)]; };

const posOf = (y, i) => [y[3 * i], y[3 * i + 1], y[3 * i + 2]];
const angleOf = (y, p, k) => { const r = sub(posOf(y, k + 1), posOf(y, 0)), f = p.frames[k]; return Math.atan2(dot(r, f.e2), dot(r, f.e1)); };

export function after(prev, next, t, p, s, dt) {
  // 惑星ごとに、太陽のまわりを回った角度をたし、1周(2π)の時刻を線でつないで出す
  for (let k = 0; k < p.ids.length; k++) {
    const ang = angleOf(next, p, k);
    let d = ang - s.last[k];
    if (d < -Math.PI) d += 2 * Math.PI; else if (d > Math.PI) d -= 2 * Math.PI;
    const before = s.sweep[k];
    s.sweep[k] += d; s.last[k] = ang;
    if (s.period[k] === null && s.sweep[k] >= 2 * Math.PI) s.period[k] = t - dt + (dt * (2 * Math.PI - before)) / (s.sweep[k] - before);
  }
  return null;
}

export function energy(y, p) {
  const n = y.length / 2;
  let K = 0, U = 0;
  for (let i = 0; i < p.N; i++) {
    K += 0.5 * p.masses[i] * (y[n + 3 * i] ** 2 + y[n + 3 * i + 1] ** 2 + y[n + 3 * i + 2] ** 2);
    for (let j = i + 1; j < p.N; j++) {
      if (!p.mutualOn && i > 0) continue;
      U -= (G * p.masses[i] * p.masses[j]) / norm(sub(posOf(y, i), posOf(y, j)));
    }
  }
  return { K, U, total: K + U };
}
/** エネルギーのずれをくらべる大きさ(はじめの位置エネルギーの大きさ) */
export const energyScale = (p) => Math.abs(energy(init(p), p).U);

/** 全体の運動量(重心系なので 0 のまま) */
export function momentum(y, p) {
  const n = y.length / 2;
  return [0, 1, 2].map((c) => p.masses.reduce((s, m, i) => s + m * y[n + 3 * i + c], 0));
}

export function observe(y, t, p, st) {
  const sun = posOf(y, 0);
  return {
    t, sun,
    planets: p.ids.map((id, k) => ({ id, name: p.planets[k].name, pos: posOf(y, k + 1), dist: norm(sub(posOf(y, k + 1), sun)), period: st.period[k] })),
    Tmain: st.period[p.mainIndex], energy: energy(y, p),
  };
}

export function draw(r, o, p, opt = {}) {
  const ext = p.reach * 1.15;
  r.view({ x0: -ext, x1: ext, y0: -ext, y1: ext });
  r.line(-ext, 0, ext, 0, 'grid', 1); r.line(0, -ext, 0, ext, 'grid', 1);
  p.paths.forEach((pts, k) => r.polyline(pts.map((q) => [q[0], q[1]]), 'grid', 1, true));
  r.ball(o.sun[0], o.sun[1], ext * 0.03, 'yellow', opt.labels ? '太陽' : '');
  o.planets.forEach((pl, k) => r.ball(pl.pos[0], pl.pos[1], ext * 0.012, p.planets[k].color2d, opt.labels ? pl.name : ''));
  r.label(12, 22, '黄道面を北から見た図(点線は太陽と2体のときの軌道)', 'muted', 12);
}

export function view3d(o, p) {
  const ext = p.reach * 1.15;
  return {
    extent: ext,
    bodies: [
      { id: 'sun', pos: o.sun, radius: ext * 0.035, color: 0xffd43b },
      ...o.planets.map((pl, k) => ({ id: pl.id, pos: pl.pos, radius: ext * (p.set === 'outer' ? 0.015 : 0.012), color: p.planets[k].color3d, trail: true, trailColor: p.planets[k].color3d })),
    ],
  };
}

export function formulas(p) {
  return ['F = G·M·m / r²(万有引力)', 'T² / a³ = 一定(ケプラーの第3法則)', `太陽の質量:本当の ${p.sunMass} 倍`];
}

export function readouts(o, p) {
  return [
    { key: 't', label: '時間', value: o.t, unit: '年', digits: 2 },
    { key: 'Tmain', label: `${p.planets[p.mainIndex].name}の公転周期`, value: o.Tmain, unit: '年', digits: 3 },
    ...o.planets.filter((pl, k) => k !== p.mainIndex).map((pl) => ({ key: `T_${pl.id}`, label: `${pl.name}の公転周期`, value: pl.period, unit: '年', digits: 3, jhs: true })),
  ];
}

/** 計った結果を文にするときに動かす時間(年):いちばん内側の確かめる惑星が1周するまで */
export const factSeconds = (p) => (p.expected[p.mainIndex] ?? 1) * 1.05;
export const experiment = { measure: 'Tmain' };
