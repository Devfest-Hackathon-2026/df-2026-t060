// 先生の画面用の通信層(オンライン + Bluetooth の併用)。
//   先生は、ふつうどおりオンライン(Google ログイン・Firestore)。児童は、オンライン(Firestore)でも、Bluetooth(先生PCの教室)でも、同じクラスに入れる。
//   online:transport.js の通信層(Firebase 版。試すときはデモ版)  local:relay/transport-local.js(先生PCのサーバー=Bluetooth 教室のデータ)
//
//   配信    → オンラインと Bluetooth 教室の両方へ、同じ教材 id で
//   質問    → オンラインの児童(Firestore)と、Bluetooth の児童(先生PC)の質問を、1つの一覧に合わせる(各質問に via:'online'|'ble')
//   返事    → 宛先の児童の側へ(Bluetooth の児童は uid が ble- で始まる)
//   印・関係の強さ → その質問がある側へ
//   教室    → 先生の画面でクラスを開くと、Bluetooth 教室にも、同じクラスコードの教室を用意する(既存の教材も、あとから写す)
// オンラインが主。Bluetooth 教室(先生PCの中継)が動いていなくても、オンラインの動きは止めない(Bluetooth の分だけ、使えないと知らせる)。
const newId = () => globalThis.crypto.randomUUID();
const isBleUid = (uid) => typeof uid === 'string' && uid.startsWith('ble-');

/**
 * @param {{online: object, local: object, probeMs?: number}} o
 * @returns {Promise<object>}  transport.js と同じ形の通信層 + bluetooth の情報
 */
