import { createTransport, normalizeCode } from './transport.js';
import { el, showMode, watchOnline, timeText } from './common.js';
import { renderSim } from './sims.js';
import { normalizeSim, simLabel } from './sim-catalog.js';
import { simFacts } from './sim-facts.js';
import {
  NOT_IN_MATERIAL, THINK_YOURSELF, CANT_ANSWER, asksQuizAnswer, findSentences,
  phrasePrompt, checkFaithful, tidy,
  isVague, CONCRETIZE_SCHEMA, CONCRETIZE_SYSTEM, concretizePrompt,
  simForQuestion, answerSchema, answerSystem, answerPrompt, readAnswer,
} from './student-ai-prompt.js';
import * as ai from './student-ai.js';
import { mountAIProbe } from './inquiry-advance.js';
import { receiveUnderstandingReplies, understandingReplyCard, disposeUnderstandingViews } from './understanding-panel.js';
import { mountStudentAI } from './student-ai-panel.js';
import { createStudentDualTransport } from './relay/transport-student.js';

import { growthView } from './inquiry-growth.js';
import { materialGroups } from './inquiry-data.js';

const urlParams = new URLSearchParams(location.search);
const KEY = 'kyozai-student' + (urlParams.has('seat') ? ':' + urlParams.get('code') + ':' + urlParams.get('seat') : '');
// 新しいシミュレーションの「実験助手」:端末のAIで、変更の内容(JSON)だけを出させる(sim2/ui/assistant.js)
const ASSISTANT = { ready: () => ai.isReady() && ai.isCapable(), subscribe: ai.subscribe, label: () => ai.loadedModel()?.label ?? '', generateJSON: (...a) => ai.generateJSON(...a) };
const SEEN = 'kyozai-seen';
const DEBUG = 'kyozai-ai-debug';
const $ = (id) => document.getElementById(id);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても動く */ } };
const debugOn = () => load(DEBUG, false);
const saved = load(KEY, null);

// つなぎ方:ふつうは、オンライン(Firebase)。次のときは、Bluetooth で先生のパソコンにつなぐ:
//   ・先生が Bluetooth 用のリンク(?ble)を渡した / 前に Bluetooth で入ったクラス → Bluetooth だけ(オンラインを待たない)
//   ・オンラインにつながらない(10秒たっても) → Bluetooth を勧める
//   ・オンラインにつながっていても、ネットが不安定になったときのために、Bluetooth の入口も出しておく(使えない端末には出さない)
// Web Bluetooth は、https のページで、ボタンを押したときでないと、機器を選べない。
// デモモード(?demo)は、同じブラウザの中だけで動く確認用なので、Bluetooth の入口は出さない(友達のデモ画面を、そのまま見せる)
const demoUrl = new URLSearchParams(location.search).has('demo');
const bleCapable = !demoUrl && !!navigator.bluetooth && window.isSecureContext !== false;
const bleOnly = !demoUrl && (new URLSearchParams(location.search).has('ble') || saved?.via === 'ble');
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, ng) => setTimeout(() => ng(new Error('時間切れ')), ms))]);
let t = null, onlineFailed = false;
if (!bleOnly) {
  try {
    t = await withTimeout(createTransport(), 10000);
    showMode(t);
    // オンラインで入ったあとに、Bluetooth を足せるようにする(クラスの画面の「Bluetooth」欄から)
    if (bleCapable) t = createStudentDualTransport(t);
  } catch { onlineFailed = true; }
}
const joinBtn = $('joinForm').querySelector('button');
const codeFromUrl = new URLSearchParams(location.search).get('code');
let cachedBleLink = null;
// 前にBluetoothで入った教室は、先生PCが近くになくても開ける。教材と未送信の問いは端末に残る。
if (bleOnly && saved?.via === 'ble' && saved.code === normalizeCode(codeFromUrl || saved.code)) {
  const { WebBluetoothLink, createBleTransport } = await import('./relay/transport-ble.js');
  cachedBleLink = new WebBluetoothLink();
  t = await createBleTransport({ link: cachedBleLink, connectNow: false });
  showMode(t);
}

