// DOCXとHybridSimの実験を、測定・比較・保存に使える共通の物理モデルへ移植。
// 状態はすべて固定刻みで計算し、描画フレームの速さには依存しない。
import { World, Body, Box, Plane, Vec3 } from '../core/rigid-world.js';
const G = 9.80665;
const rad = Math.PI / 180;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const number = (label, unit, minimum, maximum, step, value, aliases = []) => ({
  type: 'number', minimum, maximum, 'x-label': label, 'x-unit': unit,
  'x-step': step, 'x-default': value, 'x-aliases': aliases,
});
const reading = (key, label, value, unit, digits = 2) => ({ key, label, value, unit, digits });

// 浮力：水面を z=0 とする。立方体、静水、鉛直運動、線形抵抗、非弾性の底接触。
const side = 0.10, volume = side ** 3, floor = -0.50, bottomCenter = floor + side / 2;
const buoyancyForces = (z, p) => {
  const fraction = clamp((side / 2 - z) / side, 0, 1);
  return { fraction, up: p.rhoFluid * volume * G * fraction, down: p.mass * G };
};
const buoyancy = {
  solver: 'rk4', dt: 1 / 600, factSeconds: () => 12, experiment: { measure: 'percent' },
  prepare: ({ params }) => ({ ...params, mass: params.rhoObject * volume }),
  init: () => [0.13, 0],
  deriv([z, speed], _t, p) {
    const f = buoyancyForces(z, p);
    const a = (f.up - f.down) / p.mass - p.drag * speed;
    return z <= bottomCenter && speed <= 0 && a < 0 ? [0, 0] : [speed, a];
  },
  after(_prev, y, _t, p) {
    return y[0] < bottomCenter ? { y: [bottomCenter, Math.max(0, y[1])], stop: p.rhoObject >= p.rhoFluid } : null;
  },
  observe([z, speed], t, p) {
    const f = buoyancyForces(z, p);
    return { t, z, speed, percent: f.fraction * 100, up: f.up, down: f.down,
      contact: z <= bottomCenter + 1e-8, normal: z <= bottomCenter + 1e-8 ? Math.max(0, f.down - f.up) : 0 };
  },
  readouts(o) {
    return [reading('percent', '水に入った体積', o.percent, '%', 1), reading('buoyancy', '浮力', o.up, 'N'),
      reading('weight', '重力', o.down, 'N'), reading('normal', '底が押す力', o.normal, 'N'),
      reading('speed', '上下の速さ', o.speed, 'm/s', 3)];
  },
  draw(r, o) {
    r.view({ x0: -0.36, x1: 0.36, y0: -0.56, y1: 0.31 });
    const c = r.ctx;
    c.fillStyle = '#173653'; c.fillRect(r.X(-0.33), r.Y(0), r.S(0.66), r.S(-floor));
    r.line(-0.33, 0, 0.33, 0, 'accent2', 2);
    r.line(-0.33, floor, 0.33, floor, 'muted', 2);
    r.rect(0, o.z - side / 2, side, side, o.contact ? 'muted' : 'warm');
    const scale = 0.15 / Math.max(o.up, o.down, 1e-9);
    r.arrow(-0.075, o.z, 0, o.up * scale, 'good', '浮力');
    r.arrow(0.075, o.z, 0, -o.down * scale, 'bad', '重力');
    if (o.normal > 0) r.arrow(0.15, o.z, 0, o.normal * scale, 'accent2', '底の力');
    r.text(-0.30, 0.035, '水面', 'accent2', 13, 'left');
  },
  formulas: () => ['浮力 F = 液体の密度 × 重力加速度 × 水に入った体積', '浮いて静止したとき、沈んだ体積の割合 = 物体の密度 ÷ 液体の密度。底に着けば底からも力を受ける。'],
};

