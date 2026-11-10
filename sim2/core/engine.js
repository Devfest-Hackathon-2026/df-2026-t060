// 計算を、決まった刻み Δt で進める。絵(requestAnimationFrame)とは切りはなす(アキュムレータ方式)。
//   const e = createEngine(system, config);
//   毎フレーム e.advance(経過した秒) → 何回か step() する。絵は e.y / e.t を見てかく
// DOM を使わない(ブラウザ・Web Worker・Node のどこでも動く)。
import { INTEGRATORS } from './integrators.js';
import { createMonitor } from './monitor.js';

/**
 * @param {{model: object, validator?: object}} system  systems/<name>/ の中身
 * @param {object} config  確かめ済みの設定
 */
export function createEngine(system, config) {
  const { model } = system;
  const solverName = config.solver ?? model.solver ?? 'rk4';
  const solve = INTEGRATORS[solverName];
  if (!solve) throw new Error(`ソルバーがない:${solverName}`);
  // 刻み:設定 > 系が条件ごとに決める(dtFor) > 系のふつう(dt)
  const dt = config.dt ?? model.dtFor?.(config) ?? model.dt ?? 1 / 600;
  const e = {
    system, config, dt, solverName,
    p: null, y: null, y0: null, t: 0, steps: 0, acc: 0, speed: config.speed ?? 1, timeScale: model.timeScale ?? 1, monitor: null, stopped: false,
    reset() {
      e.p = model.prepare(config);
      e.y = model.init(e.p);
      e.y0 = e.y.slice();
      e.t = 0; e.steps = 0; e.acc = 0; e.stopped = false;
      e.state = model.makeState?.(e.p) ?? {};
      e.monitor = createMonitor(system, e);
      return e;
    },
    /** 1刻みだけ進める(コマ送りにも使う) */
    step() {
      if (e.stopped) return;
      let next = solve(model, e.y, e.t, dt, e.p, e.y0);
      // 系ごとのできごと(地面に着いた・1往復した など)。止めるときは stop を返す
      const ev = model.after?.(e.y, next, e.t + dt, e.p, e.state, dt);
      if (ev?.y) next = ev.y;
      e.y = next;
      e.t += dt;
      e.steps++;
      if (ev?.stop) e.stopped = true;
    },
    /**
     * 経過した本当の秒数だけ進める(速さ speed 倍)。1回に進める量には上限をつける(タブが裏にあったときなど)
     * @returns {number} 次の刻みまでの割合(絵をなめらかにするのに使える)
     */
    advance(realSec) {
      e.acc += Math.min(Math.max(realSec, 0), 0.25) * e.speed * e.timeScale;
      let n = 0;
      while (e.acc >= dt && n < 20000) { e.step(); e.acc -= dt; n++; }
      e.monitor.update();
      return e.acc / dt;
    },
    /** 計った値など(絵と表に使う) */
    observe() { return model.observe(e.y, e.t, e.p, e.state); },
  };
  return e.reset();
}

/** 絵をかかずに、決まった秒数だけ動かす(確かめ・テスト・サーバーで使う) */
export function runHeadless(system, config, seconds, { every } = {}) {
  const e = createEngine(system, config);
  const n = Math.round(seconds / e.dt);
  for (let i = 0; i < n && !e.stopped; i++) {
    e.step();
    if (every && i % every === 0) e.monitor.update();
  }
  e.monitor.update();
  return e;
}