/** Bluetooth で、先生のパソコンにつなぐ(ボタンの click の中で呼ぶ)。つながったら、この端末の通信層を Bluetooth にする */
async function connectBle() {
  const msg = $('bleMsg'), btn = $('bleConnect');
  btn.disabled = true; msg.textContent = '先生のパソコンをさがしています…(出てきた一覧から、先生のパソコンを選んでください)';
  try {
    const { WebBluetoothLink, createBleTransport } = await import('./relay/transport-ble.js');
    if (!WebBluetoothLink.supported()) throw new Error('この端末では Bluetooth でつなげません。Chromebook の Chrome で、https のページを開いてください。');
    const link = new WebBluetoothLink();
    await link.pick();
    msg.textContent = 'つないでいます…';
    t = await createBleTransport({ link });
    showMode(t);
    msg.textContent = `つながりました(${link.deviceName})`;
    $('bleBox').hidden = true;
    joinBtn.disabled = false;
    $('joinMsg').textContent = '';
  } catch (err) {
    btn.disabled = false;
    msg.textContent = err?.name === 'NotFoundError' ? '先生のパソコンが見つかりませんでした(選ぶのをやめたか、近くにありません)。先生のパソコンの Bluetooth と、中継アプリが動いているか確かめて、もう一度押してください。' : `つなげませんでした:${err?.message ?? err}`;
  }
}
$('bleConnect').addEventListener('click', connectBle);

if (cachedBleLink) start(saved);
else if (bleOnly || onlineFailed) {
  // Bluetooth だけ:つながるまで、「入る」は押せない
  $('join').hidden = false;
  $('bleBox').hidden = false;
  joinBtn.disabled = true;
  if (codeFromUrl) $('codeInput').value = normalizeCode(codeFromUrl);
  if (urlParams.has('seat')) $('seatInput').value = urlParams.get('seat');
  if (onlineFailed) $('bleLead').textContent = 'オンラインにつながりません。先生のパソコンが近くにあれば、Bluetooth でつなげます。先生のパソコンの Bluetooth を入れて、下のボタンを押してください。';
  if (saved?.via === 'ble') $('bleMsg').textContent = '前に入ったクラスです。先生のパソコンに、つなぎなおしてください。';
  if (!bleCapable) $('bleMsg').textContent = 'この端末では Bluetooth でつなげません(Chrome / Edge の、https のページが必要です)。ネットにつなぎなおして、このページを読みこみなおしてください。';
} else if (saved?.code) start(saved);
else {
  $('join').hidden = false;
  if (codeFromUrl) $('codeInput').value = normalizeCode(codeFromUrl);
  if (urlParams.has('seat')) $('seatInput').value = urlParams.get('seat'); // (友達の追加)URL の seat を出席番号に入れる
  // ここでは、オンラインで入るだけ。Bluetooth は、クラスに入ったあと、画面の「Bluetooth」欄でつなぐ
  if (bleCapable) $('joinMsg').textContent = '';
}

$('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = normalizeCode($('codeInput').value);
  const seat = Number($('seatInput').value);
  if (!Number.isInteger(seat) || seat < 1 || seat > 60) {
    $('joinMsg').textContent = '出席番号は1〜60で入れてください';
    return;
  }
  if (!t) { $('joinMsg').textContent = '先に、上の「Bluetooth で先生のパソコンにつなぐ」を押してください'; return; }
  try {
    const cls = await t.getClass(code);
    if (!cls) { $('joinMsg').textContent = 'そのクラスコードは見つかりません'; return; }
    const me = { code, seat, name: cls.name, grade: cls.grade, ...(t.mode === 'ble' ? { via: 'ble' } : {}) };
    keep(KEY, me);
    $('join').hidden = true;
    start(me);
  } catch {
    $('joinMsg').textContent = t?.mode === 'ble' ? 'つながりませんでした。先生のパソコンの近くで、もう一度ためしてください' : bleCapable ? 'つながりませんでした。ネットを確かめてください(ネットがつながらないときは、先生に Bluetooth 用のリンクをもらってください)' : 'つながりませんでした。ネットにつながっているか確かめてください';
  }
});

