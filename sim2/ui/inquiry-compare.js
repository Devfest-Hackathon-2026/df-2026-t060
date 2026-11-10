import { studioView } from '../render/studio-views.js';
import { STUDIO } from '../../studio-metrics.js';
// 二つの実験を同じ時計で再計算する。時間・空間の尺度を合わせて比べる。
import { el } from '../../common.js';
import { guideTo } from '../../inquiry-flow.js';
import { checkedConfig, changesBetween, captureRun, conditionLabel, conditionValue } from '../../inquiry-data.js';
import { getSystem } from '../systems/index.js';
import { createEngine } from '../core/engine.js';
import { createCanvas2D } from '../render/canvas2d.js';
import { createThree3D } from '../render/three3d.js';
import { createCanvas3D } from '../render/canvas3d.js';

export function createComparison(host, configs, options = {}) {
  options.onStart?.();
  const notebookRoot = host.closest('.s2');
  const cs = configs.map(checkedConfig);
  if (cs.length !== 2 || cs[0].system !== cs[1].system) throw new Error('同じモデルの実験を2件選んでください');
  const changed = changesBetween(...cs), system = getSystem(cs[0].system), orbit = cs[0].system === 'orbit';
  const profile = STUDIO[system.name], timeUnit = profile.unit;
  const standardTime = system.name === 'solar' && cs.some(c => c.params.set === 'outer') ? 16 : profile.time;
  const colors = [0xffa94d, 0x22d3ee];
  let engines = cs.map((c) => createEngine(system, c)), time = 0, running = false, dead = false, raf, last = 0, busy = false;
  let wasConnected = false;
  let trails = initialTrails(), extent = orbit ? engines[0].p.r0 * 2.2 : null, r3 = null;
  let pathsAt = -1, paths = [[], []], paintKey = '', loading3d = false, nearEarth = false;
  function initialTrails() { return orbit ? engines.map(e => [[0, ...e.observe().pos]]) : [[], []]; }
  const view = el('div', { class: 'inq-compare-view' }), clock = el('p', { class: 'inq-clock', role: 'status' });
  const canvases = cs.map(() => el('canvas', { class: 's2-canvas', width: 680, height: 420 }));
  const painters = canvases.map(createCanvas2D), readings = cs.map(() => el('div', { class: 'inq-readings' }));
  let canvas3 = el('canvas', { class: 's2-canvas studio-canvas', hidden: true, 'aria-label': '2つの軌道を同じ空間で比較する3D' });
  const columns = el('div', { class: 'inq-compare-columns' }, ...cs.map((c, i) => el('section', {}, el('b', {}, `${i ? 'B（水色）' : 'A（オレンジ）'}：${changed.map((k) => `${conditionLabel(c,k)}：${conditionValue(c,k)}`).join(' / ') || '同じ条件'}`), canvases[i], readings[i])));
  view.append(columns, canvas3);
  const table = el('table', { class: 'inq-compare-table', 'aria-label': '比較中の条件と測定値' });
  const status = el('p', { role: 'status', class: 'inq-message' });
  const play = el('button', { class: 's2-btn primary', type: 'button' }, '同時に再生');
  play.onclick = () => { running = !running; play.textContent = running ? '一時停止' : '同時に再生'; };
  const reset = el('button', { class: 's2-btn', type: 'button', onclick: () => {
    if (busy) return; running = false; play.textContent = '同時に再生'; time = 0; engines = cs.map((c) => createEngine(system, c)); trails = initialTrails(); pathsAt = -1; painters.forEach((r) => r.clearTrail()); r3?.clearTrail(); extent = orbit ? engines[0].p.r0 * 2.2 : null; status.textContent = ''; draw();
  } }, '2つとも最初から');
  const speed = el('select', { 'aria-label': '比較の再生倍率' }, ...[1, 5, 20].map((x) => el('option', { value: x }, `${x}倍`)));
  const note = el('p', { class: 's2-note' }, '共通の時計で比べます。片方が先に終わった場合は、その実験の最後の状態を表示します。');
  const rangeNote = el('p', { class: 's2-note inq-range-note', hidden: true });
  const zoom = orbit ? el('button', { class: 's2-btn', type: 'button', hidden: true, onclick: () => {
    nearEarth = !nearEarth;
    draw();
  } }, '地球の近くに寄る') : null;
  async function to(target) {
    running = false; play.textContent = '同時に再生'; if (busy) return; busy = true;
    const buttons = root.querySelectorAll('button'); buttons.forEach((b) => b.disabled = true);
    try {
      // 固定刻みで進める。バッチごとに操作をブラウザへ返し、途中のDOMとGPUの更新は間引く。
      status.textContent = '同じ時刻まで2つの実験を計算しています…';
      let painted = performance.now();
      while (time < target && !dead) {
        advanceTo(Math.min(target, time + (orbit ? 43200 : system.name === 'solar' ? .5 : .2)));
        if (performance.now() - painted > 180) { draw(); painted = performance.now(); }
        if (time < target) await new Promise((r) => setTimeout(r, 0));
      }
      if (!dead) {
        draw();
        status.textContent = `${time.toLocaleString('ja-JP')}${timeUnit}まで再計算しました。途中の軌跡も計算値です。`;
      }
    } finally { busy = false; buttons.forEach((b) => b.disabled = false); }
  }
  const longButtons = orbit ? [el('button', { class: 's2-btn', type: 'button', onclick: () => to(Math.max(time, 21600)) }, '6時間まで進める'), el('button', { class: 's2-btn', type: 'button', onclick: () => to(Math.max(time, 864000)) }, '発展：10日まで確かめる')] : [el('button',{class:'s2-btn',type:'button',onclick:()=>to(Math.max(time,standardTime))},'標準の観察時刻へ')];
  const three = orbit ? el('button', { class: 's2-btn', type: 'button', onclick: async () => {
    if (r3) { canvas3.hidden = !canvas3.hidden; columns.hidden = !canvas3.hidden; three.textContent = canvas3.hidden ? '軌道を3Dで重ねる' : '2画面に戻す'; draw(); return; }
    if (loading3d) return;
    loading3d = true;
    try { r3 = await createThree3D(canvas3, { theater: true }); }
    catch {
      const fresh = canvas3.cloneNode(false); canvas3.replaceWith(fresh); canvas3 = fresh;
      try { r3 = createCanvas3D(canvas3); }
      catch { status.textContent = 'この端末では3Dを使えません。2Dの比較は使えます'; }
    } finally { loading3d = false; }
    if (dead) { r3?.dispose?.(); return; }
    if (r3) {
      canvas3.hidden = false; columns.hidden = true; three.textContent = '2画面に戻す';
      status.textContent = r3.simple ? '簡易3D：オレンジがA、水色がBです。ドラッグで回せます。' : 'オレンジがA、水色がBです。ドラッグで回せます。';
      draw();
    }
  } }, '軌道を3Dで重ねる') : null;
  const inference = el('details', { class: 'inq-inference' }, el('summary', {}, '発展：モデルの式から推論する（観測結果とは別）'),
    orbit ? el('p', {}, ...engines.map((e, i) => `${i ? 'B' : 'A'}の初期エネルギー/質量 = ${(e.p.eps / 1e6).toFixed(4)} MJ/kg。${e.p.bound ? '負：理想モデルでは束縛される。' : '非負：理想モデルでは無限遠へ行ける。'} `)) : el('p', {}, '比較する条件を1つにそろえ、同じ測定値で説明しよう。'),
    orbit ? el('p', { class: 's2-note' }, '短い観察だけでは「二度と戻らない」と証明できません。この推論は空気抵抗・他の天体の重力・地球の運動を無視するモデルに限ります。') : null);
  const obs = el('textarea', { rows: 2, maxlength: 600, 'aria-label': '比較して気づいたこと', placeholder: '同じ時刻にどこが同じで、どこが違った？' });
  const save = options.onRecord ? el('button', { class: 's2-btn primary', type: 'button', onclick: () => {
    if (!obs.value.trim()) { guideTo(obs, 'ここに、2つを比べて気づいたことを書こう。'); return; }
    if (!time) { guideTo(play, 'まず「同時に再生」で2つの実験を動かそう。'); return; }
    running = false; play.textContent = '同時に再生';
    try { options.onRecord(engines.map((e, i) => captureRun({ engine: e, config: cs[i], ...options.context, observation: obs.value, trace: trails[i] }))); status.textContent = '2件の再実験を、自分の記録として保存しました'; }
    catch (e) { status.textContent = e.message; }
  } }, '比較した2件を自分の記録に保存') : null;
  const root = el('div', { class: 'inq-comparison' }, el('h4', {}, '同じ時計で比較する'),
    el('p', { class: changed.length === 1 ? 'inq-controlled' : 'inq-message' }, changed.length === 1 ? `変える条件：${conditionLabel(cs[0],changed[0])}だけ。ほかの初期条件をそろえています。` : `条件の違い：${changed.map(k=>conditionLabel(cs[0],k)).join('・') || 'なし'}。原因を調べるには、1条件だけ変えましょう。`),
    clock, el('div', { class: 's2-btns' }, play, reset, speed, ...longButtons, three, zoom), rangeNote, view, table, note, inference, options.onRecord ? el('label', {}, '比較して気づいたこと', obs) : null, save, status);
  host.replaceChildren(root); notebookRoot?.classList.add('inq-is-comparing'); 
  function advanceTo(target) {
    engines.forEach((e, i) => {
      const every = Math.max(1, Math.ceil((target - e.t) / e.dt / 80)); let n = 0;
      while (!e.stopped && e.t + e.dt <= target + 1e-7) {
        e.step(); n++;
        if (n % every === 0 || e.stopped) { const p = e.observe().pos; if (p) { trails[i].push([e.t, ...p]); if (trails[i].length > 360) trails[i] = trails[i].filter((_, j) => j % 2 === 0); } }
      }
      e.monitor.update();
    }); time = target;
  }
  function draw() {
    if (dead) return;
    const os = engines.map((e) => e.observe());
    if (orbit) extent = Math.max(extent, ...os.map((o) => o.r * 1.2));
    if (orbit && time !== pathsAt) {
      paths = trails.map((t, i) => [...t.map(p => p.slice(1)), os[i].pos]);
      pathsAt = time;
    }
    paintKey = viewKey();
    clock.textContent = `共通の時計：${time.toFixed(orbit ? 1 : 3)} ${timeUnit}${orbit ? `（${(time / 3600).toFixed(2)} 時間） · 表示範囲±${(extent / 1e6).toFixed(1)}千km` : ''}`;
    // 各モデルが希望する表示範囲を先に取得し、その和集合を2画面に共通適用する。
    const bounds = [];
    if (!orbit) os.forEach((o, i) => {
      const r = painters[i], view = r.view;
      r.view = (b, ...args) => { bounds.push(b); view(b, ...args); };
      try { r.frame(() => system.model.draw(r, o, engines[i].p, { labels: true, arrows: true })); } finally { r.view = view; }
    });
    const shared = bounds.length ? { x0: Math.min(...bounds.map(b=>b.x0)), x1: Math.max(...bounds.map(b=>b.x1)), y0: Math.min(...bounds.map(b=>b.y0)), y1: Math.max(...bounds.map(b=>b.y1)) } : null;
    if (!columns.hidden) os.forEach((o, i) => {
      const e = engines[i], r = painters[i], view = r.view;
      if (shared) r.view = (_, ...args) => view(shared, ...args);
      try { r.frame(() => system.model.draw(r, o, e.p, { labels: true, arrows: true, viewExtent: extent, ...(orbit ? { path: paths[i], pathColor: i ? '#22d3ee' : '#ffa94d' } : {}) })); } finally { r.view = view; }
      readings[i].replaceChildren(...system.model.readouts(o, e.p).map((r) => el('span', {}, `${r.label}：${r.text ?? (r.value == null ? '未測定' : Number(r.value.toPrecision(5)))} ${r.unit ?? ''}`)), e.stopped ? el('b', {}, `この実験は${e.t.toFixed(3)}${timeUnit}で停止`) : null);
    });
    // 「主に見る惑星」が異なる条件でも、別の惑星の周期を同じ行に混ぜない。
    const measured = engines.map((e, i) => new Map(system.model.readouts(os[i], e.p)
      .map(x => [system.name === 'solar' && x.key === 'Tmain' ? 'T_' + e.p.ids[e.p.mainIndex] : x.key, x])));
    const measures = new Map([...measured[1], ...measured[0]]);
    const keys = new Set([...measured[0].keys(), ...measured[1].keys()]);
    const label = (x) => x ? x.text ?? (x.value == null ? '未測定' : Number(x.value.toPrecision(5)) + ' ' + (x.unit ?? '')) : '対象外';
    table.replaceChildren(el('thead', {}, el('tr', {}, el('th', {}, '条件・測定'), el('th', {}, 'A'), el('th', {}, 'B'))),
      el('tbody', {}, ...Object.keys(cs[0].params).map(k => el('tr', {}, el('th', {}, conditionLabel(cs[0],k)), ...cs.map(c=>el('td', {}, conditionValue(c,k))))),
        ...[...keys].map(k=>el('tr', {}, el('th', {}, measures.get(k).label), ...measured.map(m => el('td', {}, label(m.get(k))))))));
    if (zoom) {
      const nearby = Math.max(engines[0].p.r0 * 2.2, ...engines.filter(e => e.p.bound).map(e => e.state.maxR * 1.2));
      const use3d = Boolean(r3 && !canvas3.hidden);
      zoom.hidden = !use3d || extent < nearby * 1.6;
      const zoomed = !zoom.hidden && nearEarth;
      const visibleExtent = zoomed ? nearby : extent;
      zoom.textContent = zoomed ? '軌道の全体を見る' : '地球の近くに寄る';
      zoom.setAttribute('aria-pressed', String(zoomed));
      rangeNote.hidden = !use3d;
      rangeNote.textContent = `${zoomed ? '地球付近（遠くの軌道は画面の外に出ます）' : '全体'} · 表示範囲±${(visibleExtent / 1e6).toFixed(1)}千km · Aはオレンジ、Bは水色`;
      if (use3d) {
        const v = studioView(engines[0], { viewExtent:visibleExtent });
        const others = engines.map((e, i) => ({ id: `comparison-${i}`, pos: os[i].pos, radius: Math.max(e.p.R * 0.045, visibleExtent * 0.012), color: colors[i], path: paths[i], trailColor: colors[i] }));
        r3.frame({ ...v, extent: visibleExtent, bodies: [v.bodies[0], ...others], vectors: [] });
      }
    }
  }
  function viewKey() {
    const camera = canvas3.hidden ? [] : Object.values(r3?.camera() ?? {});
    return [time, view.clientWidth, view.clientHeight, canvas3.hidden, ...camera].join(':');
  }
  function tick(now) {
    if (dead) return;
    if (root.isConnected) wasConnected = true;
    else if (wasConnected) { dead = true; r3?.dispose?.(); return; }
    const visible = !document.hidden && !root.closest('details:not([open]), [hidden]');
    if (!visible && running) { running = false; play.textContent = '同時に再生'; }
    if (running && !busy && visible) {
      advanceTo(time + Math.min((now - (last || now)) / 1000, 0.1) * engines[0].timeScale * Number(speed.value));
      if (engines.every(e => e.stopped)) { running = false; play.textContent = '同時に再生'; }
    }
    last = now; if (visible && !busy && paintKey !== viewKey()) draw(); raf = requestAnimationFrame(tick);
  }
  draw(); raf = requestAnimationFrame(tick);
  return { root, engines: () => engines, time: () => time, to,
    destroy() { notebookRoot?.classList.remove('inq-is-comparing'); dead = true; cancelAnimationFrame(raf); r3?.dispose?.(); root.remove(); } };
}