// ドップラー：静止した媒質と観測者、等速の音源。波面は放射した地点から c で広がる。
const doppler = {
  solver: 'analytic', dt: 1 / 20000, timeScale: 0.01, factSeconds: () => 0.06, experiment: { measure: 'back' },
  prepare: ({ params }) => ({ ...params, v: params.mach * params.c }),
  init: () => [0], exact: (t, p) => [p.v * t],
  after(_prev, _next, t) { return t >= 0.06 ? { stop: true } : null; },
  observe([x], t, p) {
    return { t, x, front: p.mach < 1 ? p.f0 / (1 - p.mach) : null,
      back: p.f0 / (1 + p.mach), wavelength: p.mach < 1 ? (p.c - p.v) / p.f0 : null,
      cone: p.mach > 1 ? Math.asin(1 / p.mach) / rad : null };
  },
  readouts(o) {
    return [reading('front', '前方の周波数', o.front, 'Hz', 1), reading('back', '後方の周波数', o.back, 'Hz', 1),
      reading('wavelength', '前方の波面間隔', o.wavelength, 'm', 3), reading('cone', 'マッハ角', o.cone, '度', 1)];
  },
  draw(r, o, p) {
    const width = p.c * 0.023;
    r.view({ x0: o.x - width * 1.4, x1: o.x + width * 0.85, y0: -width * 0.62, y1: width * 0.62 });
    const k = Math.floor(o.t * p.f0);
    for (let i = Math.max(0, k - 28); i <= k; i++) {
      const emitted = i / p.f0, age = o.t - emitted;
      if (age > 0 && age < 0.028) r.arc(p.v * emitted, 0, p.c * age, 0, 2 * Math.PI, 'accent2');
    }
    if (o.cone != null) {
      const l = width * 0.9, a = o.cone * rad;
      for (const sign of [-1, 1]) r.line(o.x, 0, o.x - l * Math.cos(a), sign * l * Math.sin(a), 'yellow', 2.5, true);
    }
    r.ball(o.x, 0, width * 0.024, 'warm', '音源');
    if (p.v > 0) r.arrow(o.x, width * 0.16, width * 0.26, 0, 'warm');
  },
  formulas: () => ['音源の前方 f = f₀/(1−v/c)、後方 f = f₀/(1+v/c) (音源が音速未満、観測者は静止)', '音速以上では前方の周波数をこの式で表示しない。波面の包絡線を見よう。'],
};

