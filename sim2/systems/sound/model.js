// 空気の縦波の説明モデル。粒は左右に振動し、圧力の山が右に進む。
// Aは相対的な音圧振幅の設定。空気変位の振幅はA/kに比例し、圧力は変位の空間微分と逆符号。
// 抵抗・反射・倍音は扱わない。変位は見やすく誇張し、再生を100倍遅くする。
export const solver = 'rk4', dt = 0.0002, timeScale = 0.01;
export const prepare = (c) => ({ ...c.params, c: 343 });
export const init = () => [0];
export const deriv = () => [1];
export const observe = (y, t, p) => ({ t, f: p.f, amplitude: p.A, wavelength: p.c / p.f, period: 1 / p.f });
export function readouts(o) { return [
  { key:'f',label:'1秒にふるえる回数',value:o.f,unit:'Hz',digits:0 },
  { key:'wavelength',label:'山から次の山まで',value:o.wavelength,unit:'m',digits:3 },
  { key:'period',label:'1回のふるえの時間',value:o.period * 1000,unit:'ms',digits:2 }
]; }
export const experiment = { measure: 'wavelength' };
export function draw(r, o, p) {
  const L = 4, w = 2 * Math.PI * p.f, k = w / p.c, amp = p.A / 60 * 0.35 / k;
  r.view({ x0: -0.25, x1: L + 0.25, y0: -0.8, y1: 0.65 });
  for (let j=0;j<4;j++) for(let i=0;i<80;i++) {
    const x=i*L/79, displacement=amp*Math.sin(k*x-w*o.t), mark=i===30&&j===1;
    const ctx=r.ctx;ctx.beginPath();ctx.arc(r.X(x+displacement),r.Y(0.18+(j-1.5)*0.1),mark?4.5:2.1,0,2*Math.PI);ctx.fillStyle=mark?'#ffd43b':'#8ccfee';ctx.fill();
  }
  const base=[],current=[];
  for(let i=0;i<=180;i++) {const x=i*L/180;base.push([x,-0.34+-0.07*Math.cos(2*Math.PI*220/p.c*x-2*Math.PI*220*o.t)]);current.push([x,-0.34-p.A/30*0.07*Math.cos(k*x-w*o.t)]);}
  r.line(0,-0.34,L,-0.34,'grid',1);
  for (const x of [0,1,2,3,4]) r.text(x,-0.58,`${x} m`,'muted',10);
  r.polyline(base,'muted',1.2,true);r.polyline(current,'good',2);
  r.label(12,22,'空気は左右にふるえ、音は右へ伝わります。色の点を追おう。','ink',12);
  r.label(12,r.height-18,'下の線は圧力変化の模式図。灰：220Hz・設定30 / 緑：現在','muted',11);

}
export const formulas = (p) => [`波長 λ = 音の速さ / 振動数 = 343 / ${p.f} m`, '20℃付近の音速343m/sを仮定。純音・一方向の進行波モデル。'];

export const factSeconds = () => 0.1;
