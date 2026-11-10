// 太陽系の見張り:
// - 万有引力だけなので、全体の力学的エネルギーが保存し、全体の運動量は 0 のまま(重心系)
// - 地球(内わく)・木星(外わく)の公転周期が、ケプラーの第3法則(太陽と2体)と合う。
//   ほかの惑星に引かれて少しずれるので、許すはばは、内わく 0.3%・外わく 1%
import { momentum } from './model.js';

export const conserved = () => true;
export const energyTol = 1e-4;

export function checks(p) {
  const out = [{ id: 'momentum', label: '全体の運動量', tol: 1e-9, measure: (e) => 1 + Math.hypot(...momentum(e.y, p)), expected: () => 1 }];
  const T = p.expected[p.mainIndex];
  if (T !== null) {
    out.push({ id: 'period', label: `${p.planets[p.mainIndex].name}の公転周期`, tol: p.set === 'outer' ? 0.01 : 0.003, measure: (e) => e.state.period[p.mainIndex], expected: () => T });
  }
  return out;
}
