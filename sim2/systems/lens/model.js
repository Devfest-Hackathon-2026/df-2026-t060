// 凸レンズの像(うすいレンズ)。光線を1本ずつ追いかけて(光線追跡)、像の場所を求める。
// うすいレンズの規則:高さ y でレンズを通る光線の傾き s は、s' = s − y/f に変わる(近軸近似)。
// 代表的な3本の光線
//   ① 光軸に平行な光 → レンズのあと、反対側の焦点を通る
//   ② レンズの中心を通る光 → まっすぐ進む
//   ③ 手前の焦点を通る光 → レンズのあと、光軸に平行に進む
// 3本(または、のばした線)が交わるところが像。レンズの公式 1/a + 1/b = 1/f は、確かめ(validator)にだけ使う。
// 座標:レンズが x = 0、物体は左(x = −a)。単位は cm。

export const solver = 'analytic';
export const dt = 1 / 60;

export function prepare(config) {
  return { ...config.params };
}
export const init = (p) => [p.a];
export const exact = (t, p) => [p.a];

/** 光線:物体の先 (−a, h) から出て、レンズに高さ y0 で当たる。レンズのあとの傾きを返す */
export function traceRays(p) {
  const { a, f, h } = p;
  const rays = [
    { name: '光軸に平行な光', y0: h, s0: 0 },
    { name: 'レンズの中心を通る光', y0: 0, s0: -h / a },
  ];
  // ③ 手前の焦点 (−f, 0) と物体の先 (−a, h) を通る直線。a = f のときはレンズに当たらないので出さない
  if (Math.abs(a - f) > 1e-9) {
    const s0 = -h / (a - f);
    rays.push({ name: '焦点を通る光', s0, y0: h + s0 * a });
  }
  // うすいレンズの規則で曲げる
  return rays.map((r) => ({ ...r, s1: r.s0 - r.y0 / f }));
}

/** レンズのあとの光線(または、のばした線)どうしが交わるところ = 像 */
export function imageByRays(p) {
  const rays = traceRays(p);
  const [r1, r2] = rays;
  if (Math.abs(r1.s1 - r2.s1) < 1e-12) return null; // 平行:像ができない(a = f)
  // y = y0 + s1 x の2本の交点
  const x = (r2.y0 - r1.y0) / (r1.s1 - r2.s1);
  const y = r1.y0 + r1.s1 * x;
  // 3本目もそこを通るか(光線のずれ)
  const spread = rays[2] ? Math.abs(rays[2].y0 + rays[2].s1 * x - y) : 0;
  return { x, y, spread, real: x > 0 };
}

export function observe(y, t, p) {
  const img = imageByRays(p);
  return {
    t,
    image: img,
    b: img ? img.x : null,
    imageHeight: img ? Math.abs(img.y) : null,
    magnification: img ? Math.abs(img.y / p.h) : null,
    kind: !img ? '像ができない' : img.real ? '実像(上下左右が逆)' : '虚像(同じ向き・大きい)',
  };
}

export function draw(r, o, p, opt = {}) {
  const { a, f, h } = p;
  const right = Math.max(2.2 * f, o.image?.real ? Math.min(o.image.x * 1.15, 4 * f + a) : 2 * f) + 4;
  const left = -Math.max(a, 2 * f, o.image && !o.image.real ? -o.image.x : 0) * 1.15 - 4;
  const H = Math.max(h, Math.min(Math.abs(o.image?.y ?? h), 4 * h)) * 1.4 + 2;
  // たてを誇張する(教科書の作図と同じ。光線はまっすぐのまま)。実スケールにもできる(view.scale)
  r.view({ x0: left, x1: right, y0: -H, y1: H }, 16, { exaggerate: opt.scale !== 'real' });
  r.line(left, 0, right, 0, 'grid', 1);                    // 光軸
  r.line(0, -H * 0.9, 0, H * 0.9, 'accent2', 3);            // レンズ
  r.arrow(0, H * 0.75, 0, H * 0.15, 'accent2'); r.arrow(0, -H * 0.75, 0, -H * 0.15, 'accent2');
  for (const [x, label] of [[-f, 'F'], [f, 'F'], [-2 * f, '2F'], [2 * f, '2F']]) { r.ball(x, 0, 0.001, 'yellow'); r.text(x, -H * 0.12, label, 'muted', 12); }
  r.arrow(-a, 0, 0, h, 'warm', opt.labels ? '物体' : '');   // 物体
  // 3本の光線
  const colors = ['accent', 'good', 'purple'];
  traceRays(p).forEach((ray, i) => {
    r.line(-a, h, 0, ray.y0, colors[i], 2);                       // 物体 → レンズ
    r.line(0, ray.y0, right, ray.y0 + ray.s1 * right, colors[i], 2); // レンズのあと
    if (o.image && !o.image.real) r.line(0, ray.y0, o.image.x, o.image.y, colors[i], 1, true); // 虚像:のばした線
  });
  if (o.image) r.arrow(o.image.x, 0, 0, o.image.y, o.image.real ? 'yellow' : 'muted', opt.labels ? (o.image.real ? '実像' : '虚像') : '');
}

export function formulas(p, o) {
  return ['1/a + 1/b = 1/f(レンズの公式)', o.b !== null ? `b = af/(a − f) = ${o.b.toFixed(1)} cm、倍率 = b/a = ${(Math.abs(o.b) / p.a).toFixed(2)}` : 'a = f のとき、像はできない'];
}

export function readouts(o) {
  return [
    { key: 'kind', label: '像', value: null, text: o.kind, unit: '', digits: 0 },
    { key: 'b', label: '像の位置(レンズから)', value: o.b === null ? null : Math.abs(o.b), unit: 'cm', digits: 1 },
    { key: 'imageHeight', label: '像の大きさ', value: o.imageHeight, unit: 'cm', digits: 1 },
    { key: 'magnification', label: '倍率', value: o.magnification, unit: '倍', digits: 2, jhs: true },
  ];
}

/** 実験モード(予想→実験→結果)で記録する値 */
export const experiment = { measure: 'b' };
