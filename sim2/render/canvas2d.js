// 2D の絵(Canvas)。3D(three3d.js)と同じ使い方にする:
//   const r = createCanvas2D(canvas); r.frame(() => system.model.draw(r, obs, p, opt));
// 系の draw は、本当の大きさ(m)で書く。r.view で見せる範囲を決めると、画面いっぱいに合わせる。
// 色は名前で指定する(暗い画面用の色。CSS の --s2-* と同じ)。

export const DARK = {
  bg: '#0f1522', ink: '#e8edf7', muted: '#8a97ad', grid: '#3a4760',
  warm: '#ff9f43', accent: '#ff6b6b', accent2: '#4dabf7', good: '#51cf66', bad: '#ff6b6b', purple: '#b197fc', yellow: '#ffd43b',
};

export function createCanvas2D(canvas, { colors = DARK } = {}) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, s = 1, sy = 1, ox = 0, oy = 0, box = { x0: -1, x1: 1, y0: -1, y1: 1 };
  let trail = [];
  const col = (c) => colors[c] ?? c ?? colors.ink;
  const X = (x) => ox + (x - box.x0) * s;
  const Y = (y) => H - oy - (y - box.y0) * sy;

  let maxDpr = 2; // 画質(低:1 / 中:1.5 / 高:2)。端末が重いときは下げる
  const r = {
    ctx, colors,
    setQuality(q) { maxDpr = { low: 1, mid: 1.5, high: 2 }[q] ?? 2; },
    /** 大きさを合わせて、背景をぬる */
    frame(drawFn) {
      const dpr = Math.min(globalThis.devicePixelRatio || 1, maxDpr);
      const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      W = w; H = h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
      drawFn(r);
    },
    /**
     * 見せる範囲(本当の大きさ)。ふつうは たて・横を同じ倍率(実スケール)。
     * exaggerate: true のときは、たてを画面いっぱいまでのばす(誇張表示。レンズの作図など、教科書と同じかき方)
     */
    view(b, pad = 16, { exaggerate = false } = {}) {
      box = b;
      const fx = (W - 2 * pad) / (b.x1 - b.x0), fy = (H - 2 * pad) / (b.y1 - b.y0);
      s = exaggerate ? fx : Math.min(fx, fy);
      sy = exaggerate ? fy : s;
      ox = (W - s * (b.x1 - b.x0)) / 2; oy = (H - sy * (b.y1 - b.y0)) / 2;
    },
    X, Y, S: (len) => len * s, get width() { return W; }, get height() { return H; },
    line(x1, y1, x2, y2, c = 'ink', w = 2, dashed = false) {
      ctx.save(); if (dashed) ctx.setLineDash([6, 5]);
      ctx.strokeStyle = col(c); ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X(x1), Y(y1)); ctx.lineTo(X(x2), Y(y2)); ctx.stroke(); ctx.restore();
    },
    polyline(pts, c = 'ink', w = 2, dashed = false) {
      if (pts.length < 2) return;
      ctx.save(); if (dashed) ctx.setLineDash([6, 5]);
      ctx.strokeStyle = col(c); ctx.lineWidth = w; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
      for (const [x, y] of pts.slice(1)) ctx.lineTo(X(x), Y(y));
      ctx.stroke(); ctx.restore();
    },
    /** 円弧(角度は数学の向き。0 が右、反時計回りが+) */
    arc(cx, cy, rad, a0, a1, c = 'grid', dashed = false) {
      ctx.save(); if (dashed) ctx.setLineDash([6, 5]);
      ctx.strokeStyle = col(c); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X(cx), Y(cy), Math.max(1, rad * s), -a1, -a0); ctx.stroke(); ctx.restore();
    },
    ball(x, y, rad, c = 'warm', label = '') {
      const pr = Math.max(5, rad * s);
      ctx.beginPath(); ctx.arc(X(x), Y(y), pr, 0, Math.PI * 2);
      ctx.fillStyle = col(c); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();
      if (label) r.label(X(x) + pr + 6, Y(y) + 4, label);
    },
    rect(x, y, w, h, c = 'accent2', angle = 0) {
      ctx.save(); ctx.translate(X(x), Y(y)); ctx.rotate(-angle);
      ctx.fillStyle = col(c); ctx.fillRect(-w * s / 2, -h * s, w * s, h * s);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.strokeRect(-w * s / 2, -h * s, w * s, h * s); ctx.restore();
    },
    arrow(x, y, dx, dy, c = 'accent', label = '') {
      const x1 = X(x), y1 = Y(y), x2 = X(x + dx), y2 = Y(y + dy), len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 3) return;
      const a = Math.atan2(y2 - y1, x2 - x1), h = Math.min(10, len * 0.4);
      ctx.strokeStyle = ctx.fillStyle = col(c); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45)); ctx.lineTo(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45)); ctx.fill();
      if (label) r.label(x2 + 6, y2 - 6, label, c);
    },
    /** 画面の点の場所に文字 */
    label(px, py, text, c = 'ink', size = 13, align = 'left') {
      ctx.fillStyle = col(c); ctx.font = `${size}px "BIZ UDPGothic", "Hiragino Sans", sans-serif`; ctx.textAlign = align; ctx.fillText(String(text), px, py); ctx.textAlign = 'left';
    },
    /** 本当の場所に文字 */
    text(x, y, text, c = 'ink', size = 13, align = 'center') { r.label(X(x), Y(y), text, c, size, align); },
    /** 数(Space Mono) */
    number(px, py, text, c = 'ink', size = 14, align = 'left') {
      ctx.fillStyle = col(c); ctx.font = `${size}px "Space Mono", ui-monospace, monospace`; ctx.textAlign = align; ctx.fillText(String(text), px, py); ctx.textAlign = 'left';
    },
    ground(y = 0, x0 = box.x0, x1 = box.x1) {
      ctx.fillStyle = '#1a2335'; ctx.fillRect(X(x0), Y(y), (x1 - x0) * s, H - Y(y));
      r.line(x0, y, x1, y, 'muted', 2);
    },
    /** 軌跡:点をためて、線でかく(古い点はすてる) */
    trail(x, y, c = 'accent2', max = 240) {
      trail.push([x, y]); if (trail.length > max) trail.shift();
      ctx.save(); ctx.globalAlpha = 0.5; r.polyline(trail, c, 1.5); ctx.restore();
    },
    clearTrail() { trail = []; },
  };
  return r;
}
