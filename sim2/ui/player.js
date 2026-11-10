// シミュレーションを1つ画面に出す(共通の画面部品)。
//   const sim = mountSimulation(host, config, { onChange });
// - 再生/一時停止・コマ送り・はじめから・速さ
// - config.controls の条件のスライダー(schema から自動で作る)
// - 計った値(Space Mono)、エネルギーの棒グラフ、物理の見張りの警告
// - 小学生(config.curriculum.grade が「小」)は、ふりがなつき・数式なし
import { el } from '../../common.js';
import { createEngine } from '../core/engine.js';
import { isElementary } from '../core/constants.js';
import { rubyNodes } from '../core/ruby.js';
import { getSystem, paramInfo, validateConfig } from '../systems/index.js';
import { createCanvas2D } from '../render/canvas2d.js';
import { createThree3D } from '../render/three3d.js';
import { createCanvas3D } from '../render/canvas3d.js';
import { drawEnergyBars } from '../render/graphs.js';
import { createExperiment } from './experiment.js';
import { studioView } from '../render/studio-views.js';
import { STUDIO } from '../../studio-metrics.js';
const fmt = (v, digits) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : Number(v).toFixed(digits));
const stepDigits = (step) => (String(step).split('.')[1] ?? '').length;

/**
 * @param {HTMLElement} host
 * @param {object} config  確かめ済みの設定
 * @param {{onChange?: (config: object) => void, compact?: boolean}} [opt]
 */
