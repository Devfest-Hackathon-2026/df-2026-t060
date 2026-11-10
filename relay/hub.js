// Bluetooth(や、同じ形で話すもの)でつながった児童の端末と、教室のデータ(RoomStore)をつなぐ窓口。
// 児童の端末が話してよいのは、次だけ(先生の操作・ほかの教室は、できない):
//   ping / getClass{code} / watchMaterials{code} / watchReplies{code, uid} / unwatch{kind} / sendQuestion{code, q}
// メッセージ(JSON):端末 → 先生PC {id, op, …}   先生PC → 端末 {id, ok:true, result} か {id, ok:false, error}
//                    先生PC → 端末(自分から) {push:'materials'|'replies', code, seq, part, parts, list:[…]}
//   長い一覧は、1つの大きさが上限(maxBatchBytes)をこえないように、part/parts で分けて送る。
import { isUid } from './room-store.js';

const enc = new TextEncoder();
const bytesOf = (v) => enc.encode(JSON.stringify(v)).length;

export class RelayHub {
  /**
   * @param {{store: import('./room-store.js').RoomStore, now?: () => number, questionIntervalMs?: number, maxQuestionsPerSession?: number, maxBatchBytes?: number}} o
   */
  constructor({ store, now = Date.now, questionIntervalMs = 1500, maxQuestionsPerSession = 100, maxBatchBytes = 100 * 1024 }) {
    Object.assign(this, { store, now, questionIntervalMs, maxQuestionsPerSession, maxBatchBytes });
    this.sessions = new Set();
    this.listeners = new Set();
    store.onChange((code, kind) => {
      for (const s of this.sessions) s.onStoreChange(code, kind);
    });
  }
  /** つながっている端末の数が変わったとき(先生の画面の「Bluetooth で n 台」)。fn(総数, {クラスコード: 数}) */
  onSessionsChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #changed() {
    const by = {};
    for (const s of this.sessions) if (s.code) by[s.code] = (by[s.code] ?? 0) + 1;
    for (const fn of this.listeners) { try { fn(this.sessions.size, by); } catch { /* 知らせの失敗で止めない */ } }
  }
  get sessionCount() { return this.sessions.size; }

  /** 端末が1台つながった。send(obj) は、その端末へ送る関数。返す session の receive(msg) に、端末からのメッセージを渡す */
  openSession(send) {
    const s = new Session(this, send);
    this.sessions.add(s);
    this.#changed();
    return s;
  }
  _closed(s) { if (this.sessions.delete(s)) this.#changed(); }
  _joined() { this.#changed(); }
}

class Session {
  constructor(hub, send) {
    this.hub = hub; this.send = send;
    this.code = null;          // この端末がつないでいるクラス
    this.mat = null;           // 教材を見ているクラスのコード
    this.rep = null;           // 返事を見ている { code, uid }
    this.seq = 0; this.lastQuestionAt = 0; this.questions = 0; this.closed = false;
  }

  #ok(id, result = null) { this.send({ id, ok: true, result }); }
  #ng(id, error) { this.send({ id, ok: false, error }); }
  #join(code) { if (this.code !== code) { this.code = code; this.hub._joined(); } }

  receive(msg) {
    if (this.closed) return;
    const id = msg?.id;
    if (!msg || typeof msg !== 'object' || typeof msg.op !== 'string' || !(Number.isInteger(id) && id >= 0)) return; // 形がおかしいものは、返事もしない
    const { store } = this.hub;
    try {
      switch (msg.op) {
        case 'ping': return this.#ok(id, { pong: true });
        case 'getClass': {
          const c = typeof msg.code === 'string' ? store.getClass(msg.code) : null;
          return this.#ok(id, c ? { name: c.name, grade: c.grade } : null);
        }
        case 'watchMaterials': {
          if (!store.getClass(msg.code)) return this.#ng(id, 'クラスが見つかりません');
          this.#join(msg.code); this.mat = msg.code;
          this.#ok(id);
          return this.#push('materials', msg.code, store.materials(msg.code));
        }
        case 'watchReplies': {
          if (!store.getClass(msg.code)) return this.#ng(id, 'クラスが見つかりません');
          if (!isUid(msg.uid)) return this.#ng(id, '端末の番号がおかしい');
          this.#join(msg.code); this.rep = { code: msg.code, uid: msg.uid };
          this.#ok(id);
          return this.#push('replies', msg.code, store.repliesFor(msg.code, msg.uid));
        }
        case 'unwatch': {
          if (msg.kind === 'materials') this.mat = null; else if (msg.kind === 'replies') this.rep = null;
          return this.#ok(id);
        }
        case 'sendQuestion': {
          if (!store.getClass(msg.code)) return this.#ng(id, 'クラスが見つかりません');
          const t = this.hub.now();
          if (t - this.lastQuestionAt < this.hub.questionIntervalMs) return this.#ng(id, '少し待ってから、もう一度送ってください');
          if (this.questions >= this.hub.maxQuestionsPerSession) return this.#ng(id, '質問をたくさん送りすぎました。先生に声をかけてください');
          const q = store.addQuestion(msg.code, msg.q); // 条件に合わなければ、理由つきの例外
          this.lastQuestionAt = t; this.questions++;
          this.#join(msg.code);
          return this.#ok(id, { id: q.id });
        }
        default:
          return this.#ng(id, 'この操作は、Bluetooth の児童の端末からはできません');
      }
    } catch (e) {
      this.#ng(id, e?.message ?? '失敗しました');
    }
  }

  /** 教室のデータが変わった */
  onStoreChange(code, kind) {
    if (this.closed) return;
    const { store } = this.hub;
    if (kind === 'materials' && this.mat === code) this.#push('materials', code, store.materials(code));
    if (kind === 'replies' && this.rep?.code === code) this.#push('replies', code, store.repliesFor(code, this.rep.uid));
  }

  // 一覧を、大きさの上限をこえないように分けて送る
  #push(push, code, list) {
    const seq = ++this.seq;
    const batches = [[]];
    let size = 0;
    for (const item of list) {
      const n = bytesOf(item);
      if (batches.at(-1).length && size + n > this.hub.maxBatchBytes) { batches.push([]); size = 0; }
      batches.at(-1).push(item); size += n;
    }
    batches.forEach((b, i) => this.send({ push, code, seq, part: i, parts: batches.length, list: b }));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.hub._closed(this);
  }
}