// 二重振り子：質量のない棒と同じ質量のおもり。角度は真下を0とする。
const mass = 0.15;
const positions = ([a, b], p) => {
  const x = p.L1 * Math.sin(a), z = -p.L1 * Math.cos(a);
  return [[x, z], [x + p.L2 * Math.sin(b), z - p.L2 * Math.cos(b)]];
};
const doublependulum = {
  solver: 'rk4', dt: 1 / 1000, factSeconds: () => 8, experiment: { measure: 'angle2' },
  prepare: ({ params }) => params,
  init: p => [p.angle1 * rad, p.angle2 * rad, 0, 0],
  deriv([a, b, wa, wb], _t, p) {
    const d = a - b, c = Math.cos(d), s = Math.sin(d);
    const A = 2 * p.L1 * p.L1, B = p.L1 * p.L2 * c, C = p.L2 * p.L2;
    const U = -p.L1 * p.L2 * s * wb ** 2 - 2 * G * p.L1 * Math.sin(a);
    const V = p.L1 * p.L2 * s * wa ** 2 - G * p.L2 * Math.sin(b), det = A * C - B * B;
    return [wa, wb, (C * U - B * V) / det, (A * V - B * U) / det];
  },
  energy([a, b, wa, wb], p) {
    const K = mass * (p.L1 ** 2 * wa ** 2 + 0.5 * p.L2 ** 2 * wb ** 2 + p.L1 * p.L2 * wa * wb * Math.cos(a - b));
    const U = mass * G * (2 * p.L1 * (1 - Math.cos(a)) + p.L2 * (1 - Math.cos(b)));
    return { K, U, total: K + U };
  },
  observe(y, t, p) {
    const [first, second] = positions(y, p);
    const angle = a => Math.atan2(Math.sin(a), Math.cos(a)) / rad;
    return { t, first, second, angle1: angle(y[0]), angle2: angle(y[1]), energy: doublependulum.energy(y, p) };
  },
  readouts(o) { return [reading('angle1', '上のおもりの角度', o.angle1, '度', 1), reading('angle2', '下のおもりの角度', o.angle2, '度', 1), reading('energy', '力学的エネルギー', o.energy.total, 'J', 4)]; },
  draw(r, o, p) {
    const ext = p.L1 + p.L2 + 0.2;
    r.view({ x0: -ext, x1: ext, y0: -ext, y1: ext });
    r.line(0, 0, ...o.first, 'ink', 3);
    r.line(...o.first, ...o.second, 'ink', 3);
    r.trail(...o.second, 'accent2'); r.ball(0, 0, 0.025, 'muted');
    r.ball(...o.first, 0.05, 'warm'); r.ball(...o.second, 0.05, 'accent2');
  },
  view3d(o, p) {
    const a = [o.first[0], 0, o.first[1]], b = [o.second[0], 0, o.second[1]];
    return { extent: p.L1 + p.L2 + 0.2, bodies: [
      { id: 'hinge', pos: [0, 0, 0], radius: 0.045, color: 0xa4b6ce },
      { id: 'upper', pos: a, radius: 0.075, color: 0xffb362 },
      { id: 'lower', pos: b, radius: 0.075, color: 0x56cfff, trail: true, trailColor: 0x56cfff },
    ], rods: [{ from: [0, 0, 0], to: a }, { from: a, to: b }] };
  },
  formulas: () => ['角度の違いが2つのおもりの加速度に影響する。運動エネルギーと重力による位置エネルギーの和を確かめよう。', '抵抗・棒の質量は省いた平面モデル。長時間の軌跡は初期条件の小さな差や数値誤差にも敏感。'],
};

