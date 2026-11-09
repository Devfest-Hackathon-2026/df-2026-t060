// WebGL なしの簡易3D表示。ブラウザの WebGL が使えないとき(GPU の設定・学校の PC など)に、
// 普通の 2D の描画(Canvas)で、3次元の位置を投影して描く。three3d.js と同じ使い方・同じ操作。
//   const r3 = createCanvas3D(canvas);  r3.frame(model.view3d(obs, p));  r3.clearTrail();  r3.camera();  r3.dispose();
// 球は丸(ふちの陰つき)、軌道の残像・赤道面の格子・x/y/z の軸・速度の矢印。手前の物体が奥の物体を隠す(遠い順に描く)。
import { attachOrbitControls } from './orbit-controls.js';
import { projectPoint, SCENE } from './view3d.js';

const TRAIL_MAX = 6000;
const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
const shade = (n, k) => { const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; const f = (c) => Math.round(Math.min(255, Math.max(0, c * k))); return `rgb(${f(r)},${f(g)},${f(b)})`; };

export function createCanvas3D(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas が使えません');
  const cam = { theta: 0.7, phi: 1.1, dist: 26 };
  const detach = attachOrbitControls(canvas, cam);
  const trails = new Map();
  let extent = 0, centerKey = '';
  const clearTrails = () => trails.clear();

  function frame(v) {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 200;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0f1522'; ctx.fillRect(0, 0, w, h);
    const center = v.center ?? [0, 0, 0];
    if (Math.abs(v.extent - extent) > 1e-9 * v.extent || center.join(',') !== centerKey) { extent = v.extent; centerKey = center.join(','); }
    const view = { extent, center, w, h };
    const P = (p) => projectPoint(p, cam, view);
    const line = (a, b, color, width = 1, dash = null) => {
      const A = P(a), B = P(b); if (!A || !B) return;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash ?? []); ctx.stroke(); ctx.setLineDash([]);
    };

    // 赤道面(z = 0 の面)の格子と、x(赤)・y(緑)・z(青)の軸
    const E = extent, n = 10, c0 = [center[0], center[1], 0];
    for (let i = -n; i <= n; i++) {
      const t = (i / n) * E;
      line([c0[0] - E, c0[1] + t, 0], [c0[0] + E, c0[1] + t, 0], '#26314a', 1);
      line([c0[0] + t, c0[1] - E, 0], [c0[0] + t, c0[1] + E, 0], '#26314a', 1);
    }
    line([0, 0, 0], [E * 1.05, 0, 0], '#ff6b6b', 1.5); line([0, 0, 0], [0, E * 1.05, 0], '#69db7c', 1.5); line([0, 0, 0], [0, 0, E * 1.05], '#74a8ff', 1.5);

    // WebGLが使えない端末にも、同じ軌道・波面の投影を出す。
    for(const g of v.guides??[]) {
      ctx.globalAlpha=g.opacity??1;
      for(let j=1;j<g.points.length;j++)line(g.points[j-1],g.points[j],hex(g.color),1.2,g.dash?[4,4]:null);
      ctx.globalAlpha=1;
    }
    for(const cloud of v.clouds??[]) {
      ctx.fillStyle=hex(cloud.color);ctx.globalAlpha=.7;
      for(const q of cloud.points.map(P).filter(Boolean))ctx.fillRect(q.x,q.y,2,2);
      ctx.globalAlpha=1;
    }

    // 軌道の残像(物体ごと)
    for (const b of v.bodies) {
      if (!b.trail && !b.path) continue;
      let tr = b.path;
      if (!tr) {
        tr = trails.get(b.id); if (!tr) trails.set(b.id, tr = []);
        if (!tr.length || b.pos.some((x, i) => x !== tr.at(-1)[i])) tr.push(b.pos.slice()); if (tr.length > TRAIL_MAX) tr.shift();
      }
      ctx.beginPath(); let pen = false;
      for (const p of tr) { const q = P(p); if (!q) { pen = false; continue; } if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; } }
      ctx.strokeStyle = hex(b.trailColor ?? 0xff6b6b); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
    }

    for (const rod of v.rods ?? []) line(rod.from, rod.to, '#d7e8ff', 2.5);
    // 球と板(遠い順に描く。手前の物体が奥を隠す)
    const balls = v.bodies.map((b) => ({ b, q: P(b.pos) })).filter((o) => o.q).sort((a, c) => c.q.depth - a.q.depth);
    for (const { b, q } of balls) {
      if (b.box) {
        const a = b.rotationZ ?? 0, [dx, dy, dz] = b.box.map(x => x / 2), c = Math.cos(a), s = Math.sin(a);
        const corner = (x, y, z) => [b.pos[0] + c*x - s*z, b.pos[1] + y, b.pos[2] + s*x + c*z];
        const ring = y => [corner(-dx,y,-dz),corner(dx,y,-dz),corner(dx,y,dz),corner(-dx,y,dz)];
        const A = ring(-dy), B = ring(dy), color = hex(b.color);
        for (let i = 0; i < 4; i++) { line(A[i], A[(i+1)%4], color, 2); line(B[i], B[(i+1)%4], color, 2); line(A[i], B[i], color, 2); }
        continue;
      }
      const r = Math.max(2, (b.ellipsoid?.[0] ?? b.radius) * (SCENE / extent) * q.k);
      const g = ctx.createRadialGradient(q.x - r * 0.35, q.y - r * 0.35, r * 0.1, q.x, q.y, r);
      g.addColorStop(0, shade(b.color, 1.35)); g.addColorStop(0.7, shade(b.color, 1)); g.addColorStop(1, shade(b.color, 0.55));
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    }

    // 矢印(速度・加速度)
    for (const a of v.vectors ?? []) {
      const len = Math.hypot(...a.dir); if (!(len > 0)) continue;
      const tip = [a.from[0] + a.dir[0], a.from[1] + a.dir[1], a.from[2] + a.dir[2]];
      const A = P(a.from), B = P(tip); if (!A || !B) continue;
      const col = hex(a.color ?? 0xffd43b);
      line(a.from, tip, col, 2.5);
      const ang = Math.atan2(B.y - A.y, B.x - A.x), hd = Math.min(10, Math.hypot(B.x - A.x, B.y - A.y) * 0.4);
      ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.lineTo(B.x - hd * Math.cos(ang - 0.45), B.y - hd * Math.sin(ang - 0.45)); ctx.lineTo(B.x - hd * Math.cos(ang + 0.45), B.y - hd * Math.sin(ang + 0.45)); ctx.fillStyle = col; ctx.fill();
    }
    ctx.fillStyle = '#8a97ad'; ctx.font = '12px "BIZ UDPGothic", sans-serif'; ctx.fillText('簡易3D表示(ドラッグで回転・ホイールで拡大縮小)', 10, h - 10);
  }

  return { clearTrail: clearTrails, camera: () => ({ ...cam }), frame, dispose: detach, simple: true };
}