export async function createHybridTeacherTransport({ online, local, probeMs = 1500 }) {
  const bt = { available: false, lastError: '', students: 0 };
  const noticeCbs = new Set(), changeCbs = new Set();
  const changed = () => { for (const cb of changeCbs) { try { cb({ ...bt }); } catch { /* 画面の失敗で止めない */ } } };
  const notice = (msg) => { bt.lastError = msg; for (const cb of noticeCbs) { try { cb(msg); } catch { /* 同上 */ } } changed(); };
  const up = () => { if (!bt.available || bt.lastError) { bt.available = true; bt.lastError = ''; changed(); } };
  const down = (why) => { if (bt.available || bt.lastError !== why) { bt.available = false; bt.lastError = why; changed(); } };

  /** Bluetooth 教室の呼び出し:失敗しても、例外にせず、使えないことだけ記録する(オンラインを止めない) */
  async function safe(fn) {
    try { const r = await fn(); up(); return { ok: true, value: r }; }
    catch (e) { down(`Bluetooth 教室(先生PCの中継)につながりません:${e?.message ?? e}`); return { ok: false, error: e }; }
  }

  // はじめに、先生PCのサーバーが Bluetooth 教室を持っているか、少し待って確かめる
  // (時間切れのタイマーは、確認が終わったら必ず止める。止めないと、成功したあとで「使えない」にしてしまう)
  let timer;
  await Promise.race([
    safe(() => local.status()),
    new Promise((r) => { timer = setTimeout(() => { down('Bluetooth 教室(先生PCの中継)につながりません:時間切れ'); r(); }, probeMs); }),
  ]);
  clearTimeout(timer);
  if (!bt.available && !bt.lastError) bt.lastError = 'Bluetooth 教室につながりません';

  // ---- 教室(クラス)を、Bluetooth 教室にも用意する:クラスごとに1回 ----
  const rooms = new Map(); // code → Promise<boolean>
  function ensureRoom(code, name, grade) {
    if (rooms.has(code)) return rooms.get(code);
    const p = (async () => {
      if (!bt.available) return false;
      let cls = name ? { name, grade } : null;
      if (!cls) { try { cls = await online.getClass(code); } catch { cls = null; } }
      if (!cls?.name) return false;
      const r = await safe(() => local.createClass(cls.name, Number.isInteger(cls.grade) ? cls.grade : undefined, { code }));
      return r.ok;
    })();
    rooms.set(code, p);
    p.then((ok) => { if (!ok) rooms.delete(code); }); // 失敗したら、つぎに、もう一度ためす
    return p;
  }

  // ---- 教材:オンラインにある分を、Bluetooth 教室にも写す(同じ id・同じ配信時刻。二重に入らない) ----
  const synced = new Map(); // code → Set(教材 id)
  let syncChain = Promise.resolve();
  function syncMaterials(code, list) {
    syncChain = syncChain.then(async () => {
      if (!(await ensureRoom(code))) return;
      const done = synced.get(code) ?? new Set(); synced.set(code, done);
      for (const m of [...list].reverse()) { // 古いものから
        if (!m?.id || done.has(m.id)) continue;
        const { id, publishedAt, ...rest } = m;
        const r = await safe(() => local.publishMaterial(code, rest, { id, publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined }));
        if (r.ok) done.add(id); else break; // つながらないときは、あとで(つぎの更新で)もう一度
      }
    }).catch(() => {});
    return syncChain;
  }

  const bleIds = new Set(); // Bluetooth 教室の質問の id(印をつけるとき、どちらに送るか決める)
  // Bluetooth 教室が、あとから使えるようになったとき(授業の途中でサーバーを起動した など)、見ているものを、つなぎなおす処理
  const attachers = new Set();
  const lastMaterials = new Map(); // code → オンラインの教材の一覧(つなぎなおしたとき、もう一度写す)
  function recovered() { rooms.clear(); for (const f of [...attachers]) f(); }

  const t = {
    ...online,
    hybrid: true,
    bluetooth: {
      get available() { return bt.available; },
      get lastError() { return bt.lastError; },
      onNotice(cb) { noticeCbs.add(cb); return () => noticeCbs.delete(cb); },
      onChange(cb) { changeCbs.add(cb); return () => changeCbs.delete(cb); },
      /** 先生PCの Bluetooth 教室が使えるか、もう一度確かめる。使えるようになっていたら、見ているものをつなぎなおして、教材も写す */
      async recheck() {
        const was = bt.available;
        await safe(() => local.status());
        if (!was && bt.available) recovered();
        return bt.available;
      },
      /** Bluetooth でつながっている児童の端末の数({count}) */
      watchStudents(code, cb) {
        let off = null, stopped = false;
        const attach = () => {
          if (stopped || off) return;
          ensureRoom(code).then((ok) => { if (ok && !stopped && !off) off = local.watchStudents(code, (s) => { bt.students = s.count; cb(s); }); });
        };
        attachers.add(attach); attach();
        return () => { stopped = true; attachers.delete(attach); off?.(); };
      },
    },

    async createClass(name, grade) {
      const code = await online.createClass(name, grade);
      ensureRoom(code, name, grade);
      return code;
    },
    async getClass(code) {
      const c = await online.getClass(code);
      if (c) ensureRoom(code, c.name, c.grade);
      return c;
    },

    /** 教材を、オンラインと Bluetooth 教室の両方へ。どちらかだけ失敗したら、成功した側には届け、知らせる */
    async publishMaterial(code, m) {
      const id = newId();
      const [on, ble] = await Promise.allSettled([
        online.publishMaterial(code, m, { id }),
        (async () => { if (!(await ensureRoom(code))) throw new Error('Bluetooth 教室がありません'); return local.publishMaterial(code, m, { id, publishedAt: Date.now() }); })(),
      ]);
      if (ble.status === 'fulfilled') { (synced.get(code) ?? synced.set(code, new Set()).get(code)).add(id); up(); }
      else if (bt.available) notice(`Bluetooth の児童には、教材が届きませんでした:${ble.reason?.message ?? ble.reason}`);
      if (on.status === 'rejected') {
        if (ble.status === 'rejected') throw on.reason;
        notice('オンラインへは配信できませんでした(Bluetooth の児童には届きました)。ネットを確かめてください');
      }
      return { id, online: on.status === 'fulfilled', bluetooth: ble.status === 'fulfilled' };
    },
    watchMaterials(code, cb) {
      const attach = () => { const l = lastMaterials.get(code); if (l) syncMaterials(code, l); }; // つなぎなおしたら、いまの分をもう一度写す
      attachers.add(attach);
      const off = online.watchMaterials(code, (list) => { lastMaterials.set(code, list); cb(list); syncMaterials(code, list); });
      return () => { attachers.delete(attach); off?.(); };
    },

    /** 質問:オンラインと Bluetooth を、1つの一覧に(新しい順) */
    watchQuestions(code, cb) {
      let onList = [], bleList = [], stopped = false, offBle = null;
      const emit = () => cb([...onList.map((q) => ({ ...q, via: 'online' })), ...bleList.map((q) => ({ ...q, via: 'ble' }))].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)));
      const offOn = online.watchQuestions(code, (l) => { onList = l; emit(); });
      const attach = () => {
        if (stopped || offBle) return;
        ensureRoom(code).then((ok) => {
          if (!ok || stopped || offBle) return;
          offBle = local.watchQuestions(code, (l) => { bleList = l; for (const q of l) bleIds.add(q.id); emit(); });
        });
      };
      attachers.add(attach); attach();
      return () => { stopped = true; attachers.delete(attach); offOn?.(); offBle?.(); };
    },
    async setQuestionStatus(code, id, status) { return t.updateQuestion(code, id, { status }); },
    async updateQuestion(code, id, fields) {
      if (bleIds.has(id)) return local.updateQuestion(code, id, fields);
      return online.updateQuestion(code, id, fields);
    },

    /** 返事:Bluetooth の児童(uid が ble- で始まる)には、先生PCの教室へ。そうでなければ、オンラインへ */
    async sendReply(code, r) {
      if (isBleUid(r?.uid)) return local.sendReply(code, r);
      return online.sendReply(code, r);
    },
  };
  return t;
}
