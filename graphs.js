// グラフ:エネルギーの棒グラフ(運動・位置・合計)。合計が一定であることを見せる。
import { DARK } from './canvas2d.js';

/**
 * エネルギーの数を読みやすい単位にする(J・kJ・MJ・GJ・TJ)。いちばん大きい値の大きさで決める
 * @returns {{unit: string, div: number, fmt: (v: number) => string}}
 */
export function energyUnit(maxAbs) {
  const units = [['J', 1], ['kJ', 1e3], ['MJ', 1e6], ['GJ', 1e9], ['TJ', 1e12]];
  let [unit, div] = units[0];
  for (const u of units) if (Math.abs(maxAbs) >= u[1]) [unit, div] = u;
  return { unit, div, fmt: (v) => Number((v / div).toPrecision(4)).toString() };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{K: number, U: number, total: number}} E  いまのエネルギー
 * @param {number} E0  はじめの合計(棒の高さの目安と、点線)
 * @param {{elementary?: boolean}} [opt]  小学生向けは、ことばだけ(数式・単位なし)
 */
export function drawEnergyBars(canvas, E, E0, { elementary = false, colors = DARK } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || canvas.width, H = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
  // マイナスのエネルギー(人工衛星の位置エネルギーなど)は棒にできないので、数でならべる
  const eu = energyUnit(Math.max(Math.abs(E.K), Math.abs(E.U), Math.abs(E.total), Math.abs(E0)));
  if (Math.min(E.K, E.U, E.total) < 0) {
    ctx.font = '13px "BIZ UDPGothic", sans-serif'; ctx.fillStyle = colors.muted; ctx.textAlign = 'center';
    ctx.fillText(elementary ? 'エネルギー' : `エネルギー [${eu.unit}](遠くを0とする)`, W / 2, 20);
    const entries = [['運動', E.K, colors.accent], ['位置', E.U, colors.accent2], ['合計', E.total, colors.good]];
    if (W >= 280 && H < 240) {
      entries.forEach(([l, v, c], i) => { const x = W * (i + 0.5) / 3; ctx.fillStyle = c; ctx.font = '13px "BIZ UDPGothic", sans-serif'; ctx.fillText(l, x, 48); ctx.fillStyle = colors.ink; ctx.font = '15px monospace'; ctx.fillText(`${eu.fmt(v)} ${eu.unit}`, x, 75); });
      ctx.fillStyle = colors.muted; ctx.font = '11px "BIZ UDPGothic", sans-serif'; ctx.fillText('観測時点の値。初期条件からの分類は比較欄で確認', W / 2, Math.min(H - 8, 108));
      ctx.textAlign = 'left'; return;
    }
    entries.forEach(([l, v, c], i) => {
      const y = 60 + i * 56; ctx.fillStyle = c; ctx.font = '14px "BIZ UDPGothic", sans-serif'; ctx.fillText(l, W / 2, y);
      ctx.fillStyle = colors.ink; ctx.font = '16px "Space Mono", monospace'; ctx.fillText(`${eu.fmt(v)} ${eu.unit}`, W / 2, y + 22);
    });
    ctx.fillStyle = colors.muted; ctx.font = '12px "BIZ UDPGothic", sans-serif'; ctx.fillText('合計が変わらなければ保存', W / 2, 60 + 3 * 56);
    ctx.textAlign = 'left'; return;
  }
  const top = 28, bottom = H - 46, max = Math.max(E0, E.total, 1e-12) * 1.15;
  const bars = [
    { label: '運動', sub: 'エネルギー', v: E.K, c: colors.accent },
    { label: '位置', sub: 'エネルギー', v: E.U, c: colors.accent2 },
    { label: '合計', sub: elementary ? '' : '(力学的)', v: E.total, c: colors.good },
  ];
  const bw = Math.min(56, (W - 40) / bars.length - 16), gap = (W - bars.length * bw) / (bars.length + 1);
  ctx.font = '13px "BIZ UDPGothic", sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = colors.muted; ctx.fillText(elementary ? 'エネルギー' : `エネルギー [${eu.unit}]`, W / 2, 16);
  // はじめの合計の線(合計の棒がここから動かなければ、保存している)
  const y0 = bottom - (E0 / max) * (bottom - top);
  ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = colors.good; ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.moveTo(8, y0); ctx.lineTo(W - 8, y0); ctx.stroke(); ctx.restore();
  bars.forEach((b, i) => {
    const x = gap + i * (bw + gap), h = Math.max(0, (b.v / max) * (bottom - top));
    ctx.fillStyle = b.c; ctx.fillRect(x, bottom - h, bw, h);
    ctx.fillStyle = colors.ink; ctx.font = '13px "BIZ UDPGothic", sans-serif';
    ctx.fillText(b.label, x + bw / 2, bottom + 16);
    if (b.sub) { ctx.fillStyle = colors.muted; ctx.font = '11px "BIZ UDPGothic", sans-serif'; ctx.fillText(b.sub, x + bw / 2, bottom + 30); }
    if (!elementary) { ctx.fillStyle = colors.ink; ctx.font = '12px "Space Mono", monospace'; ctx.fillText(eu.fmt(b.v), x + bw / 2, bottom - h - 6); }
  });
  ctx.textAlign = 'left';
}
