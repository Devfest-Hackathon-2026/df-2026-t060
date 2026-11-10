// 直流回路。つなぎ方(ブロック)から回路図(ネットリスト)を作り、
// キルヒホッフの法則による節点解析(修正節点法 MNA)で、各点の電圧と各抵抗の電流を求める。
// 電流の流れは、導線にそって動く粒で見せる(粒の速さは電流に比例)。
// 時間で変わるのは粒の動きだけ(解析解:状態 y = [t])。

export const solver = 'analytic';
export const dt = 1 / 60;

// つなぎ方。節点 0 は電源の −極(基準 0 V)、節点 1 は電源の +極
// 画面の座標:電源が左(x=1)、上の導線 y=5、下の導線 y=1
const LAYOUTS = {
  series2: {
    parts: [['R1', 1, 2], ['R2', 2, 0]],
    draw: { R1: [[3.5, 5], 'h'], R2: [[6.5, 5], 'h'] },
    paths: [{ via: ['R1', 'R2'], pts: [[1, 1], [1, 5], [9, 5], [9, 1], [1, 1]] }],
  },
  series3: {
    parts: [['R1', 1, 2], ['R2', 2, 3], ['R3', 3, 0]],
    draw: { R1: [[3.5, 5], 'h'], R2: [[6.5, 5], 'h'], R3: [[5, 1], 'h'] },
    paths: [{ via: ['R1', 'R2', 'R3'], pts: [[1, 1], [1, 5], [9, 5], [9, 1], [1, 1]] }],
  },
  parallel2: {
    parts: [['R1', 1, 0], ['R2', 1, 0]],
    draw: { R1: [[5, 3], 'v'], R2: [[8.5, 3], 'v'] },
    paths: [
      { via: ['R1'], pts: [[1, 1], [1, 5], [5, 5], [5, 1], [1, 1]] },
      { via: ['R2'], pts: [[1, 1], [1, 5], [8.5, 5], [8.5, 1], [1, 1]] },
    ],
  },
  parallel3: {
    parts: [['R1', 1, 0], ['R2', 1, 0], ['R3', 1, 0]],
    draw: { R1: [[4, 3], 'v'], R2: [[6.5, 3], 'v'], R3: [[9, 3], 'v'] },
    paths: [
      { via: ['R1'], pts: [[1, 1], [1, 5], [4, 5], [4, 1], [1, 1]] },
      { via: ['R2'], pts: [[1, 1], [1, 5], [6.5, 5], [6.5, 1], [1, 1]] },
      { via: ['R3'], pts: [[1, 1], [1, 5], [9, 5], [9, 1], [1, 1]] },
    ],
  },
  mixed: {
    parts: [['R1', 1, 2], ['R2', 2, 0], ['R3', 2, 0]],
    draw: { R1: [[3, 5], 'h'], R2: [[5.8, 3], 'v'], R3: [[8.8, 3], 'v'] },
    paths: [
      { via: ['R1', 'R2'], pts: [[1, 1], [1, 5], [5.8, 5], [5.8, 1], [1, 1]] },
      { via: ['R1', 'R3'], pts: [[1, 1], [1, 5], [8.8, 5], [8.8, 1], [1, 1]] },
    ],
  },
};
export const layoutOf = (name) => LAYOUTS[name];

/** 連立一次方程式 A x = b(ガウスの消去法・部分ピボット) */
function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-15) throw new Error('回路が解けない(つながっていない部分がある)');
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * 節点解析(修正節点法)。未知数:節点 1..N の電圧と、電源を流れる電流
 * @returns {{nodeV: number[], parts: {name, a, b, R, V, I, P}[], Itotal: number}}
 */
export function solveCircuit(p) {
  const L = LAYOUTS[p.layout];
  const parts = L.parts.map(([name, a, b]) => ({ name, a, b, R: p[name] }));
  const N = Math.max(...parts.flatMap((x) => [x.a, x.b])); // 節点の数(0 をのぞく)
  const size = N + 1;
  const A = Array.from({ length: size }, () => Array(size).fill(0));
  const rhs = Array(size).fill(0);
  // 抵抗:コンダクタンス 1/R を、行列に入れる(キルヒホッフの電流の法則)
  for (const r of parts) {
    const g = 1 / r.R;
    for (const [i, j, s] of [[r.a, r.a, 1], [r.b, r.b, 1], [r.a, r.b, -1], [r.b, r.a, -1]]) if (i > 0 && j > 0) A[i - 1][j - 1] += s * g;
  }
  // 電源:節点 1(+)と 0(−)の間に、電圧 V
  A[0][N] += 1; A[N][0] += 1; rhs[N] = p.V;
  const x = solveLinear(A, rhs);
  const nodeV = [0, ...x.slice(0, N)];
  for (const r of parts) { r.V = nodeV[r.a] - nodeV[r.b]; r.I = r.V / r.R; r.P = r.V * r.I; }
  return { nodeV, parts, Itotal: -x[N] };
}

