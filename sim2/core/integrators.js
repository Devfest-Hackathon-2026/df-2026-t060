// 積分器(ソルバー)。系(model)とは切りはなし、差しかえられるようにする。
// 系は、状態 y(数の配列)と、その時間微分 f(y, t) を決める。
//   model.deriv(y, t, p) → dy/dt(配列)              … rk4・backwardEuler で使う
//   model.accel(x, v, t, p) → 加速度(配列)            … velocityVerlet で使う(y = [位置…, 速度…])
//   model.exact(t, p, y0) → その時刻の y                … analytic で使う(解析解)
// 波の差分法(fdtd)は、格子を持つ系の中で行う(systems/wave など)。

const axpy = (y, k, a) => y.map((v, i) => v + a * k[i]);

/** 4次のルンゲ=クッタ法 */
export function rk4(model, y, t, dt, p) {
  const k1 = model.deriv(y, t, p);
  const k2 = model.deriv(axpy(y, k1, dt / 2), t + dt / 2, p);
  const k3 = model.deriv(axpy(y, k2, dt / 2), t + dt / 2, p);
  const k4 = model.deriv(axpy(y, k3, dt), t + dt, p);
  return y.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

/** 速度ベルレ法(エネルギーが長い時間ずれていかない)。y = [位置…, 速度…] */
export function velocityVerlet(model, y, t, dt, p) {
  const n = y.length / 2;
  const x = y.slice(0, n), v = y.slice(n);
  const a0 = model.accel(x, v, t, p);
  const x1 = x.map((xi, i) => xi + v[i] * dt + 0.5 * a0[i] * dt * dt);
  // 速度によらない力のときは、これで正確な速度ベルレ法になる
  const a1 = model.accel(x1, v.map((vi, i) => vi + a0[i] * dt), t + dt, p);
  const v1 = v.map((vi, i) => vi + 0.5 * (a0[i] + a1[i]) * dt);
  return [...x1, ...v1];
}

/** 後退オイラー法(とても安定。エネルギーは少しずつ減る)。不動点の反復で解く */
export function backwardEuler(model, y, t, dt, p) {
  let next = axpy(y, model.deriv(y, t, p), dt);
  for (let i = 0; i < 20; i++) {
    const f = model.deriv(next, t + dt, p);
    const cand = axpy(y, f, dt);
    const change = Math.max(...cand.map((v, j) => Math.abs(v - next[j])));
    next = cand;
    if (change < 1e-12) break;
  }
  return next;
}

/** 解析解(数値積分をしない)。model.exact が必要 */
export function analytic(model, y, t, dt, p, y0) {
  return model.exact(t + dt, p, y0);
}

/** 格子の上の差分法(波の FDTD・熱の FTCS など)。1刻みの進め方は系が決める(model.gridStep) */
export function grid(model, y, t, dt, p) {
  return model.gridStep(y, t, dt, p);
}

export const INTEGRATORS = { rk4, velocityVerlet, backwardEuler, analytic, grid };
export const INTEGRATOR_NAMES = Object.keys(INTEGRATORS);
