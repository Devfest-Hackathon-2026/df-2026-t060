import { createTransport } from './transport.js';
import { pickSavedClass, authErrorMessage } from './teacher-auth.js';
import { el, showMode, timeText } from './common.js';
import { getApiUrl, setApiUrl } from './config.js';
import { validateApiUrl, apiKind, apiKindLabel, waitUntilReady, waitText, LOCAL_API } from './api-url.js';
import { createSimEditor } from './sim-editor.js';
import { normalizeSim, simLabel } from './sim-catalog.js';
import { LAB_PRESETS, labPreset } from './hybrid-lab.js';
import { simFacts } from './sim-facts.js';
import { renderSim } from './sims.js';

import { lessonImporter } from './lesson-import.js';
import { evidenceCard } from './inquiry-teacher.js';
import { growthView } from './inquiry-growth.js';
import { parseContext, copy, checkedConfig, changesBetween } from './inquiry-data.js';
import { createDraftAutosave } from './auto-save.js';
import { mountHybridWorkbench } from './hybrid-workbench.js';

const LESSON_FIELDS = [['question', 'lQuestion'], ['predict', 'lPredict'], ['check', 'lCheck'], ['result', 'lResult'], ['summary', 'lSummary']];
const LEVEL_ORDER = { 上: 0, 中: 1, undefined: 2, 下: 3 };

const KEY = 'kyozai-teacher';
const GRADE_WORDS = ['', '小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3'];
const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても動く */ } },
};

function renderFacts(box, sim) {
  clearTimeout(box._factsTimer);
  box.hidden = !sim;
  if (!sim) { box.replaceChildren(); return; }
  if (sim.config.system === 'domino') {
    box.replaceChildren(el('p', {}, '倒れた枚数は、実験を再生して条件ごとに確認できます。'));
    return;
  }
  box._factsTimer = setTimeout(() => {
    const f = simFacts(sim);
    box.hidden = !f;
    if (f) box.replaceChildren(el('b', {}, 'モデルの測定値（参考）'), el('p', {}, f.now),
      el('ul', {}, ...f.lines.map(line => el('li', {}, line))));
  }, 160);
}

// ?relay:Bluetooth 教室(先生PCの http://localhost:8787/teacher.html?relay で開く。教室のデータは先生PCの中。ネットがなくてもよい)
const relayMode = new URLSearchParams(location.search).has('relay');
// 先生PCの http://localhost:8787/teacher.html で開いたときは、オンラインのまま、児童が Bluetooth でもつながれるようにする(併用)。
// 公開の画面(https)から開いたときは、オンラインだけ(Bluetooth は、先生PCの中継とつなぐので、localhost からでないと使えない)。
const onLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
// デモモード(?demo)では、併用しない(同じブラウザの中だけで動く確認用なので、Bluetooth の表示も、先生PCへの問い合わせもしない)。?hybrid をつけると、デモでも併用にできる(テスト用)
const urlFlags = new URLSearchParams(location.search);
const t = await createTransport({ role: 'teacher', relay: relayMode, hybrid: onLocalhost && !relayMode && (!urlFlags.has('demo') || urlFlags.has('hybrid')) });
showMode(t);

// ---------- 先生のログイン(Google) ----------
// 先生は Google でログインしてから使う(児童は匿名のまま)。デモモードはログインなし。
let started = false;
async function enter() {
  const st = t.teacherState();
  $('account').hidden = st.kind !== 'google' || !!st.demo;
  if (st.kind !== 'google') { showLogin(st); return; }
  $('login').hidden = true;
  $('accountName').textContent = st.name;
  if (started) return;
  // このブラウザに覚えているクラスは、自分のクラスのときだけ開く(別の先生のクラスは開かない)
  const saved = store.get(KEY, null);
  let mine = null;
  try { mine = await t.listMyClasses(); } catch { /* 一覧が取れないときは、クラスの持ち主で決める */ }
  let isMine = false;
  if (!Array.isArray(mine) && saved?.code) isMine = !!(await t.getClass(saved.code).catch(() => null))?.mine;
  const demoCode = t.mode === 'demo' ? urlFlags.get('code') : null;
  const open = mine?.find?.(c => c.code === demoCode) ?? pickSavedClass(saved, mine, isMine);
  if (open) { started = true; start(open); return; }
  showSetup(mine);
}

function showLogin(st) {
  $('setup').hidden = true;
  $('app').hidden = true;
  $('login').hidden = false;
  // 匿名ログインのまま(前の作りの先生)で、このブラウザにクラスがあるとき
  $('loginLegacy').hidden = !(st.kind === 'legacy' && store.get(KEY, null)?.code);
}

function showSetup(mine) {
  $('setup').hidden = false;
  const list = $('myClasses');
  $('myClassesBox').hidden = !(mine && mine.length);
  list.replaceChildren(...(mine ?? []).map((c) => el('li', {},
    el('span', {}, c.grade ? `${c.name}(${GRADE_WORDS[c.grade]})` : c.name), ' ',
    el('span', { class: 'small' }, `コード ${c.code}`), ' ',
    el('button', { type: 'button', class: 'ghost small', onclick: () => { const cls = { code: c.code, name: c.name, grade: c.grade }; store.set(KEY, cls); $('setup').hidden = true; started = true; start(cls); } }, 'このクラスを開く'))));
}