// 新しい教材は床の上の自由な剛体で計算。以前の記録は支点モデルのまま再現する。
const N = 10, L = 0.22, thickness = 0.018;
function dominoWorld(params) {
  const world = new World();
  const floor = new Body({shape:new Plane(), friction:.9, restitution:params.bounce});
  floor.quaternion.setFromEuler(-Math.PI/2,0,0);
  world.addBody(floor);
  const blocks = Array.from({length:N},(_,i) => {
    const b = new Body({mass:.10, shape:new Box(new Vec3(thickness/2,L/2,.05)),
      position:new Vec3(params.gap*i,L/2+.0004,0), restitution:params.bounce, friction:.68});
    if (i === 0) {
      b.quaternion.setFromEuler(0,0,-.17);
      b.angularVelocity.z = -params.kick;
      b.velocity.x = params.kick * L/2;
    }
    world.addBody(b);
    return b;
  });
  return {...params, world, blocks, indices:new Map(blocks.map((b,i)=>[b,i]))};
}
const domino = {
  solver: 'rk4', dt: 1 / 800, factSeconds: () => 8, experiment: { measure: 'fallen' },
  dtFor: ({params}) => params.dynamics === 'rigid' ? 1/240 : 1/800,
  prepare: ({ params }) => params.dynamics === 'rigid' ? dominoWorld(params) : params,
  init(p) { const y = new Array(2 * N).fill(0); y[N] = p.kick; return y; },
  makeState: () => ({ hits: new Array(N - 1).fill(false), fallen: new Set(), quiet:0, lastHit: null }),
  deriv(y, _t, p) {
    return y.slice(N).concat(y.slice(0, N).map((a, i) => a >= Math.PI / 2 ? 0 : 1.5 * G / L * Math.sin(a) - p.loss * y[N + i]));
  },
  after(prev, y, t, p, st) {
    if (p.world) {
      for (const b of p.blocks) b.angularVelocity.put(b.angularVelocity.a.map(x=>x*Math.exp(-p.loss/240)));
      p.world.step(1/240);
      for (const [a,b] of p.world.contacts) {
        const i = p.indices.get(a), j = p.indices.get(b);
        if (j === i + 1 && !st.hits[i]) { st.hits[i] = true; st.lastHit = t; }
      }
      p.blocks.forEach((b,i) => { if (b.quaternion.rotate([0,1,0])[1] < .57) st.fallen.add(i); });
      const quiet=p.blocks.every(b=>Math.hypot(...b.velocity.a)<.06 && Math.hypot(...b.angularVelocity.a)<.42);
      st.quiet=quiet?st.quiet+1:0;
      return {y:p.blocks.map(b=>Math.atan2(...b.quaternion.rotate([0,1,0]).slice(0,2))).concat(p.blocks.map(b=>-b.angularVelocity.z)),
        stop:t>=8||st.fallen.size===N||st.quiet>=120};
    }
    const critical = p.gap < L ? Math.asin(p.gap / L) : Infinity;
    for (let i = 0; i < N; i++) {
      if (i < N - 1 && !st.hits[i] && prev[i] < critical && y[i] >= critical && y[N + i] > y[N + i + 1]) {
        const impulse = (1 + p.bounce) * (y[N + i] - y[N + i + 1]) / 2;
        y[N + i] -= impulse; y[N + i + 1] += impulse;
        st.hits[i] = true; st.lastHit = t;
      }
      if (y[i] >= Math.PI / 2) { y[i] = Math.PI / 2; y[N + i] = 0; }
    }
    return { y, stop: t >= 12 || y.slice(0, N).every(a => a >= Math.PI / 2) };
  },
  observe(y, t, p, st) {
    const angles = y.slice(0, N);
    return { t, angles, fallen: p.world ? st.fallen.size : angles.filter(a => a >= Math.PI / 2).length,
      ...(p.world ? {rigids:p.blocks.map(b=>({pos:[b.position.x,-b.position.z,b.position.y],
        quaternion:[b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w],forward:b.quaternion.rotate([0,1,0])}))}:{}),
      hitCount: st.hits.filter(Boolean).length, lastHit: st.lastHit };
  },
  readouts(o) { return [reading('fallen', '倒れた板', o.fallen, '枚', 0), reading('hitCount', '伝わった回数', o.hitCount, '回', 0), reading('lastHit', '最後に伝わった時刻', o.lastHit, '秒', 3)]; },
  draw(r, o, p) {
    r.view({ x0: -0.12, x1: (N - 1) * p.gap + L + 0.12, y0: -0.12, y1: 0.38 });
    r.ground();
    if (o.rigids) o.rigids.forEach(({pos,forward},i)=>{
      const a=Math.atan2(forward[0],forward[1]);
      r.rect(pos[0]-L/2*forward[0],pos[2]-L/2*forward[1],thickness,L,i?'accent2':'warm',-a);
    }); else o.angles.forEach((a, i) => r.rect(i * p.gap, 0, thickness, L, i === 0 ? 'warm' : 'accent2', -a));
  },
  view3d(o, p) {
    const span = (N - 1) * p.gap + L;
    return { extent: span * 0.60 + 0.12, center: [span / 2, 0, 0.08], bodies: o.angles.map((a, i) => ({
      id: `plate-${i}`, pos: o.rigids?.[i].pos ?? [i * p.gap + (L / 2) * Math.sin(a), 0, (L / 2) * Math.cos(a) + thickness / 2],
      radius: L / 2, box: [thickness, 0.10, L], ...(o.rigids ? {quaternion:o.rigids[i].quaternion} : {rotationZ:-a}),
      color: i === 0 ? 0xffb65a : i % 2 ? 0x4bcbe7 : 0x5469e4,
    })) };
  },
  formulas: p => p.world ? ['接触点に反発と摩擦を適用。床からの力で板が回転し、すべることもある。', '一度60°近く傾いた板を「倒れた」と数える。'] :
    ['旧記録：板の下に支点を置いた近似モデル。'],
};

