// 単振り子の見張り:
// - 空気の抵抗がないとき、力学的エネルギー(運動+位置)が一定か(ずれ 0.1% まで)
// - 計った1往復の時間が、振れはばが大きいときも正しい式(AGM)と合うか(0.5% まで)
// - 小さい振れはばの公式 2π√(L/g) とのちがい(説明用。振れはばが10度以下なら 0.5% 以内のはず)
import { exactPeriod, smallAnglePeriod } from './model.js';

export const conserved = (p) => p.b === 0;
export const energyTol = 1e-3;

export function checks(p) {
  const list = [];
  if (p.b === 0) {
    list.push({ id: 'period', label: '1往復の時間', tol: 0.005, measure: (e) => e.state.period, expected: exactPeriod });
    if (p.theta0Deg <= 10) list.push({ id: 'smallAngle', label: '1往復の時間(2π√(L/g) とくらべて)', tol: 0.005, measure: (e) => e.state.period, expected: smallAnglePeriod });
  }
  return list;
}
