// 凸レンズの見張り:
// - 光線追跡で求めた像の位置が、レンズの公式 1/a + 1/b = 1/f と合うか(0.1% まで)
// - 3本の光線が、1点で交わるか(光線のずれ)
// - 倍率が b/a と合うか
export const conserved = () => false;

export function checks(p) {
  if (Math.abs(p.a - p.f) < 1e-9) return [];
  const b = (p.a * p.f) / (p.a - p.f);
  return [
    { id: 'imageDistance', label: '像の位置(レンズの公式)', tol: 0.001, measure: (e) => e.observe().b, expected: () => b },
    { id: 'magnification', label: '倍率(b/a)', tol: 0.001, measure: (e) => e.observe().magnification, expected: () => Math.abs(b / p.a) },
    { id: 'raysMeet', label: '3本の光線が1点で交わる(ずれ)', tol: 1e-6, measure: (e) => 1 + (e.observe().image?.spread ?? 1), expected: () => 1 },
  ];
}