$('googleLogin').addEventListener('click', async () => {
  const btn = $('googleLogin'), msg = $('loginMsg');
  btn.disabled = true; msg.textContent = '';
  try {
    const r = await t.teacherLogin();
    if (r.switched) msg.textContent = 'この Google アカウントは、すでに別のログインで使われていたので、そちらのアカウントでログインしました。前に(ログインなしで)作ったクラスは、このアカウントでは開けません。';
    await enter();
  } catch (err) {
    msg.textContent = err.message || authErrorMessage(err);
  } finally {
    btn.disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  await t.teacherLogout();
  location.reload();
});


$('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('className').value.trim();
  const grade = Number($('grade').value);
  try {
    const code = await t.createClass(name, grade);
    const cls = { code, name, grade };
    store.set(KEY, cls);
    $('setup').hidden = true;
    started = true;
    start(cls);
  } catch (err) {
    $('setupMsg').textContent = 'クラスを作れませんでした：' + err.message;
  }
});

$('resetClass').addEventListener('click', () => {
  if (!confirm('このブラウザでのクラス設定を外します。よろしいですか？')) return;
  localStorage.removeItem(KEY);
  location.reload();
});

// ---------- 先生の側のAIサーバー ----------

// AIサーバーの /ready(AI まで使えるか)。ok: true なら、すぐ使える
async function readyOnce(api, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(api + '/ready', { signal: ctrl.signal });
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok && j.ok === true, model: j.model, where: j.where, reason: j.reason ?? (res.ok ? '' : `AIサーバーが ${res.status} を返しました`) };
  } finally {
    clearTimeout(timer);
  }
}

// Cloud Run は使っていないときは止まっていて、最初の呼び出しで起動する(AIのモデルを読みこむので数分かかる)。準備ができるまで待つ
function waitForAI(api, notify) {
  return waitUntilReady({
    check: () => readyOnce(api, 8000),
    onWait: ({ elapsedMs, reason }) => notify?.(`AIを起こしています(${waitText(elapsedMs)}。最初は数分かかります)${reason ? ':' + reason : ''}`),
    maxMs: 6 * 60 * 1000,
  });
}

let openModelBox = () => {}; // setupModelBox が差しかえる
// AIサーバーの場所:Bluetooth 教室は、この画面を配っている先生PCのサーバー(ログインなしで使える)。ふつうは、選んだ場所
const currentApi = () => (t.mode === 'relay' ? location.origin : getApiUrl());