export function mountSimulation(host, config, { onChange, compact = false, theater = false, inquiry } = {}) {
  const errs = validateConfig(config);
  if (errs.length) {
    host.replaceChildren(el('p', { class: 'warn' }, `シミュレーションの設定がおかしいので出せません:${errs.slice(0, 3).join(' / ')}`));
    return null;
  }
  let cfg = JSON.parse(JSON.stringify(config));
  const system = getSystem(cfg.system);
  const { model } = system, profile = STUDIO[cfg.system];
  const elem = isElementary(cfg.curriculum.grade);
  const T = (text) => (elem ? rubyNodes(text) : [text]); // 小学生はふりがな
  const infos = Object.fromEntries(paramInfo(cfg.system).map((p) => [p.key, p]));
  const labelOf = (key) => (elem ? system.schema.params.properties[key]['x-label-e'] : null) ?? infos[key].label;

  let engine = createEngine(system, cfg);
  let playing = false, last = 0, raf = 0, readTimer = 0, lastDraw = '', lastRead = '', destroyed = false;

  let trace = [], lastTraceTime = -1;
  const main = el('canvas', { class: 's2-canvas', 'aria-label': `${system.label}のシミュレーション` });
  // エネルギーのグラフは、エネルギーの単元(または view.graph が 'energy')のときだけ
  const showBars = !!model.energy && (cfg.view?.graph ? cfg.view.graph === 'energy' : /エネルギー/.test(cfg.curriculum.unit));
  const bars = showBars ? el('canvas', { class: 's2-bars', 'aria-label': 'エネルギーの棒グラフ' }) : null;
  const r = createCanvas2D(main);
  // Three.js は3Dに切り替えた時だけ読み込む。WebGLがなければ、簡易の投影表示にする。
  let main3d = el('canvas', { class: 's2-canvas studio-canvas', hidden:true, 'aria-label': `${system.label}の3D表示` });
  let r3 = null, want3d = cfg.render === '3d', loading3d = false;
  const viewBtn = el('button', { type:'button', class:'s2-btn', title:'ドラッグで回転、ホイールで拡大・縮小' });
  const viewModes = cfg.system === 'solar' ? [['overview','全体'],['top','真上'],['earth','地球と月'],['saturn','土星の環'],['comet','彗星']] : [['overview','斜め'],['top','真上']];
  const views = el('select', {class:'studio-view-select', 'aria-label':'3Dの視点',hidden:true},
    ...viewModes.map(([value,name])=>el('option',{value},name)));
  views.onchange=()=>{r3?.setView?.(views.value);lastDraw='';};
  const rawScene = ({solar:'solar',orbit:'solar',projectile:'projectile',domino:'domino'})[cfg.system];
  const original = rawScene ? el('a',{class:'s2-btn studio-original',href:'original-3d.html?scene='+rawScene,target:'_blank',rel:'noopener'},'原版3Dを開く ↗') : null;
  const visualStatus = el('span',{class:'studio-status'},'停止中');
  const showView = () => {
    const on = want3d && !!r3;
    main.hidden = on; main3d.hidden = !on; views.hidden = !on || !r3?.setView;
    lastDraw='';
    viewBtn?.replaceChildren(want3d ? '2D表示' : '3D表示');
  };
  async function ensure3d() {
    if (!want3d || r3 || loading3d || !main3d) return;
    loading3d = true;
    try { r3 = await createThree3D(main3d, { theater }); } catch (err) {
      // WebGL が使えない・Three.js を読めないときは、WebGL なしの簡易3Dにする(それもだめなら 2D)
      console.warn('3D表示(WebGL):', err);
      // 失敗した canvas は WebGL 用になっている(2D の描画に使えない)ので、新しい canvas に取りかえる
      const fresh = main3d.cloneNode(false); main3d.replaceWith(fresh); main3d = fresh;
      try { r3 = createCanvas3D(main3d); note.hidden = false; note.textContent = 'WebGL が使えないので、簡易3D表示にしました(ブラウザの「ハードウェア アクセラレーション」をオンにすると、きれいな3Dになります)'; note.title = String(err?.message ?? err); }
      catch (err2) { want3d = false; warn.hidden = false; warn.textContent = `3D表示を読みこめなかったので、2D表示にしました(${String(err2?.message ?? err2).slice(0, 160)})`; }
    }
    if (destroyed) { r3?.dispose?.(); return; }
    loading3d = false; showView();
  }
  viewBtn?.addEventListener('click', () => { want3d = !want3d; cfg = { ...cfg, render: want3d ? '3d' : '2d' }; showView(); ensure3d(); onChange?.(cfg); });
  const reads = el('div', { class: 's2-reads', 'aria-live': 'polite' });
  const warn = el('p', { class: 's2-warn', hidden: true });
  const note = el('p', { class: 's2-note', hidden: true }); // 知らせ(警告ではない。簡易3Dにしたときなど)
  const formula = el('p', { class: 's2-formula', hidden: elem || !model.formulas });

  const playBtn = el('button', { type: 'button', class: 's2-btn primary' }, '一時停止');
  const setPlaying = (v) => { playing = v; visualStatus.textContent=v?'再生中':engine.stopped?'測定終了':'停止中'; playBtn.replaceChildren(...T(v ? '一時停止' : '再生')); };
  playBtn.addEventListener('click', () => { if(engine.stopped)restart();setPlaying(!playing); });
  const stepBtn = el('button', { type: 'button', class: 's2-btn', 'data-action': 'step', title: '固定刻みを1つ以上進める（モデルによって秒数が異なります）' }, ...T('コマ送り'));
  stepBtn.addEventListener('click', () => { setPlaying(false); const n = Math.max(1, Math.round(Math.min(profile.time/120, engine.timeScale/24) / engine.dt)); for (let i = 0; i < n; i++) engine.step(); engine.monitor.update(); draw(); showReads(); });
  const resetBtn = el('button', { type: 'button', class: 's2-btn' }, 'はじめから');
  resetBtn.addEventListener('click', () => restart());
  const speed = el('select', { class: 's2-speed', 'aria-label': '速さ' },
    ...(model.speedOptions ?? [0.25, 0.5, 1, 2]).map((v) => el('option', { value: v, selected: v === (cfg.speed ?? 1) }, `${v}倍`)));
  speed.addEventListener('change', () => { engine.speed = Number(speed.value); });

  // 条件のスライダー(大きく、タブレットで動かしやすく)
  const ctrls = (cfg.controls ?? []).filter((k) => infos[k]).map((key) => {
    const p = infos[key];
    // 選ぶもの(コースの形など)は、えらぶ欄にする
    if (p.options) {
      const sel = el('select', { 'data-param': key, 'aria-label': labelOf(key) }, ...p.options.map((v) => el('option', { value: v, selected: v === cfg.params[key] }, p.optionLabels?.[v] ?? v)));
      sel.addEventListener('change', () => { cfg = { ...cfg, params: { ...cfg.params, [key]: sel.value } }; restart(); onChange?.(cfg); });
      return el('label', { class: 's2-ctrl' }, el('span', { class: 's2-ctrl-head' }, el('span', {}, ...T(labelOf(key)))), sel);
    }
    const out = el('b', { class: 'num', 'data-param-output': key }, `${fmt(cfg.params[key], stepDigits(p.step))}`);
    const input = el('input', { type: 'range', min: p.min, max: p.max, step: p.step, value: cfg.params[key], 'data-param': key, 'aria-label': labelOf(key) });
    input.addEventListener('input', () => {
      cfg = { ...cfg, params: { ...cfg.params, [key]: Number(input.value) } };
      out.textContent = fmt(cfg.params[key], stepDigits(p.step));
      restart();
      onChange?.(cfg);
    });
    return el('label', { class: 's2-ctrl' }, el('span', { class: 's2-ctrl-head' }, el('span', {}, ...T(labelOf(key))), el('span', {}, out, el('span', { class: 'unit' }, ` ${p.unit}`))), input);
  });

  let audio = null;
  async function tone(samples) {
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();await audio.resume();
      const now=audio.currentTime;
      samples.forEach(({hz,gain,offset})=>{
        const osc=audio.createOscillator(), amp=audio.createGain(), t=now+offset;
        osc.type='sine';osc.frequency.value=hz;amp.gain.setValueAtTime(0,t);
        amp.gain.linearRampToValueAtTime(gain,t+.04);amp.gain.setValueAtTime(gain,t+.55);amp.gain.linearRampToValueAtTime(0,t+.70);
        osc.connect(amp);amp.connect(audio.destination);osc.start(t);osc.stop(t+.72);
        osc.onended=()=>{osc.disconnect();amp.disconnect();};
      });
    } catch {note.hidden=false;note.textContent='音を再生できません。図と数字で比較できます。';}
  }
  const hear = cfg.system==='sound' ? el('button',{type:'button',class:'s2-btn',onclick:()=>tone([{hz:cfg.params.f,gain:cfg.params.A/60*.038,offset:0}])},'今の音を0.8秒聞く') :
    cfg.system==='doppler' ? el('button',{type:'button',class:'s2-btn',onclick:()=>{
      const o=engine.observe();
      if(!o.front||o.front>5000){note.hidden=false;note.textContent='前方の音はこの条件で試聴できません。図と周波数を見てください。';return;}
      tone([{hz:o.front,gain:.033,offset:0},{hz:o.back,gain:.033,offset:.83}]);
      note.hidden=false;note.textContent='最初が前方、次が後方の観測者が聞く高さです。';
    }},'前方と後方の音を聴く') : null;
  const mainReading=el('strong',{class:'studio-main-value'},'—');
  const modelTime=el('span',{class:'studio-clock'},'0 '+profile.unit);
  const focus=el('div',{class:'studio-focus'},
    el('div',{},el('span',{class:'studio-eyebrow'},'注目する値'), el('span',{class:'studio-focus-label'},...T(profile.focus))),
    mainReading, el('div',{class:'studio-time'},modelTime,visualStatus));
  const simPart = el('div', { class: 's2-simpart' },
    focus,
    el('div', {class:'s2-btns studio-playback'}, playBtn,stepBtn,resetBtn,speed,viewBtn,views,hear,original),
    el('div', { class: `s2-stage studio-stage${bars ? '' : ' wide'}` }, main, main3d, bars),
    el('p',{class:'studio-cue'},...T(profile.cue)),
    cfg.system === 'orbit' ? el('p', { class: 'inq-model-note' }, '黄色：進む向き ／ 緑：地球に引かれる向き。矢印の長さと衛星の大きさは表示用です。空気抵抗や他の天体の重力は扱いません。') : null,
    reads, warn, note, formula,
    ctrls.length ? el('div', { class: 's2-ctrls' }, ...ctrls) : null);
  // 実験モード(予想 → 実験 → 結果)
  let exp = null;
  // どのシミュレーションも「予想 → 実験 → 結果」に分ける(view.mode が 'explore' のときだけ、分けずに出す)
  const expControls = (cfg.controls ?? []).filter((k) => infos[k] && !infos[k].options);
  if (cfg.view?.mode !== 'explore' && !compact && expControls.length) {
    const key = profile.key;
    exp = createExperiment({
      system, infos, controls: expControls, labelOf, T, title: system.label,
      params: () => cfg.params,
      measure: () => {
        // 実験ごとの主な観察値を、今のモデル状態から取り出して記録する。
        const rs = model.readouts(engine.observe(), engine.p);
        const x = rs.find((r) => r.key === key) ?? rs.find((r) => r.value !== null && r.text === undefined) ?? rs[0];
        return { label: x.label, unit: x.unit, value: x.value, digits: x.digits };
      },
      inquiry, playButton: playBtn, config: () => cfg, engine: () => engine, trace: () => trace, pause: () => setPlaying(false),
      apply: (c) => { cfg = JSON.parse(JSON.stringify(c)); restart(); onChange?.(cfg); },
      onTab: () => { simPart.hidden = false; },
    });
    simPart.append(exp.recordBox);
  }
  const root = el('div', { class: `s2 studio-player${compact ? ' compact' : ''}${elem ? ' elementary' : ''}` },
    exp?.tabs, exp?.predictPanel, simPart, exp?.resultPanel);
  host.replaceChildren(root);
  exp?.show('予想');
  setPlaying(false);
  showView(); ensure3d();

  function restart() {
    setPlaying(false); trace = []; lastTraceTime = -1;
    lastDraw = ''; lastRead = '';
    for (const input of root.querySelectorAll('[data-param]')) {
      const key = input.dataset.param; input.value = cfg.params[key];
      const out = root.querySelector(`[data-param-output="${key}"]`); if (out) out.textContent = fmt(cfg.params[key], stepDigits(infos[key].step));
    }
    engine = createEngine(system, cfg);
    engine.speed = Number(speed.value);
    r.clearTrail(); r3?.clearTrail();
    showReads();
  }
  function draw() {
    const o = engine.observe();
    if (o.pos && engine.t !== lastTraceTime) { trace.push([engine.t, ...o.pos]); lastTraceTime = engine.t; if (trace.length > 180) trace = trace.filter((_, i) => i % 2 === 0); }
    if (want3d && r3) r3.frame(studioView(engine));
    else r.frame(() => model.draw(r, o, engine.p, { labels: !elem, arrows: true, scale: cfg.view?.scale ?? 'exaggerate' }));
    if (bars) drawEnergyBars(bars, o.energy, model.energy(engine.y0, engine.p).total, { elementary: elem });
  }
  function showReads() {
    const o = engine.observe();
    // jhs: true の値(速さ・高さなど)は中学生だけに出す
    const readings = model.readouts(o, engine.p);
    const f = readings.find(r=>r.key===profile.key);
    mainReading.textContent = f?.text ?? (Number.isFinite(f?.value) ? fmt(f.value,f.digits) + ' ' + (f.unit??'') : '未測定');
    modelTime.textContent = fmt(engine.t,engine.t<.1?3:2)+' '+profile.unit;
    reads.replaceChildren(...readings.filter((x) => !(elem && x.jhs)).map((x) => el('div', { class: 's2-read' },
      el('span', { class: 'k' }, ...T(x.label)),
      x.text !== undefined ? el('span', { class: 'v' }, ...T(x.text)) : el('span', { class: 'v num' }, fmt(x.value, x.digits), el('span', { class: 'unit' }, ` ${x.unit}`)))));
    if (engine.timeScale !== 1) reads.prepend(el('p', { class: 'inq-time-note' }, `モデル内の時間：実時間の${engine.timeScale * engine.speed}倍（計算刻み ${engine.dt}${profile.unit}）`));
    const w = engine.monitor.warnings;
    warn.hidden = !w.length;
    warn.textContent = w.length ? `物理の確かめ:${w.join(' / ')}` : '';
    if (!formula.hidden) formula.textContent = model.formulas(engine.p, o).join('   ');
  }
  let shown = false;
  // 端末の性能を測って、画質を自動で合わせる(はじめの60こまの平均の間かく)
  const perf = { n: 0, sum: 0, quality: 'high' };
  function tune(dt) {
    if (perf.n >= 60 || dt <= 0 || dt > 0.5) return;
    perf.sum += dt; perf.n++;
    if (perf.n === 60) {
      const avg = perf.sum / 60;
      perf.quality = avg > 0.028 ? 'low' : avg > 0.02 ? 'mid' : 'high';
      r.setQuality(perf.quality);
      root.dataset.quality = perf.quality;
    }
  }
  function loop(now) {
    // 画面から外されたら止める(まだ画面に入る前は待つ)
    if (root.isConnected) shown = true;
    else if (shown) { cleanup(); return; }
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (!document.hidden && root.isConnected && simPart.getClientRects().length && !root.closest('details:not([open]), [hidden]')) {
      tune(dt);
      if (playing) { engine.advance(dt); if (engine.stopped) setPlaying(false); }
      const in3d = Boolean(want3d && r3);
      const canvas = in3d ? main3d : main;
      // 停止中も視点や幅が変わったら描く。裏のタブや閉じた教材は描かない。
      const camera = in3d ? Object.values(r3.camera()) : [];
      const frame = [engine.steps, in3d, canvas.clientWidth, canvas.clientHeight, perf.quality, ...camera].join(':');
      const values = [engine.steps, engine.speed, engine.monitor.warnings.join('|')].join(':');
      if (frame !== lastDraw) { draw(); lastDraw = frame; }
      if (values !== lastRead && now - readTimer > (perf.quality === 'low' ? 400 : 150)) { readTimer = now; showReads(); lastRead = values; }
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  function cleanup() {
    if (destroyed) return; destroyed = true; cancelAnimationFrame(raf); exp?.destroy(); r3?.dispose?.(); audio?.close();
  }
  return {
    root,
    getConfig: () => JSON.parse(JSON.stringify(cfg)),
    pause: () => setPlaying(false),
    engine: () => engine,
    quality: () => perf.quality,
    destroy() { cleanup(); root.remove(); },
  };
}