function system(name, label, unit, grade, model, params, render, measure, request, validator = {}) {
  const curriculum = { grade, unit }, controls = Object.keys(params);
  const config = { system: name, curriculum, params: Object.fromEntries(controls.map(k => [k, params[k]['x-default']])), render: render[0], controls };
  return { name, label, model, validator, examples: [{ title: label, request, config }], schema: {
    'x-label': label, 'x-measures': measure, 'x-units': [curriculum], render, solvers: [model.solver],
    params: { type: 'object', required: controls, additionalProperties: false, properties: params },
  } };
}

export const HYBRID_SYSTEMS = {
  buoyancy: system('buoyancy', '浮く物体と沈む物体', '浮力', '中1', buoyancy, {
    rhoObject: number('物体の密度', 'kg/m³', 100, 8000, 10, 650, ['物体の密度', '材質']),
    rhoFluid: number('液体の密度', 'kg/m³', 800, 1300, 10, 1000, ['液体の密度', '水の密度']),
    drag: number('運動の減衰', 's⁻¹', 0.5, 8, 0.1, 3, ['抵抗', '減衰']),
  }, ['2d'], '水に入る体積の割合・浮力・重力', '浮力で木や鉄が浮くか沈むかを比べる'),
  doppler: system('doppler', '音源が動くと波面はどう変わる？', '音の伝わり方', '中1', doppler, {
    mach: number('音源の速さ', '音速の倍', 0, 1.5, 0.01, 0.5, ['マッハ数', '音源の速さ']),
    f0: number('音源の周波数', 'Hz', 120, 1000, 10, 440, ['周波数', '音の高さ']),
    c: number('音速', 'm/s', 300, 380, 1, 343, ['音速']),
  }, ['2d'], '前方・後方の周波数、波面間隔、マッハ角', 'ドップラー効果で前方と後方の音の高さを調べる'),
  doublependulum: system('doublependulum', '二重振り子の軌跡', '力学的エネルギー', '中3', doublependulum, {
    angle1: number('上の初期角度', '度', -170, 170, 1, 120, ['上の初期角度']),
    angle2: number('下の初期角度', '度', -170, 170, 1, 100, ['下の初期角度']),
    L1: number('上の棒の長さ', 'm', 0.25, 1.6, 0.01, 0.85, ['上の長さ']),
    L2: number('下の棒の長さ', 'm', 0.25, 1.6, 0.01, 0.75, ['下の長さ']),
  }, ['3d', '2d'], '上下の角度・力学的エネルギー', '二重振り子の初期角度と軌跡の違いを調べる', { conserved: () => true, energyTol: 0.002 }),
  domino: system('domino', '倒れる板の連鎖', '運動の規則性', '中3', domino, {
    gap: number('板の間隔', 'm', 0.045, 0.28, 0.005, 0.075, ['間隔', '板の間隔']),
    kick: number('最初の板の角速度', 'rad/s', 0.2, 5, 0.1, 1.4, ['角速度', '押し出し']),
    bounce: number('反発係数', '', 0, 0.8, 0.05, 0.2, ['反発係数']),
    loss: number('運動の減衰', 's⁻¹', 0.1, 2, 0.1, 0.5, ['減衰', '抵抗']),
    dynamics: {type:'string',enum:['rigid','hinge'],'x-default':'rigid','x-label':'計算モデル','x-options':{rigid:'自由な剛体',hinge:'旧記録の支点モデル'}},
  }, ['3d', '2d'], '倒れた枚数・連鎖が伝わった時刻', 'ドミノの板の間隔を変えて倒れる連鎖を比べる'),
};
HYBRID_SYSTEMS.domino.schema.params.required = HYBRID_SYSTEMS.domino.schema.params.required.filter(k=>k!=='dynamics');