export function prepare(config) {
  const p = { ...config.params, R3: config.params.R3 ?? 30 };
  return { ...p, sol: solveCircuit(p) };
}
export const init = () => [0];
export const exact = (t) => [t];

const pathLength = (pts) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
function pointAt(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d <= seg) { const f = d / seg; return [pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])]; }
    d -= seg;
  }
  return pts[pts.length - 1];
}

export function observe(y, t, p) {
  return { t: y[0], ...p.sol, Rtotal: p.V / p.sol.Itotal };
}

export function draw(r, o, p, opt = {}) {
  const L = LAYOUTS[p.layout];
  r.view({ x0: 0, x1: 10, y0: 0, y1: 6 });
  // 導線
  for (const path of L.paths) r.polyline(path.pts, 'muted', 3);
  // 電源(長い線が +極)
  r.line(0.6, 3.25, 1.4, 3.25, 'ink', 4); r.line(0.8, 2.75, 1.2, 2.75, 'ink', 4);
  r.ctx.fillStyle = '#0f1522'; r.ctx.fillRect(r.X(0.5), r.Y(3.15), r.X(1.5) - r.X(0.5), r.Y(2.85) - r.Y(3.15));
  r.line(0.6, 3.15, 1.4, 3.15, 'ink', 4); r.line(0.8, 2.85, 1.2, 2.85, 'ink', 4);
  r.text(0.35, 3.6, '+', 'accent', 14); r.text(0.35, 2.3, '−', 'accent2', 14);
  r.text(1.9, 3, `${p.V} V`, 'ink', 13, 'left');
  // 電流の粒(電流が大きいほど速く動く。電流の向き:+極 → 抵抗 → −極)
  const Imax = Math.max(...o.parts.map((x) => Math.abs(x.I)), 1e-9);
  for (const path of L.paths) {
    const I = Math.min(...path.via.map((n) => Math.abs(o.parts.find((x) => x.name === n).I)));
    const len = pathLength(path.pts), gap = 0.55, speed = 1.6 * (I / Imax);
    for (let d = (o.t * speed) % gap; d < len; d += gap) { const [x, y] = pointAt(path.pts, d); r.ball(x, y, 0.001, 'yellow'); }
  }
  // 抵抗(熱の出かた=電力が大きいほど明るい色)
  const Pmax = Math.max(...o.parts.map((x) => x.P), 1e-9);
  for (const part of o.parts) {
    const [[cx, cy], dir] = L.draw[part.name];
    const w = dir === 'h' ? 1.4 : 0.55, h = dir === 'h' ? 0.55 : 1.4;
    const hot = Math.round(80 + 175 * (part.P / Pmax));
    r.ctx.fillStyle = `rgb(${hot}, ${Math.round(hot * 0.55)}, 60)`;
    r.ctx.fillRect(r.X(cx - w / 2), r.Y(cy + h / 2), r.S(w), r.S(h));
    r.ctx.strokeStyle = '#e8edf7'; r.ctx.lineWidth = 2; r.ctx.strokeRect(r.X(cx - w / 2), r.Y(cy + h / 2), r.S(w), r.S(h));
    const lx = dir === 'h' ? cx : cx + 0.45, ly = dir === 'h' ? cy + 0.55 : cy + 0.2;
    r.text(lx, ly, `${part.name} ${part.R}Ω`, 'ink', 13, dir === 'h' ? 'center' : 'left');
    if (opt.labels) r.text(lx, ly - (dir === 'h' ? 1.15 : 0.45), `${part.V.toFixed(2)}V ${(part.I * 1000).toFixed(0)}mA`, 'muted', 12, dir === 'h' ? 'center' : 'left');
  }
}

export function formulas(p, o) {
  const s = { series2: 'R = R1 + R2', series3: 'R = R1 + R2 + R3', parallel2: '1/R = 1/R1 + 1/R2', parallel3: '1/R = 1/R1 + 1/R2 + 1/R3', mixed: 'R = R1 + (R2・R3)/(R2 + R3)' }[p.layout];
  return ['V = R I(オームの法則)', `全体の抵抗 ${s} = ${o.Rtotal.toFixed(2)} Ω`];
}

export function readouts(o) {
  return [
    { key: 'Itotal', label: '回路全体の電流', value: o.Itotal * 1000, unit: 'mA', digits: 0 },
    { key: 'Rtotal', label: '全体の抵抗', value: o.Rtotal, unit: 'Ω', digits: 2 },
    ...o.parts.map((x) => ({ key: `I_${x.name}`, label: `${x.name} の電流 / 電圧`, value: null, text: `${(x.I * 1000).toFixed(0)} mA / ${x.V.toFixed(2)} V` })),
  ];
}

/** 実験モード(予想→実験→結果)で記録する値 */
export const experiment = { measure: 'Itotal' };
