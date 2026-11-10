// 投射運動の見張り:
// - 空気の抵抗がないので、力学的エネルギーは一定
// - 着地の時間・飛んだきょり・いちばん高いところ・着地の速さが、等加速度運動の式と合うか(0.2% まで)
export const conserved = () => true;
export const energyTol = 1e-3;

const T = (p) => (p.vy0 + Math.sqrt(p.vy0 ** 2 + 2 * p.g * p.h0)) / p.g;
const live = (p) => p.h0 > 0 || p.vy0 > 0;

export function checks(p) {
  if (!live(p)) return []; // 地面から落ちるだけ・動かない
  return [
    { id: 'time', label: '着地した時間', tol: 0.002, measure: (e) => e.state.landed, expected: (q) => T(q) },
    { id: 'range', label: '飛んだきょり', tol: 0.002, measure: (e) => e.state.range, expected: (q) => q.vx0 * T(q) },
    { id: 'maxH', label: 'いちばん高いところ', tol: 0.002, measure: (e) => (e.state.landed === null ? null : e.state.maxH), expected: (q) => q.h0 + (q.vy0 > 0 ? q.vy0 ** 2 / (2 * q.g) : 0) },
    { id: 'speed', label: '着地の速さ', tol: 0.002, measure: (e) => e.state.vEnd, expected: (q) => Math.sqrt(q.vx0 ** 2 + q.vy0 ** 2 + 2 * q.g * q.h0) },
  ];
}
