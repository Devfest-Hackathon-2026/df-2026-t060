// 人工衛星の見張り:
// - 万有引力だけなので、力学的エネルギーと角運動量が保存する
// - 1周する軌道では、周期が ケプラーの第3法則 T = 2π√(a³/GM) と合う(0.2% まで)
export const conserved = (p, e) => e?.state.crashed == null;
export const energyTol = 1e-3;

export function checks(p) {
  const out = [{ id: 'L', label: '角運動量', tol: 1e-4, measure: (e) => e.state.crashed != null ? null : Math.hypot(e.y[1] * e.y[5] - e.y[2] * e.y[4], e.y[2] * e.y[3] - e.y[0] * e.y[5], e.y[0] * e.y[4] - e.y[1] * e.y[3]), expected: (q) => q.r0 * q.v0 }];
  if (p.period !== null) out.push({ id: 'period', label: '1周の時間', tol: 0.002, measure: (e) => e.state.period, expected: (q) => q.period });
  return out;
}