$('leave').addEventListener('click', () => {
  if (!confirm('クラスを出ますか？')) return;
  localStorage.removeItem(KEY);
  location.href = location.pathname + (t?.mode === 'demo' ? '?demo' : t?.mode === 'ble' ? '?ble' : '');
});

// ---------- Bluetooth 欄:クラスに入ったあとで、先生のパソコンと Bluetooth でもつなぐ ----------
// オンラインのとき:欄のボタンで Bluetooth をあとから足す。Bluetooth だけで入ったとき:つながっている状態を見せる。デモ(?demo)では出さない
function setupBluetoothCard(code) {
  if (demoUrl) return;
  const card = $('bleCard'), state = $('bleCardState'), text = $('bleCardText'), btn = $('bleCardBtn'), msg = $('bleCardMsg'), pill = $('bleState');
  card.hidden = false; pill.hidden = false;
  const paint = (kind, label, pillText) => {
    card.classList.toggle('on', kind === 'on');
    state.textContent = label; state.className = `pill ${kind === 'on' ? 'on' : kind === 'wait' ? 'wait' : 'off'}`;
    pill.textContent = pillText; pill.className = `pill ble-pill ${kind === 'on' ? 'on' : kind === 'wait' ? 'wait' : 'off'}`;
  };
  if (t.mode === 'ble') {
    // Bluetooth だけで入っている
    btn.hidden = true;
    const show = ({ connected, queued, device, deliveryError }) => {
      const offline = !connected && !device;
      paint(connected ? 'on' : offline ? 'off' : 'wait', connected ? 'つながっています' : offline ? '保存した教材を閲覧中' : 'つなぎなおしています',
        connected ? 'Bluetooth ●つながっています' : offline ? 'Bluetooth 未接続' : 'Bluetooth つなぎなおし中');
      btn.hidden = !(offline && cachedBleLink && bleCapable);
      const savedCount = queued ? ` 未送信の問い ${queued}件は端末に残っています。` : '';
      text.textContent = connected ? '先生のパソコンと Bluetooth でつながっています。' :
        (offline ? '前に届いた教材を開けます。先生PCが近くに来たら、Bluetoothで新しい教材と返事を受け取れます。' :
          '先生のパソコンとのつながりが切れました。自動でつなぎなおしています。') + savedCount;
      if (deliveryError) msg.textContent = '問いが届きませんでした：' + deliveryError;
    };
    if (cachedBleLink) btn.addEventListener('click', async () => {
      btn.disabled = true; msg.textContent = '先生のパソコンを選んでください。';
      try { await cachedBleLink.pick(); await t.connect(); msg.textContent = ''; }
      catch (error) { msg.textContent = 'つなげませんでした：' + error.message; }
      finally { btn.disabled = false; }
    });
    show(t.status()); t.onStatus(show);
    return;
  }
  if (!t.attachBle) {
    // この端末では使えない
    btn.hidden = true;
    paint('off', '使えません', 'Bluetooth ×使えません');
    text.textContent = 'この端末では Bluetooth でつなげません(Chrome / Edge の、https のページが必要です)。ふつうのオンラインで使えます。';
    return;
  }
  paint('off', 'つながっていません', 'Bluetooth つないでいません');
  let unwatch = null;
  btn.addEventListener('click', async () => {
    btn.disabled = true; msg.textContent = '先生のパソコンをさがしています…(出てきた一覧から、先生のパソコンを選んでください)';
    try {
      const { WebBluetoothLink, createBleTransport } = await import('./relay/transport-ble.js');
      const link = new WebBluetoothLink();
      await link.pick();
      msg.textContent = 'つないでいます…';
      const b = await createBleTransport({ link });
      // 先生のパソコンに、このクラスがあるか確かめる(先生の画面を localhost:8787 で開いていないと、ない)
      let cls = null;
      try { cls = await b.getClass(code); } catch { /* ない扱い */ }
      if (!cls) { b.close(); throw Object.assign(new Error('no-class'), { noClass: true }); }
      t.attachBle(b);
      unwatch?.();
      unwatch = t.ble.onStatus(({ connected, queued }) => {
        paint(connected ? 'on' : 'wait', connected ? 'つながっています' : 'つなぎなおしています', connected ? 'Bluetooth ●つながっています' : 'Bluetooth つなぎなおし中');
        text.textContent = connected ? `先生のパソコン(${link.deviceName || 'Bluetooth'})と、つながっています。質問と先生の返事は、Bluetooth でも届きます。` : `つながりが切れました。自動でつなぎなおしています${queued ? `(送れていない質問 ${queued}件は、端末に残っています)` : ''}。`;
      });
      paint('on', 'つながっています', 'Bluetooth ●つながっています');
      text.textContent = `先生のパソコン(${link.deviceName || 'Bluetooth'})と、つながっています。質問と先生の返事は、Bluetooth でも届きます。`;
      msg.textContent = '';
      btn.textContent = 'つなぎなおす'; btn.className = 'ghost small';
    } catch (err) {
      msg.textContent = err?.noClass ? '先生のパソコンに、このクラスがありません。先生の画面を http://localhost:8787/teacher.html で開いているか、先生に聞いてください。'
        : err?.name === 'NotFoundError' ? '先生のパソコンが見つかりませんでした(選ぶのをやめたか、近くにありません)。先生のパソコンの Bluetooth と、中継アプリが動いているか確かめて、もう一度押してください。'
        : `つなげませんでした:${err?.message ?? err}`;
    } finally { btn.disabled = false; }
  });
}

