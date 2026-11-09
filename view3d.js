// 3D の絵に使う、DOM も Three.js も使わない部分(Node でテストできる)。
// 物理の座標 (x, y, z) は右手系で、x–y 面が地面(赤道面)、z が上。
// Three.js の座標は y が上なので、(x, y, z) → (x, z, −y) に直す(回転だけ。向きは変わらない)。
// 系の model.view3d(o, p) が返す形:
//   { extent: 見せる広さ(m), bodies: [{ id, pos:[x,y,z], radius(m), color, trail? }], vectors: [{ from:[x,y,z], dir:[x,y,z], color, label }] }

export const toThree = ([x, y, z]) => [x, z, -y];

/** view3d の形を確かめる(系を足したときの間違いを早く見つける)。まちがいの説明の配列 */
export function checkView3d(v) {
  const e = [];
  if (!v || typeof v !== 'object') return ['view3d が返す値がない'];
  if (!(v.extent > 0) || !Number.isFinite(v.extent)) e.push('extent は正の数');
  const p3 = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  for (const b of v.bodies ?? []) {
    if (!p3(b.pos)) e.push(`bodies.${b.id}.pos は 3つの数(3次元)`);
    if (!(b.radius > 0)) e.push(`bodies.${b.id}.radius は正の数`);
  }
  for (const a of v.vectors ?? []) if (!p3(a.from) || !p3(a.dir)) e.push('vectors の from・dir は 3つの数');
  return e;
}

/** カメラの位置(球座標 → 直交座標)。theta:横の角度、phi:上からの角度(0〜π)、dist:中心からのきょり */
export function cameraPosition(theta, phi, dist) {
  const p = Math.min(Math.max(phi, 0.05), Math.PI - 0.05);
  return [dist * Math.sin(p) * Math.sin(theta), dist * Math.cos(p), dist * Math.sin(p) * Math.cos(theta)];
}

// ---- WebGL なしの簡易3D(render/canvas3d.js)で使う投影の計算 ----
export const SCENE = 10;           // 見せる広さ(extent)を、この大きさに縮めて描く(three3d.js と同じ)
export const FOV = (45 * Math.PI) / 180;

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a) => { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

/**
 * 物理の座標の点を、画面の点にする(透視投影)。three3d.js と同じカメラ(原点を見る・y が上)。
 * @param {number[]} p  物理の座標 [x, y, z](m)
 * @param {{theta:number, phi:number, dist:number}} cam
 * @param {{extent:number, center?:number[], w:number, h:number}} view  w, h:画面の大きさ(px)
 * @returns {{x:number, y:number, depth:number, k:number}|null}  k:(その場所での)1 シーン単位あたりの px。カメラの後ろは null
 */
export function projectPoint(p, cam, { extent, center = [0, 0, 0], w, h }) {
  const s = SCENE / extent;
  const q = toThree(sub3(p, center)).map((c) => c * s); // 中心を原点にして、シーンの大きさに縮める
  const eye = cameraPosition(cam.theta, cam.phi, cam.dist);
  const fwd = unit3(eye.map((c) => -c));
  const right = unit3(cross3(fwd, [0, 1, 0])), up = cross3(right, fwd);
  const d = sub3(q, eye);
  const depth = dot3(d, fwd);
  if (depth <= 0.1) return null;
  const f = 1 / Math.tan(FOV / 2);
  const k = (f * h) / 2 / depth;
  return { x: w / 2 + dot3(d, right) * k, y: h / 2 - dot3(d, up) * k, depth, k };
}
