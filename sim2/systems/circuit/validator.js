// 直流回路の見張り:
// - オームの法則 V = RI が、どの抵抗でも成り立つか
// - 節点で、流れこむ電流と流れ出る電流が等しいか(キルヒホッフの電流の法則)
// - 電源がする仕事 = 抵抗で出る熱の合計(電力のつり合い)
// - 全体の電流が、教科書の合成抵抗の式から求めた値 V / R と合うか
import { solveCircuit } from './model.js';

export const conserved = () => false;

const totalR = (p) => {
  const par = (...rs) => 1 / rs.reduce((s, r) => s + 1 / r, 0);
  return { series2: p.R1 + p.R2, series3: p.R1 + p.R2 + p.R3, parallel2: par(p.R1, p.R2), parallel3: par(p.R1, p.R2, p.R3), mixed: p.R1 + par(p.R2, p.R3) }[p.layout];
};

export function checks(p) {
  return [
    { id: 'ohm', label: 'オームの法則のずれ(最大)', tol: 1e-9, measure: () => 1 + Math.max(...solveCircuit(p).parts.map((x) => Math.abs(x.V - x.R * x.I))), expected: () => 1 },
    {
      id: 'kcl', label: '節点の電流のつり合い(最大のずれ)', tol: 1e-9, expected: () => 1,
      measure: () => {
        const s = solveCircuit(p), sum = new Map();
        for (const x of s.parts) { sum.set(x.a, (sum.get(x.a) ?? 0) - x.I); sum.set(x.b, (sum.get(x.b) ?? 0) + x.I); }
        sum.set(1, sum.get(1) + s.Itotal); sum.set(0, sum.get(0) - s.Itotal); // 電源の電流
        return 1 + Math.max(...[...sum.values()].map(Math.abs));
      },
    },
    { id: 'power', label: '電力のつり合い(電源 = 熱の合計)', tol: 1e-9, measure: () => solveCircuit(p).parts.reduce((s, x) => s + x.P, 0), expected: () => p.V * solveCircuit(p).Itotal },
    { id: 'total', label: '全体の電流(V ÷ 合成抵抗)', tol: 1e-9, measure: () => solveCircuit(p).Itotal, expected: () => p.V / totalR(p) },
  ];
}