async function callAI(path, body) {
  const token = await t.getIdToken();
  if (!token && t.mode !== 'relay') throw new Error('AIはオンライン(Firebase)のときだけ使えます');
  const api = currentApi();
  const send = () => fetch(api + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let res;
  try {
    res = await send();
    // Cloud Run が起動中(503)のときは、準備ができるまで待って、もう一度だけ送る
    if (res.status === 503 && apiKind(api) === 'cloud') throw new Error('starting');
  } catch (e) {
    if (apiKind(api) === 'cloud') {
      const r = await waitForAI(api, (msg) => setPill(msg, 'wait'));
      if (!r.ok) { await checkAI(); throw new Error(`Cloud Run のAIが、6分待っても使えるようになりません(${r.reason || '起動中'})。しばらくしてから、もう一度ためしてください`); }
      await checkAI();
      try { res = await send(); } catch { throw new Error('Cloud Run のAIにつながりません。ネットワークを確かめてください'); }
    } else {
      throw new Error(location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? 'AIサーバーにつながりません。先生PCで server の npm start を実行してください'
        : 'AIサーバーにつながりません。先生PCでは http://localhost:8787/teacher.html を開いてください(またはブラウザで「ローカル ネットワーク アクセス」を許可してください)。Cloud Run を使うなら、上の「AI」の表示から、つなぎ先を選んでください');
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `AIサーバーのエラー(${res.status})`);
  return data;
}

function setPill(text, cls, title = '') {
  const pill = $('aiStatus');
  pill.textContent = text;
  pill.className = `pill ${cls} clickable`;
  pill.title = title || 'クリックで、AIのつなぎ先を選べます';
}

let warming = false;
async function checkAI() {
  if (t.mode === 'demo') { const p = $('aiStatus'); p.textContent = 'AI:オンラインのときだけ'; p.className = 'pill off'; return; }
  const api = currentApi(), kind = apiKindLabel(api);
  try {
    const r = await readyOnce(api, apiKind(api) === 'cloud' ? 8000 : 3000);
    if (r.ok) { setPill(`AI:${r.model}(${kind})`, 'on', `つなぎ先:${api}`); return; }
    if (apiKind(api) === 'local' && /モデル.*まだありません/.test(r.reason ?? '')) setPill('AI:モデルがありません(ここを押してダウンロード)', 'wait', r.reason);
    else setPill(`AI:準備中(${kind})`, 'wait', r.reason);
    if (apiKind(api) === 'cloud') warmUp(api);
  } catch {
    if (apiKind(api) === 'cloud') {
      setPill(`AI:起こしています(Cloud Run)`, 'wait', 'Cloud Run のAIは、使っていないときは止まっています。最初は数分かかります');
      warmUp(api);
    } else {
      setPill('AI:つながっていません', 'off', '先生PCで server の npm start を実行してください。Cloud Run を使うなら、ここをクリックしてつなぎ先を選べます');
    }
  }
}

// Cloud Run を起こす(教材をつくる前に、先に起こしておく)。1回だけ動かす
async function warmUp(api) {
  if (warming) return;
  warming = true;
  try {
    const r = await waitForAI(api, (msg) => setPill(msg.replace('AIを起こしています', 'AI:起こしています'), 'wait'));
    if (api !== currentApi()) return; // 待っているあいだに、つなぎ先が変わった
    if (r.ok) await checkAI(); else setPill('AI:つながっていません(Cloud Run)', 'off', r.reason);
  } finally {
    warming = false;
  }
}

// ---------- AIのつなぎ先を選ぶ(先生PC / Cloud Run) ----------
function openAiPanel() {
  if (t.mode === 'relay') return; // Bluetooth 教室は、先生PCのAIだけ
  const api = getApiUrl();
  $('aiPanel').hidden = false;
  $('apiLocal').checked = apiKind(api) === 'local';
  $('apiCloud').checked = apiKind(api) === 'cloud';
  $('apiUrl').value = apiKind(api) === 'cloud' ? api : '';
  $('apiUrl').disabled = !$('apiCloud').checked;
  $('apiMsg').textContent = '';
  openModelBox();
}
$('aiStatus').addEventListener('click', () => { if ($('aiPanel').hidden) openAiPanel(); else $('aiPanel').hidden = true; });
$('aiPanelClose').addEventListener('click', () => { $('aiPanel').hidden = true; });
for (const id of ['apiLocal', 'apiCloud']) $(id).addEventListener('change', () => { $('apiUrl').disabled = !$('apiCloud').checked; });
const chosenApi = () => ($('apiCloud').checked ? validateApiUrl($('apiUrl').value) : LOCAL_API);

$('apiTest').addEventListener('click', async () => {
  const api = chosenApi();
  if (!api) { $('apiMsg').textContent = 'アドレスは https://〜.run.app の形で入れてください(Cloud Run のサービスの URL)。'; return; }
  $('apiMsg').textContent = 'つないでいます…';
  try {
    const r = await readyOnce(api, 10000);
    $('apiMsg').textContent = r.ok
      ? `つながりました:${apiKindLabel(api)} / モデル ${r.model}`
      : `サーバーは動いていますが、AIの準備がまだです:${r.reason}(Cloud Run は、最初は数分かかります。「使う」を押して待つこともできます)`;
  } catch {
    $('apiMsg').textContent = apiKind(api) === 'cloud'
      ? 'つながりません。Cloud Run が止まっているか(起こすのに数分かかります)、アドレスがちがうかもしれません。'
      : 'つながりません。先生PCで server の npm start を実行してください。';
  }
});

$('apiSave').addEventListener('click', async () => {
  const api = chosenApi();
  if (!api) { $('apiMsg').textContent = 'アドレスは https://〜.run.app の形で入れてください。'; return; }
  if (!setApiUrl(apiKind(api) === 'local' ? null : api)) { $('apiMsg').textContent = '保存できませんでした。'; return; }
  $('apiMsg').textContent = `${apiKindLabel(api)}を使います(このブラウザに覚えました)`;
  $('aiPanel').hidden = true;
  await checkAI();
});

// ---------- AIのモデルのダウンロード(先生PCのときだけ) ----------
// 12B がダウンロードずみなら何もしない。なければ 12B をダウンロードし、できなければ E4B(サーバーが順に試す)
const fmtGB = (n) => `${(n / 1e9).toFixed(1)} GB`;
function setupModelBox(code) {
  const box = $('modelBox');
  if (!box || t.mode === 'demo') return;
  let timer = null;
  const get = async () => (await fetch(`${currentApi()}/api/models`)).json();
  const draw = (st) => {
    const p = st.progress ?? {}, inst = st.installed ?? {};
    const have12 = inst['gemma4:12b'], haveE4 = inst['gemma4:e4b'];
    let text, busy = p.phase === 'pulling';
    if (!st.ollama) text = st.reason || 'Ollama につながりません。';
    else if (busy) text = `${p.model ?? ''} をダウンロード中:${p.status ?? ''}${p.total ? `(${fmtGB(p.completed)} / ${fmtGB(p.total)})` : ''}`;
    else if (p.phase === 'error') text = `ダウンロードできませんでした:${p.message}`;
    else if (p.phase === 'done' && p.message) text = `${p.message}(使っているモデル:${st.active})`;
    else if (have12) text = `Gemma 4 12B はダウンロードずみです(使っているモデル:${st.active})。`;
    else if (haveE4) text = `Gemma 4 E4B がダウンロードずみで、これを使っています。12B は、まだです。`;
    else text = 'AIのモデルがまだありません。下のボタンでダウンロードします(数 GB。時間がかかります)。';
    $('modelState').textContent = text;
    $('modelBar').hidden = !(busy && p.total);
    if (busy && p.total) $('modelBar').value = Math.round((p.completed / p.total) * 100);
    const btn = $('modelGet');
    btn.disabled = busy || !st.ollama;
    btn.hidden = !!have12 && st.active === 'gemma4:12b' && p.phase !== 'error';
    btn.textContent = busy ? 'ダウンロード中…' : (haveE4 && !have12 ? 'Gemma 4 12B をダウンロード(だめなら E4B のまま)' : 'Gemma 4 12B をダウンロード');
    return busy;
  };
  const poll = async () => {
    clearTimeout(timer);
    try {
      const st = await get();
      if (draw(st)) timer = setTimeout(poll, 1000);
      else if (st.progress?.phase === 'done') checkAI();
    } catch { $('modelState').textContent = 'AIサーバーにつながりません。'; }
  };
  $('modelGet').addEventListener('click', async () => {
    $('modelGet').disabled = true;
    try {
      const token = await t.getIdToken();
      const res = await fetch(`${currentApi()}/api/models/ensure`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ code }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { $('modelState').textContent = data.error || `始められませんでした(${res.status})`; $('modelGet').disabled = false; return; }
      poll();
    } catch { $('modelState').textContent = 'AIサーバーにつながりません。'; $('modelGet').disabled = false; }
  });
  // 開く(パネルを開いたとき)と、モデルがないとき に状態を見る
  openModelBox = () => {
    const local = apiKind(getApiUrl()) === 'local' || t.mode === 'relay';
    box.hidden = !local;
    if (local) poll();
  };
  openModelBox();
}
// 関係の強さの札(function にして、start() より先に使えるようにする)
function levelBadge(lv) {
  return lv ? el('span', { class: `level lv-${{ 上: 'hi', 中: 'mid', 下: 'lo' }[lv]}`, title: '今日の授業との関係の強さ' }, lv) : null;
}

function start({ code, name, grade }) {
  $('app').hidden = false;
  $('classTitle').textContent = grade ? `${name}(${GRADE_WORDS[grade]})` : name;
  $('code').textContent = code;
  // オンライン教室は公開URL。ローカル教室では今の版の画面へ案内する。
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const url = new URL('student.html', isLocal && t.mode === 'firebase' ? 'https://kyoiku-hakkason.web.app/' : location.href);
  url.searchParams.set('code', code);
  if (t.mode === 'demo') url.searchParams.set('demo', '');
  // 併用(オンライン + Bluetooth):児童は同じリンクを開く。ネットがつながらない児童は、画面の「Bluetooth でつなぐ」を使う
  if (t.bluetooth) {
    const bs = $('bleStatus'); bs.hidden = false;
    let count = 0, note = '';
    const show = () => {
      bs.textContent = t.bluetooth.available
        ? `ᛒ Bluetooth ●使えます:つながっている児童の端末 ${count} 台。児童は、クラスに入ったあと、画面の「Bluetooth」欄でつなぎます${note ? `(${note})` : ''}`
        : 'オンラインだけで使っています。Bluetooth は使えません(先生PCの中継アプリ・サーバーが動いていないか、このサーバーが Bluetooth 教室に対応していません)';
      bs.className = `blestrip ${t.bluetooth.available ? '' : 'warn'}`;
    };
    t.bluetooth.onChange(show);
    t.bluetooth.onNotice((m) => { note = m; show(); });
    t.bluetooth.watchStudents(code, ({ count: n }) => { count = n; show(); });
    show();
    // 使えないあいだは、15秒ごとに、もう一度確かめる(授業の途中で、先生PCの中継を起動したときのため)。使えるようになったら、自動でつながる
    setInterval(() => { if (!t.bluetooth.available) t.bluetooth.recheck(); }, 15000);
  } else if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && t.mode === 'firebase') {
    // 公開の画面から開いている:Bluetooth の児童は受けつけられない
    const bs = $('bleStatus'); bs.hidden = false; bs.className = 'blestrip warn';
    bs.textContent = 'Bluetooth の児童も受けつけるには、先生PCで http://localhost:8787/teacher.html を開いてください(オンラインのまま、Bluetooth も使えます)';
  }
  if (t.mode === 'relay') {
    url.searchParams.set('ble', '');
    $('studentUrlNote').hidden = false;
    $('studentUrlNote').textContent = '上のリンクはこのPCで画面を確認するためのものです。別の端末では同じ版の児童ページを開き、Bluetoothを選んで、このクラスコードで入ります。';
    const bs = $('bleStatus'); bs.hidden = false; bs.className = 'blestrip'; bs.textContent = 'Bluetooth:つながっている児童の端末 0 台';
    t.watchStudents(code, ({ count }) => { bs.textContent = `Bluetooth:つながっている児童の端末 ${count} 台`; });
  }
  $('studentUrl').href = url.href;
  $('studentUrl').textContent = url.href;

  setupModelBox(code);
  let draftSave = null;
  const editor = createSimEditor($('simEditor'), $('simPreview'), (sim) => {
    renderFacts($('simFacts'), sim);
    draftSave?.schedule();
  }, {grade: GRADE_WORDS[grade]});

  // 今日の授業(このブラウザに覚えておく)
  const LESSON_KEY = `kyozai-lesson:${code}`;
  $('lessonTopic').value = store.get(LESSON_KEY, '');
  $('lessonTopic').addEventListener('input', () => store.set(LESSON_KEY, $('lessonTopic').value));
  const lessonTopic = () => $('lessonTopic').value.trim();

  // 質問のチェック。外したものだけ覚えておく(新しい質問は最初からチェックが入る)
  const unchecked = new Set();
  let latestQuestions = [];
  // いま入力欄に入っている案が、どの質問から作られたか(配信したら対応済みにする)
  let draftFrom = [], draftInquiry = null, latestMaterials = [], draftSource = null;
  $('sampleForm').after(lessonImporter((out, meta) => { fillDraft(out, []); draftSource = meta; draftSave?.schedule(); }));

  t.watchQuestions(code, (qs) => { latestQuestions = qs; renderQuestions(qs); });
  t.watchMaterials(code, (ms) => { latestMaterials = ms; renderMaterials(ms); });
  checkAI();

  // ---------- 教材を配信 ----------
  $('matForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const choices = [f.c1.value, f.c2.value, f.c3.value].map((s) => s.trim());
    const hasQuiz = f.q.value.trim() && choices.every(Boolean);
    const lesson = Object.fromEntries(LESSON_FIELDS.map(([k, n]) => [k, f[n].value.trim()]));
    const material = {
      title: f.title.value.trim(),
      explanation: f.explanation.value.trim(),
      sim: editor.get(),
      ...(draftSource ? { source: draftSource.source } : {}),
      quiz: hasQuiz ? [{ q: f.q.value.trim(), choices, answer: Number(f.answer.value) }] : [],
      lesson: Object.values(lesson).some(Boolean) ? lesson : null,
      ...(draftInquiry ? { inquiry: { ...draftInquiry, revision: Math.max(0, ...latestMaterials.filter((m) => (m.inquiry?.rootId ?? m.id) === draftInquiry.rootId).map((m) => m.inquiry?.revision ?? 1)) + 1 } } : {}),
    };
    const button = e.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (material.inquiry?.comparison) {
        const plan = material.inquiry.comparison;
        if (material.sim?.type !== 'cfg' || material.sim.config.system !== plan.configs[0].system) throw new Error('比較案と教材のモデルを同じにしてください');
        plan.configs = plan.configs.map((c, i) => checkedConfig({ ...material.sim.config, params: { ...material.sim.config.params, [plan.target]: i ? c.params[plan.target] : material.sim.config.params[plan.target] } }));
        if (changesBetween(...plan.configs).length !== 1) throw new Error('比較の2条件が同じになっています。Aの値を確認してください');
      }
      await t.publishMaterial(code, material);
      for (const id of draftFrom) await t.setQuestionStatus(code, id, 'done').catch(() => {});
      const n = draftFrom.length;
      draftFrom = []; draftInquiry = null; draftSource = null;
      e.target.reset();
      editor.set(null);
      $('draftInfo').hidden = true;
      draftSave?.flush(true);
      $('matMsg').textContent = `「${material.title}」を配信しました` + (n ? `(もとの質問${n}件を対応済みにしました)` : '');
    } catch (err) {
      $('matMsg').textContent = '配信できませんでした：' + err.message;
    } finally {
      button.disabled = false;
    }
  });

  // ---------- ① 関係の強さで分けて、まとめる ----------
  $('aiGroup').addEventListener('click', async () => {
    const picked = latestQuestions.filter((q) => q.status !== 'done' && !unchecked.has(q.id));
    if (!picked.length) { $('aiMsg').textContent = 'まとめる質問にチェックを入れてください'; return; }
    $('aiGroup').disabled = true;
    $('aiMsg').textContent = `AIが${picked.length}件の質問を分けて、まとめています…(1分ほど)`;
    try {
      const out = await callAI('/api/group', { code, lesson: lessonTopic(), questions: picked.map((q) => ({ id: q.id, text: q.text })) });
      // 関係の強さを質問に書いておく(画面を開き直しても残る)
      await Promise.all(Object.entries(out.relevance).map(([id, lv]) => t.updateQuestion(code, id, { relevance: lv }).catch(() => {})));
      const byId = Object.fromEntries(picked.map((q) => [q.id, q]));
      const low = picked.filter((q) => out.relevance[q.id] === '下');
      renderGroups(out.groups.map((g) => ({ ...g, questions: g.questionIds.map((id) => byId[id]).filter(Boolean) })), out.warnings, low);
      $('aiMsg').textContent = `上・中を${out.groups.length}つにまとめました。下は${low.length}件(${out.stats.sec}秒)`;
    } catch (err) {
      $('aiMsg').textContent = err.message;
    } finally {
      $('aiGroup').disabled = false;
    }
  });

  // AIに、質問への答えと教材の案を作らせる(シミュレーションの設定 → 結果を計る → 答えと授業の流れ)
  async function makeDraft(rephrased, g, btn, msg) {
    btn.disabled = true;
    msg.textContent = 'AIが答えと教材の案を作っています…(1分ほど。シミュレーションを新しく作るときは3分ほど)';
    try {
      const out = await callAI('/api/draft', { code, lesson: lessonTopic(), rephrased, questions: g.questions.map((q) => q.text) });
      fillDraft(out, g.questions);
      msg.textContent = `右の入力欄に入れました(${out.stats.sec}秒)`;
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  function renderGroups(groups, warnings, low) {
    // replaceChildren は null を「null」という文字にしてしまうので、出さないものは外してからわたす
    $('groups').replaceChildren(...[
      ...warnings.map((w) => el('p', { class: 'warn' }, w)),
      ...groups.map((g) => {
        const input = el('input', { value: g.rephrased, maxlength: 120 });
        const msg = el('span', { class: 'small' });
        const many = g.questions.length > 1;
        const btn = el('button', { type: 'button', class: 'ai block' }, 'この問いで、答えと教材の案をつくる');
        btn.addEventListener('click', () => makeDraft(input.value.trim(), g, btn, msg));
        return el('div', { class: `group${g.level === '上' ? ' lv-group-hi' : ''}` },
          el('div', { class: 'glabel' }, levelBadge(g.level), g.label,
            el('span', { class: 'gcount' }, many ? `${g.questions.length}人が同じことを聞いています` : '1件')),
          el('ul', { class: 'gq' }, ...g.questions.map((q) => {
            const one = el('button', { type: 'button', class: 'ghost tiny', title: 'この質問だけで、答えと教材の案をつくる' }, 'これだけで案');
            one.addEventListener('click', () => makeDraft(q.text, { ...g, questions: [q] }, one, msg));
            const rep = el('button', { type: 'button', class: 'ghost tiny', title: 'この児童だけに答えを返す' }, '個別に答える');
            rep.addEventListener('click', () => openReply(q));
            return el('li', {}, el('span', { class: 'seat' }, `${q.seat}番`), el('span', { class: 'gtext' }, q.text), many ? one : null, rep);
          })),
          el('label', {}, '取り上げる問い(直せます)', input),
          el('div', { class: 'gactions' }, btn,
            el('span', { class: 'small' }, 'シミュレーションで確かめた結果に合わせて、答え・授業の流れ・確認問題を作り、右の入力欄に入れます'),
            msg));
      }),
      low.length ? el('div', { class: 'group lowgroup' },
        el('div', { class: 'glabel' }, levelBadge('下'), '今日の授業と関係がうすい質問', el('span', { class: 'gcount' }, `${low.length}件`)),
        el('p', { class: 'small' }, 'クラス全体には出さず、必要なら「個別に答える」で、その児童だけに返します。'),
        el('ul', { class: 'gq' }, ...low.map((q) => {
          const rep = el('button', { type: 'button', class: 'ghost tiny' }, '個別に答える');
          rep.addEventListener('click', () => openReply(q));
          const done = el('button', { type: 'button', class: 'ghost tiny' }, '対応済み');
          done.addEventListener('click', () => t.setQuestionStatus(code, q.id, 'done'));
          return el('li', {}, el('span', { class: 'seat' }, `${q.seat}番`), el('span', { class: 'gtext' }, q.text), rep, done);
        }))) : null,
    ].filter(Boolean));
  }

  // ② AIの案を入力欄に入れる。先生が直してから配信する
  function fillDraft(out, fromQuestions) {
    const f = $('matForm').elements;
    const m = out.material; draftSource = null;
    const contexts = fromQuestions.filter((q) => q.inquiryContext).map((q) => { try { return parseContext(q.inquiryContext); } catch { return null; } }).filter(Boolean);
    draftInquiry = contexts.length ? { rootId: contexts[0].rootId, revision: contexts[0].revision + 1,
      sourceQuestionIds: fromQuestions.map((q) => q.id), sourceQuestions: fromQuestions.map((q) => ({ id: q.id, text: q.text })),
      sources: contexts.flatMap((c) => c.runs).filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i).slice(-6), parentMaterialIds: contexts.map((c) => c.materialId) } : null;
    f.title.value = m.title;
    f.explanation.value = m.explanation;
    editor.set(m.sim);
    const qz = m.quiz?.[0];
    f.q.value = qz?.q ?? '';
    [f.c1.value, f.c2.value, f.c3.value] = qz ? qz.choices : ['', '', ''];
    f.answer.value = String(qz?.answer ?? 0);
    for (const [k, n] of LESSON_FIELDS) f[n].value = m.lesson?.[k] ?? '';
    draftFrom = fromQuestions.map((q) => q.id);
    $('draftInfo').hidden = false;
    $('draftInfo').replaceChildren(...[
      el('p', { class: 'dtitle' }, out.draftLabel ?? `AIの案です(${out.model})。下の「シミュレーションで確かめた結果」と合っているかを確かめ、直してから配信してください。`),
      fromQuestions.length ? el('p', {}, el('b', {}, 'もとの質問:'), fromQuestions.map((q) => q.text).join(' / ')) : el('p', {}, el('b', {}, '要望から作った教材です')),
      out.answer ? el('div', { class: 'aianswer' }, el('b', {}, fromQuestions.length ? '質問へのAIの答え(先生向け・児童には届きません)' : 'このテーマの大事な点(先生向け)'), el('p', {}, out.answer)) : null,
      out.teacherNote ? el('p', {}, el('b', {}, '先生へのメモ(児童には届きません):'), out.teacherNote) : null,
      ...(out.notes ?? []).map((n) => el('p', { class: 'info' }, n)),
      ...(out.warnings ?? []).map((w) => el('p', { class: 'warn' }, w)),
    ].filter(Boolean));
    $('matCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('matMsg').textContent = '';
    draftSave?.schedule();
  }

  // ---------- 要望から教材をつくる(入口は1つ) ----------
  // 工房のモデルと条件を選び、その計算結果をもとにGemmaが題名・導入・授業の流れを提案する。
  $('sampleSim').append(...LAB_PRESETS.map(p => el('option', {value:p.id}, p.title)));
  draftSave = createDraftAutosave({
    form: $('matForm'), code, owner: t.mode + ':' + (t.teacherState().uid ?? 'local'),
    sampleTopic: $('sampleTopic'), sampleSim: $('sampleSim'), status: $('draftSaveStatus'),
    readState: () => ({ sim: editor.get(), from: draftFrom, inquiry: draftInquiry, source: draftSource }),
    restoreState: (saved) => {
      editor.set(saved?.sim ?? null);
      draftFrom = Array.isArray(saved?.from) ? saved.from.filter(id => typeof id === 'string') : [];
      draftInquiry = saved?.inquiry?.rootId ? saved.inquiry : null;
      draftSource = saved?.source?.source ? saved.source : null;
    },
  });
  const lab = $('hybridLabDialog');
  let workbench = null;
  $('openHybridLab').addEventListener('click', () => {
    lab.showModal();
    workbench = mountHybridWorkbench($('hybridLabHost'), {
      grade: GRADE_WORDS[grade],
      requestAI: t.mode === 'demo' ? undefined : (text) => callAI('/api/lab-plan', { code, text }),
      onUse: (material, plan) => {
        const form = $('matForm').elements;
        if ((form.title.value.trim() || form.explanation.value.trim() || editor.get()) &&
            !window.confirm('今の教材の下書きを、実験工房の条件で置き換えますか？')) return;
        lab.close();
        const label = plan.model ? '実験工房で確かめたGemmaの案(' + plan.model + ')です。' : '実験工房で確かめた条件です。';
        fillDraft({ material, draftLabel: label + ' 題名・問い・条件を確認して配信できます。', warnings: [] }, []);
        form.title.focus({ preventScroll: true });
      },
    });
  });
  $('closeHybridLab').addEventListener('click', () => lab.close());
  lab.addEventListener('close', () => { workbench?.destroy(); workbench = null; });
  $('sampleForm').addEventListener('submit', async e => {
    e.preventDefault();
    const preset = $('sampleSim').value;
    const topic = $('sampleTopic').value.trim() || labPreset(preset)?.question || lessonTopic();
    if (!topic) { $('sampleMsg').textContent = '調べたいことを書いてください'; return; }
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    $('sampleMsg').textContent = 'Gemmaが工房の実験から選んで教材案を作っています…';
    try {
      const out = await callAI('/api/sample', { code, topic, simType:preset || null, lesson:lessonTopic() });
      fillDraft(out, []);
      $('sampleMsg').textContent = '確認用の教材フォームに入れました';
    } catch (err) { $('sampleMsg').textContent = err.message; }
    finally { btn.disabled = false; }
  });

  // ---------- ③ 個別に答える(先生が確かめて、その児童だけに返す) ----------
  let replyTo = null;
  let replySim = null;
  function openReply(q) {
    replyTo = q;
    replySim = null;
    $('replyCard').hidden = false;
    $('replyQuestion').replaceChildren(...[
      el('span', { class: 'seat' }, `${q.seat}番`), levelBadge(q.relevance),
      q.aiTried ? el('span', { class: 'tag warmtag' }, 'AIに聞いてもわからなかった') : null,
      q.materialTitle ? el('span', { class: 'tag' }, `教材:${q.materialTitle}`) : null,
      el('p', {}, q.text),
      q.original ? el('span', { class: 'original' }, `もとの言い方:「${q.original}」`) : null].filter(Boolean));
    $('replyText').value = '';
    $('replyInfo').hidden = true;
    $('replySimBox').hidden = true;
    $('replyMsg').textContent = q.uid ? '' : 'この質問は前のしくみで送られたので、個別には返せません';
    $('replySend').disabled = !q.uid;
    $('replyCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('replyClose').addEventListener('click', () => { $('replyCard').hidden = true; replyTo = null; });
  $('replyAI').addEventListener('click', async () => {
    if (!replyTo) return;
    $('replyAI').disabled = true;
    $('replyMsg').textContent = 'AIが答えの案を書いています…(30秒ほど。シミュレーションを新しく作るときは3分ほど)';
    try {
      const out = await callAI('/api/answer', { code, lesson: lessonTopic(), question: replyTo.text, materialTitle: replyTo.materialTitle || null, ...(replyTo.inquiryContext ? { inquiryContext: replyTo.inquiryContext } : {}) });
      $('replyText').value = out.answer;
      replySim = normalizeSim(out.sim);
      $('replyInfo').hidden = false;
      $('replyInfo').replaceChildren(...[
        el('p', { class: 'dtitle' }, `AIの答えの案です(${out.model})。確かめて直してから返してください。`),
        out.teacherNote ? el('p', {}, el('b', {}, '先生へのメモ:'), out.teacherNote) : null,
        ...(out.notes ?? []).map((n) => el('p', { class: 'info' }, n)),
        ...out.warnings.map((w) => el('p', { class: 'warn' }, w)),
      ].filter(Boolean));
      $('replySimBox').hidden = !replySim;
      if (replySim) {
        $('replySim').replaceChildren(renderSim(replySim, { preview: true }));
        renderFacts($('replyFacts'), replySim);
      }
      $('replyMsg').textContent = `(${out.stats.sec}秒)`;
    } catch (err) {
      $('replyMsg').textContent = err.message;
    } finally {
      $('replyAI').disabled = false;
    }
  });
  $('replySend').addEventListener('click', async () => {
    const answer = $('replyText').value.trim();
    if (!replyTo?.uid) return;
    if (!answer) { $('replyMsg').textContent = '返す答えを書いてください'; return; }
    $('replySend').disabled = true;
    try {
      const reply = { uid: replyTo.uid, questionId: replyTo.id, question: replyTo.text, answer };
      if (replySim && $('replyWithSim').checked) reply.sim = replySim;
      await t.sendReply(code, reply);
      await t.setQuestionStatus(code, replyTo.id, 'done');
      $('replyMsg').textContent = `${replyTo.seat}番の児童に返しました`;
      replyTo = null;
      setTimeout(() => { $('replyCard').hidden = true; }, 1500);
    } catch (err) {
      $('replyMsg').textContent = '返せませんでした:' + err.message;
    } finally {
      $('replySend').disabled = false;
    }
  });

  // ---------- 一覧 ----------
  function renderQuestions(qs) {
    const open = qs.filter((q) => q.status !== 'done').length;
    $('qCount').textContent = open ? `未対応 ${open}件` : '';
    // 未対応を上に。その中は関係の強さ(上→中→まだ→下)、新しい順
    const sorted = [...qs].sort((a, b) =>
      (a.status === 'done') - (b.status === 'done')
      || LEVEL_ORDER[a.relevance] - LEVEL_ORDER[b.relevance]
      || b.createdAt - a.createdAt);
    $('questions').replaceChildren(...(sorted.length ? sorted.map((q) => {
      const box = el('input', { type: 'checkbox', 'aria-label': 'AIでまとめる', checked: q.status !== 'done' && !unchecked.has(q.id), disabled: q.status === 'done' });
      box.addEventListener('change', () => { if (box.checked) unchecked.delete(q.id); else unchecked.add(q.id); });
      const rep = el('button', { class: 'ghost tiny', type: 'button' }, '個別に答える');
      rep.addEventListener('click', () => openReply(q));
      return el('li', { class: q.status === 'done' ? 'done' : '' },
        box,
        el('span', { class: 'seat' }, `${q.seat}番`),
        levelBadge(q.relevance),
        // 併用(オンライン + Bluetooth)のとき:Bluetooth でつながった児童の質問に印をつける
        q.via === 'ble' ? el('span', { class: 'tag', title: 'Bluetooth でつながった児童の質問' }, 'Bluetooth') : null,
        el('span', { class: 'text' }, q.text,
          q.original ? el('span', { class: 'original' }, `もとの言い方:「${q.original}」`) : null,
          q.aiTried || q.materialTitle ? el('span', { class: 'qmeta' },
            q.aiTried ? el('span', { class: 'tag warmtag' }, 'AIに聞いてもわからなかった') : null,
            q.materialTitle ? el('span', { class: 'tag' }, `教材:${q.materialTitle}`) : null) : null),
        evidenceCard(q, {
          ai: (path, body) => callAI(path, { code, ...body }),
          useDraft: prepareInquiryDraft,
          sendReview: (reply) => t.sendReply(code, reply),
        }),
        el('span', { class: 'qbtns' },
          el('span', { class: 'meta' }, timeText(q.createdAt)),
          q.status !== 'done' ? rep : null,
          el('button', {
            class: 'ghost tiny', type: 'button',
            onclick: () => t.setQuestionStatus(code, q.id, q.status === 'done' ? 'new' : 'done'),
          }, q.status === 'done' ? '戻す' : '対応済み')));
    }) : [el('li', { class: 'empty' }, 'まだ質問はありません。児童がAIに聞いてもわからなかったとき、ここに届きます')]));
  }

  function prepareInquiryDraft(plan, context, q) {
    fillDraft({ model: plan.source, warnings: [], material: { title: plan.question.slice(0, 60), explanation: plan.answer || plan.distinguish,
      sim: { type: 'cfg', config: plan.configs[0], goal: plan.question },
      lesson: { question: plan.question, predict: '2つの条件でどう変わるか、予想と理由を書こう', check: plan.distinguish, result: '', summary: '' }, quiz: [] } }, [q]);
    draftInquiry = { ...draftInquiry, comparison: copy(plan), sources: context.runs, sourceQuestionIds: [q.id], sourceQuestions: [{ id: q.id, text: q.text }] };
    draftSave?.schedule();
  }
  function renderMaterials(ms) {
    let growth = document.getElementById('inquiryGrowth');
    if (!growth) { growth = el('section', { id: 'inquiryGrowth', class: 'card colfull' }); $('materials').parentElement.after(growth); }
    growth.replaceChildren(growthView(ms));
    $('materials').replaceChildren(...(ms.length ? ms.map((m) => {
      const sim = normalizeSim(m.sim);
      return el('li', {},
        el('span', { class: 'meta' }, timeText(m.publishedAt)),
        el('span', { class: 'text' }, m.title),
        sim ? el('span', { class: 'tag' }, simLabel(sim)) : null,
        m.lesson ? el('span', { class: 'tag' }, '授業の流れ') : null,
        m.quiz?.length ? el('span', { class: 'tag' }, '確認問題') : null);
    }) : [el('li', { class: 'empty' }, 'まだ配信していません')]));
  }
}

// 最後に、ログインの状態を見て、画面を出す(上の処理が全部そろってから)
await enter();