function start({ code, seat, name, grade }) {
  $('app').hidden = false;
  $('who').textContent = `${name}　${seat}番`;
  if (t.mode === 'ble') {
    // Bluetooth:ネットではなく、先生のパソコンとのつながりを出す(切れても、質問は端末に残り、つながったら届く)
    const net = $('net');
    const show = ({ connected, queued, device }) => {
      net.textContent = connected ? '● Bluetoothでつながっています' : `● ${device ? 'つなぎなおしています' : '保存した教材を閲覧中'}${queued ? `(未送信 ${queued}件)` : ''}`;
      net.className = `net ${connected ? 'on' : 'off'}`;
    };
    show(t.status()); t.onStatus(show);
  } else watchOnline($('net'));

  setupBluetoothCard(code);

  // 学年:前に入ったときの記録に無ければ、クラスから読み直す(読めなければ小5として扱う)
  let myGrade = Number.isInteger(grade) ? grade : 5;
  if (!Number.isInteger(grade)) {
    t.getClass(code).then((c) => { if (Number.isInteger(c?.grade)) myGrade = c.grade; }).catch(() => {});
  }

  const seen = new Set(load(SEEN, []));

  // ---------- 生徒端末AI:保存済みはロード、新規取得はボタンから ----------
  let device = null;
  const aiListeners = new Set();
  const aiChanged = () => { for (const f of aiListeners) f(); };
  mountStudentAI($('aiBanner'), ai, { onChange: aiChanged });
  if (urlParams.has('check')) {
    const probeHost = el('section', {});
    $('aiBanner').after(probeHost);
    mountAIProbe(probeHost, ai);
  }

  // ---------- 先生からの返事(自分あてだけが届く) ----------
  const SEEN_REPLY = 'kyozai-seen-replies';
  const seenReplies = new Set(load(SEEN_REPLY, []));
  t.watchMyReplies(code, (rs) => {
    receiveUnderstandingReplies(rs, { code, seat });
    disposeUnderstandingViews($('replies'));
    $('repliesCard').hidden = !rs.length;
    $('replies').replaceChildren(...rs.map((r) => {
      const isNew = !seenReplies.has(r.id);
      return el('li', { class: 'reply' },
        el('div', { class: 'replyhead' }, isNew ? el('span', { class: 'new' }, 'NEW') : null, el('span', { class: 'meta' }, timeText(r.createdAt))),
        el('p', { class: 'replyq' }, el('span', { class: 'lstep' }, '質問'), r.question),
        el('p', { class: 'replya' }, el('span', { class: 'lstep' }, '先生'), r.answer),
        understandingReplyCard(r, { code, seat }),
        r.sim ? renderSim(r.sim) : null,
        isNew ? el('button', {
          type: 'button', class: 'ghost small',
          onclick: (e) => { seenReplies.add(r.id); keep(SEEN_REPLY, [...seenReplies]); e.target.closest('li').querySelector('.new')?.remove(); e.target.remove(); },
        }, 'わかった') : null);
    }));
  }, { seat });

  // ---------- とどいた教材 ----------
  t.watchMaterials(code, (ms) => {
    let growth = document.getElementById('inquiryGrowth');
    if (!growth) { growth = el('section', { id: 'inquiryGrowth', class: 'card' }); $('materials').parentElement.after(growth); }
    growth.replaceChildren(growthView(ms, open));
    $('materials').replaceChildren(...(ms.length ? materialGroups(ms).map((group) => group[0]).map((m) => {
      const sim = normalizeSim(m.sim);
      return el('li', {},
        el('button', { type: 'button', class: 'tile', onclick: () => open(m) },
          el('span', { class: 'tiletop' },
            seen.has(m.id) ? null : el('span', { class: 'new' }, 'NEW'),
            sim ? el('span', { class: 'tag' }, simLabel(sim)) : null,
            el('span', { class: 'meta' }, timeText(m.publishedAt))),
          el('span', { class: 'text' }, m.title)));
    }) : [el('li', { class: 'empty' }, 'まだ教材はありません。先生が配信すると、ここに出ます')]));
  });

  function open(m) {
    seen.add(m.id);
    keep(SEEN, [...seen]);
    const v = $('viewer');
    v.hidden = false;
    const L = m.lesson ?? {};
    // replaceChildren は null を「null」という文字にしてしまうので、出さないものは外してからわたす
    v.replaceChildren(...[
      el('div', { class: 'viewerhead' },
        el('h2', {}, m.title),
        el('button', { class: 'ghost small', onclick: () => { v.hidden = true; } }, 'とじる')),
      m.explanation ? el('p', { class: 'explain' }, m.explanation) : null,
      lessonCard('q', 'はてな', L.question),
      L.predict && m.sim?.type !== 'cfg' ? predictCard(m, L.predict) : null,
      lessonCard('check', '確かめよう', L.check),
      renderSim(m.sim, { assistant: ASSISTANT, inquiry: { code, seat, materialId: m.id, rootId: m.inquiry?.rootId ?? m.id, revision: m.inquiry?.revision ?? 1,
        sources: m.inquiry?.sources ?? [], comparison: m.inquiry?.comparison,
        onShare: (q) => t.sendQuestion(code, { seat, ...q, materialTitle: m.title }) } }),
      revealCard('result', '結果', L.result),
      revealCard('summary', 'わかったこと', L.summary),
      ...(m.quiz ?? []).map(quizView),
      helpPanel(m),
    ].filter(Boolean));
    v.scrollIntoView({ behavior: 'smooth' });
    $('materials').querySelectorAll('li').forEach((li) => {
      if (li.querySelector('.text')?.textContent === m.title) li.querySelector('.new')?.remove();
    });
  }

  // 授業の流れ(先生が配信した教材の lesson)
  function lessonCard(kind, label, text) {
    if (!text) return null;
    return el('div', { class: `lcard ${kind}` }, el('span', { class: 'lstep' }, label), el('p', {}, text));
  }
  // 結果・わかったことは、自分で確かめてから開く
  function revealCard(kind, label, text) {
    if (!text) return null;
    return el('details', { class: `lcard ${kind}` },
      el('summary', {}, el('span', { class: 'lstep' }, label), el('span', { class: 'open' }, '見る')),
      el('p', {}, text));
  }
  // 自分の予想を書く(この端末の中だけに残る。先生には送らない)
  function predictCard(m, text) {
    const k = `kyozai-predict:${m.id}`;
    const box = el('textarea', { rows: 2, maxlength: 200, placeholder: '自分の予想と、そう思ったわけを書こう', 'aria-label': '自分の予想' });
    box.value = load(k, '');
    box.addEventListener('input', () => keep(k, box.value));
    return el('div', { class: 'lcard predict' }, el('span', { class: 'lstep' }, '予想しよう'), el('p', {}, text), box);
  }

  function quizView(qz) {
    const result = el('p', { class: 'msg' });
    return el('div', { class: 'quiz' },
      el('p', { class: 'q' }, qz.q),
      ...qz.choices.map((c, i) => el('button', {
        class: 'choice',
        onclick: (e) => {
          e.target.parentElement.querySelectorAll('.choice').forEach((b) => b.classList.remove('ok', 'ng'));
          const ok = i === qz.answer;
          e.target.classList.add(ok ? 'ok' : 'ng');
          result.textContent = ok ? 'せいかい！' : 'もう一度考えてみよう';
        },
      }, c)),
      result);
  }

  // ---------- 「まずAIに聞く」の流れ(質問箱は、それぞれの教材の中の1つだけ) ----------
  //  1. 確認問題の答えをたずねる質問 → 自分で考えよう(AIを使わない)
  //  2. 「それ」「これ」など、あいまいな質問 → AIがこの教材の話として、具体的な質問の候補を出し、「こういうこと?」と選んでもらう
  //  3. 具体的な質問 → AIが、シミュレーションで計った結果に合わせて答え、確かめるシミュレーションを出す
  //     (結果と食いちがう答えは出さず、計った結果の文を見せる)
  //  4. わかった/わからない → 先生に聞く(具体化した質問と、もとの言い方と、この教材の題を送る)
  //  大きいAI(Gemma 4 E2B)がまだのときは、この教材の中から答えの文をさがすだけにする
  async function runAsk(text, { material, out, msgEl }) {
    msgEl.textContent = '';
    if (asksQuizAnswer(text)) {
      out.replaceChildren(el('p', {}, THINK_YOURSELF), actions(text, text, material, out, msgEl));
      return;
    }
    if (ai.isReady() && ai.isCapable()) {
      if (isVague(text)) await concretize(text, material, out, msgEl);
      else await answerWithAI(text, text, material, out, msgEl);
      return;
    }
    searchOnly(text, material, out, msgEl);
  }

  async function concretize(text, mat, out, msgEl) {
    out.replaceChildren(thinkingLine('AIが、質問の意味を考えています…'));
    try {
      const r = await ai.generateJSON(concretizePrompt(mat, text), CONCRETIZE_SCHEMA, 200, CONCRETIZE_SYSTEM);
      const options = [...new Set((r.json?.options ?? []).map((o) => tidy(o).slice(0, 60)).filter(Boolean))].slice(0, 3);
      if (!options.length) { await answerWithAI(text, text, mat, out, msgEl); return; }
      out.replaceChildren(...[
        el('div', { class: 'lcard q' }, el('span', { class: 'lstep' }, 'こういうこと?'),
          el('p', { class: 'small' }, `「${text}」を、「${mat.title}」の話として考えたよ。聞きたいことをえらんでね。`),
          el('div', { class: 'options' }, ...options.map((o) => el('button', { type: 'button', class: 'option', onclick: () => answerWithAI(o, text, mat, out, msgEl) }, o))),
          el('button', { type: 'button', class: 'ghost small', onclick: () => answerWithAI(text, text, mat, out, msgEl) }, 'どれでもない(このまま聞く)')),
        debugOn() ? el('p', { class: 'debug' }, `[テスト表示] ${ai.loadedModel()?.label} ${r.ms}ms:${r.text}`) : null,
      ].filter(Boolean));
    } catch (err) {
      out.replaceChildren(el('p', { class: 'small' }, 'AIが考えられませんでした:' + err.message), actions(text, text, mat, out, msgEl));
    }
  }

  async function answerWithAI(question, original, mat, out, msgEl) {
    const sim = simForQuestion(mat, question);
    out.replaceChildren(thinkingLine('AIが、シミュレーションの結果をもとに答えを考えています…'));
    try {
      const r = await ai.generateJSON(answerPrompt(mat, question, sim), answerSchema(sim), 300, answerSystem(myGrade));
      const a = readAnswer(r.json, sim);
      // 見せる結果は、質問に関係する条件(子どもが変える条件)のものだけ
      const rows = a.sim ? simFacts(a.sim)?.rows ?? [] : [];
      const facts = (rows.some((x) => x.adjustable) ? rows.filter((x) => x.adjustable) : rows).map((x) => x.text);
      out.replaceChildren(...[
        el('div', { class: 'lcard q' }, el('span', { class: 'lstep' }, 'はてな'), el('p', {}, question)),
        a.answer
          ? el('div', { class: 'lcard ans' }, el('span', { class: 'lstep' }, 'AIのこたえ'), el('p', {}, a.answer))
          : el('div', { class: 'lcard ans' }, el('span', { class: 'lstep' }, 'AIのこたえ'),
            el('p', {}, a.cant || !facts.length ? CANT_ANSWER : 'シミュレーションで計ると、こうなったよ:'),
            ...(!a.cant && facts.length ? facts.map((f) => el('blockquote', { class: 'quote' }, f)) : [])),
        a.sim ? el('div', { class: 'lcard check' }, el('span', { class: 'lstep' }, '確かめよう'), el('p', {}, a.check || 'シミュレーションで、条件を変えて確かめてみよう。')) : null,
        a.sim ? renderSim(a.sim) : null,
        a.sim && facts.length ? el('details', { class: 'lcard result' },
          el('summary', {}, el('span', { class: 'lstep' }, 'シミュレーションの結果'), el('span', { class: 'open' }, '見る')),
          ...facts.map((f) => el('p', {}, f))) : null,
        el('p', { class: 'small' }, rows.length ? `「${mat.title}」の教材と、モデルの計算結果から考えたよ。AIはまちがえることもあります。` : `「${mat.title}」の教材から考えたよ。実験の結果は、探究ノートで記録して確かめよう。AIはまちがえることもあります。`),
        actions(question, original, mat, out, msgEl),
        debugOn() ? el('p', { class: 'debug' }, `[テスト表示] ${ai.loadedModel()?.label} ${r.ms}ms:${r.text}${a.problems.length ? `\n使わなかった理由:${a.problems.join(' / ')}` : ''}`) : null,
      ].filter(Boolean));
    } catch (err) {
      out.replaceChildren(el('p', { class: 'small' }, 'AIが答えられませんでした:' + err.message), actions(question, original, mat, out, msgEl));
    }
  }

  // この教材の中から答えの文をさがす(大きいAIがないとき。軽いAIがあれば、答えらしく直す)
  async function searchOnly(text, material, out, msgEl) {
    const hits = findSentences(material, text);
    if (!hits.length) {
      out.replaceChildren(el('p', {}, NOT_IN_MATERIAL), el('div', { class: 'row wrap' }, askTeacherButton(text, text, material, msgEl, '先生に聞く')));
      return;
    }
    const box = el('div', { class: 'stack tight' },
      el('p', { class: 'small' }, '教材の中に、こう書いてあったよ:'),
      ...hits.map((h) => el('blockquote', { class: 'quote' }, h)),
      el('p', { class: 'small' }, 'これでわかったかな?'),
      actions(text, text, material, out, msgEl));
    out.replaceChildren(box);
    if (ai.isReady() && hits.length === 1) await tryPhrase(text, hits[0], box);
  }

  // 見つけた教材の文を、端末のAIで「質問への答えらしい1文」に直す。検査を通らなければ出さない
  async function tryPhrase(q, sentence, box) {
    const thinking = el('p', { class: 'small' }, 'AIが考えています…');
    box.prepend(thinking);
    try {
      const { text, ms } = await ai.generate(phrasePrompt(q, sentence, myGrade), 80);
      const said = tidy(text);
      const chk = checkFaithful(said, sentence, q);
      thinking.replaceWith(chk.ok ? el('p', { class: 'aiword' }, el('span', { class: 'tag' }, 'AI'), ' ', said) : el('span'));
      if (debugOn()) box.append(el('p', { class: 'debug' }, `[テスト表示] ${ai.loadedModel()?.label} ${ms}ms:「${said}」→ ${chk.ok ? '使った' : `使わなかった(${chk.reason})`}`));
    } catch (err) {
      thinking.textContent = 'AIが答えられませんでした:' + err.message;
    }
  }

  function thinkingLine(text) {
    return el('p', { class: 'thinking' }, el('span', { class: 'dots', 'aria-hidden': 'true' }), text);
  }

  function actions(question, original, mat, out, msgEl) {
    return el('div', { class: 'row wrap' },
      el('button', { type: 'button', class: 'small', onclick: () => { out.replaceChildren(el('p', { class: 'small' }, 'よかった!')); } }, 'わかった'),
      askTeacherButton(question, original, mat, msgEl, 'わからない → 先生に聞く'));
  }

  // 先生に聞く:AIに聞いてもわからなかったときだけ。具体化した質問と、もとの言い方、どの教材の話かを送る
  function askTeacherButton(question, original, mat, msgEl, label) {
    const b = el('button', { type: 'button', class: 'ghost small' }, label);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const delivery = await t.sendQuestion(code, { seat, text: question, original, aiTried: ai.isReady(), materialTitle: mat?.title ?? null });
        msgEl.textContent = delivery?.queued ? '送信待ちに入れました。Bluetoothでつながると先生へ届きます。' : navigator.onLine
          ? '先生に送りました。先生から返事が来たら「先生からの返事」に出ます'
          : 'オフラインなので、つながったら自動で送ります';
      } catch (err) {
        msgEl.textContent = '送れませんでした：' + err.message;
        b.disabled = false;
      }
    });
    return b;
  }

  // ---------- 質問箱:それぞれの教材の中に1つだけ ----------
  function helpPanel(m) {
    const out = el('div', { class: 'aiout' });
    const panelMsg = el('p', { class: 'msg', role: 'status' });
    const qText = el('textarea', { rows: 2, maxlength: 200, placeholder: '例:それって重いとどうなるの?', 'aria-label': 'この教材について聞きたいこと' });
    const askButton = el('button', { class: 'primary ai' }, '教材の説明から探す');
    const form = el('form', { class: 'stack tight' }, qText, askButton);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = qText.value.trim();
      if (q) runAsk(q, { material: m, out, msgEl: panelMsg });
    });

    // いまのAIのようす(どのAIで答えるか)
    const status = el('p', { class: 'small aistatus' });
    const renderStatus = () => {
      askButton.textContent = ai.isReady() ? 'この端末のAIと考える' : '教材の説明から探す';
      status.textContent = ai.isReady()
        ? `AI:${ai.loadedModel()?.label}(この端末の中で動きます。聞いたことは、先生に聞くまでどこにも送られません)`
        : device?.webgpu === false
          ? 'この端末ではAIは動かないので、この教材の中から答えをさがします。'
          : '教材の中の説明から探します。実験の根拠を付けた質問は、上の「次の問い」から先生へ送れます。';
    };
    renderStatus();
    aiListeners.add(() => { if (status.isConnected) renderStatus(); });

    const debugBox = el('input', { type: 'checkbox', checked: debugOn() });
    debugBox.addEventListener('change', () => keep(DEBUG, debugBox.checked));

    
    return el('details', { class: 'help askbox' },
      el('summary', {}, 'この教材について聞く・考える'),
      el('p', { class: 'small' }, '生徒側AIが準備できていれば、この端末で質問を整理します。使えないときも教材の文章を探せます。全体への共有は先生が確認します。'),
      form, out, panelMsg, status,
      el('label', { class: 'debugtoggle' }, el('span', {}, debugBox, ' テスト表示(AIの出力をそのまま見る)')));
  }
}
