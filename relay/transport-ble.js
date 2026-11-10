// 児童の端末(Chromebook など)用の通信層:Web Bluetooth で、先生PCの中継アプリにつなぐ。
// transport.js と同じ形(児童の画面が使う部分だけ)。Firestore のかわりに、先生PCの中の教室のデータを使う。
//   getClass(code) / watchMaterials(code, cb) / sendQuestion(code, q) / watchMyReplies(code, cb) / myUid() / mode: 'ble'
// ネットがなくても使えるように、Firebase 版と同じ工夫をする:
//   - 届いた教材は、端末に覚える(つながる前でも、前の教材を見られる)
//   - 送った質問は、つながっていないときは端末に積んでおき、つながったら自動で送る
//   - 切れたら、自動でつなぎなおす
// Web Bluetooth は https(か localhost)のページで、ボタンを押したとき(ユーザーの操作)でないと、機器を選べない。
// 使い方:  const link = new WebBluetoothLink();  await link.pick();   // ボタンの click の中で(機器の選択画面が出る)
//          const t = await createBleTransport({ link });
import { questionFields } from '../question-fields.js';
import { Framer, Reassembler, encodeMessage, decodeMessage, SERVICE_UUID, RX_UUID, TX_UUID, DEVICE_NAME_PREFIX, WRITE_CHUNK_BYTES } from './protocol.js';

// ---------- Web Bluetooth(GATT)につなぐ部分 ----------
export class WebBluetoothLink {
  /** @param {{bluetooth?: object}} [o]  テストでは、偽の navigator.bluetooth をわたす */
  constructor({ bluetooth = globalThis.navigator?.bluetooth } = {}) {
    this.bluetooth = bluetooth; this.device = null; this.rx = null; this.tx = null;
    this.chunkCb = () => {}; this.disconnectCb = () => {};
    this.maxWrite = WRITE_CHUNK_BYTES;
    this._onValue = (ev) => {
      const dv = ev.target.value;
      this.chunkCb(new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength)));
    };
    this._onGone = () => { this.rx = this.tx = null; this.disconnectCb(); };
  }
  static supported(bluetooth = globalThis.navigator?.bluetooth) { return !!bluetooth && (globalThis.isSecureContext ?? true); }

  /** 機器の選択画面を出して、先生PCを選ぶ(ボタンの click の中で呼ぶ) */
  async pick() {
    if (!this.bluetooth) throw new Error('この端末(ブラウザ)では、Bluetooth でつなげません(Chrome / Edge の、https のページで使えます)');
    this.device = await this.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }], optionalServices: [SERVICE_UUID] });
    return this.device;
  }
  get deviceName() { return this.device?.name ?? ''; }

  /** つなぐ(選んだ機器に、もう一度つなぐのは、操作なしでできる) */
  async connect() {
    if (!this.device) throw new Error('先に pick() で、先生PCを選んでください');
    this.device.removeEventListener?.('gattserverdisconnected', this._onGone);
    this.device.addEventListener('gattserverdisconnected', this._onGone);
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.rx = await service.getCharacteristic(RX_UUID);
    this.tx = await service.getCharacteristic(TX_UUID);
    this.tx.removeEventListener?.('characteristicvaluechanged', this._onValue);
    this.tx.addEventListener('characteristicvaluechanged', this._onValue);
    await this.tx.startNotifications();
  }
  onChunk(cb) { this.chunkCb = cb; }
  onDisconnect(cb) { this.disconnectCb = cb; }
  /** chunk を1つ書く。「応答あり」で書くので、MTU より大きい chunk も、長い書きこみで送れる */
  async write(chunk) {
    if (!this.rx) throw new Error('つながっていません');
    if (this.rx.writeValueWithResponse) await this.rx.writeValueWithResponse(chunk); else await this.rx.writeValue(chunk);
  }
  close() {
    this.device?.removeEventListener?.('gattserverdisconnected', this._onGone);
    try { this.device?.gatt?.disconnect(); } catch { /* すでに切れている */ }
    this.rx = this.tx = null;
  }
}

// ---------- 通信層 ----------
const OUTBOX = 'kyozai-ble-outbox';
const UID = 'kyozai-ble-uid';
const CACHE = (code) => `kyozai-ble-materials:${code}`;
const CLASS = (code) => `kyozai-ble-class:${code}`;
const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

/**
 * @param {{link: object, storage?: Storage, rpcTimeoutMs?: number, backoffMs?: number[], sleep?: (ms: number) => Promise<void>, autoReconnect?: boolean}} o
 * link:{ connect(), write(chunk), onChunk(cb), onDisconnect(cb), close(), maxWrite? }
 */
export async function createBleTransport({ link, storage = globalThis.localStorage ?? memoryStorage(), rpcTimeoutMs = 30000, backoffMs = [1000, 2000, 4000, 8000, 15000, 30000], sleep = (ms) => new Promise((r) => setTimeout(r, ms)), autoReconnect = true, retryQuestionMs = 2000, connectNow = true } = {}) {
  const load = (k, d) => { try { return JSON.parse(storage.getItem(k)) ?? d; } catch { return d; } };
  const keep = (k, v) => { try { storage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

  const framer = new Framer(), reasm = new Reassembler();
  const state = { connected: false, closed: false, nextId: 1, pending: new Map(), mat: new Map(), rep: new Map(), parts: new Map(), flushing: false, attempt: 0 };
  const statusCbs = new Set();
  const notifyStatus = () => { const s = status(); for (const cb of statusCbs) { try { cb(s); } catch { /* 画面の失敗で止めない */ } } };
  const status = () => ({ connected: state.connected, queued: load(OUTBOX, []).length, device: link.deviceName ?? '', ...(state.deliveryError ? { deliveryError: state.deliveryError } : {}) });

  // ---- 送る(chunk に分けて、1つずつ書く。同時に2つのメッセージの chunk がまざらないよう、順番に) ----
  let sendChain = Promise.resolve();
  const sendObj = (obj) => {
    const run = sendChain.then(async () => {
      for (const c of framer.split(encodeMessage(obj), link.maxWrite ?? WRITE_CHUNK_BYTES)) await link.write(c);
    });
    sendChain = run.catch(() => {});
    return run;
  };
  function call(op, params = {}) {
    if (!state.connected) return Promise.reject(new Error('先生のパソコンにつながっていません'));
    const id = state.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { state.pending.delete(id); reject(new Error('先生のパソコンから返事がありません')); }, rpcTimeoutMs);
      state.pending.set(id, { resolve, reject, timer });
      sendObj({ id, op, ...params }).catch((e) => { clearTimeout(timer); state.pending.delete(id); reject(e); });
    });
  }

  // ---- 受ける ----
  const emit = (map, code, list) => { for (const cb of map.get(code) ?? []) { try { cb(list); } catch { /* 画面の失敗で止めない */ } } };
  function onMessage(msg) {
    if (msg.push) {
      // 一覧は、part/parts に分かれて届く。同じ seq の全部がそろったら、1つの一覧にして使う
      const key = `${msg.push}:${msg.code}`;
      let p = state.parts.get(key);
      if (!p || p.seq !== msg.seq) { p = { seq: msg.seq, parts: new Map() }; state.parts.set(key, p); }
      p.parts.set(msg.part, msg.list ?? []);
      if (p.parts.size < msg.parts) return;
      state.parts.delete(key);
      const list = [...Array(msg.parts).keys()].flatMap((i) => p.parts.get(i) ?? []);
      if (msg.push === 'materials') { keep(CACHE(msg.code), list); emit(state.mat, msg.code, list); }
      else if (msg.push === 'replies') emit(state.rep, msg.code, list);
      return;
    }
    const w = state.pending.get(msg.id);
    if (!w) return;
    clearTimeout(w.timer); state.pending.delete(msg.id);
    if (msg.ok) w.resolve(msg.result); else w.reject(Object.assign(new Error(msg.error || '失敗しました'), { fromRelay: true }));
  }
  link.onChunk((chunk) => {
    const r = reasm.push(chunk);
    if (!r.message) return;
    try { onMessage(decodeMessage(r.message)); } catch { /* 読めないメッセージは捨てる */ }
  });

  // ---- つなぐ・切れたらつなぎなおす ----
  async function afterConnect() {
    state.connected = true; state.attempt = 0; notifyStatus();
    // 見ているものを、あらためて頼む(切れていた間にふえた教材・返事が、まとめて届く)
    for (const code of state.mat.keys()) call('watchMaterials', { code }).catch(() => {});
    for (const code of state.rep.keys()) call('watchReplies', { code, uid: transport.myUid() }).catch(() => {});
    flushOutbox();
  }
  function lost() {
    if (!state.connected && state.reconnecting) return;
    state.connected = false;
    for (const [id, w] of state.pending) { clearTimeout(w.timer); w.reject(new Error('先生のパソコンとの接続が切れました')); state.pending.delete(id); }
    state.parts.clear();
    notifyStatus();
    if (!state.closed && autoReconnect) reconnect();
  }
  async function reconnect() {
    if (state.reconnecting) return;
    state.reconnecting = true;
    try {
      while (!state.closed && !state.connected) {
        await sleep(backoffMs[Math.min(state.attempt, backoffMs.length - 1)]);
        state.attempt++;
        try { await link.connect(); await afterConnect(); } catch { /* つぎの試しへ */ }
      }
    } finally { state.reconnecting = false; }
  }
  // ---- 質問:端末に積んで、つながっていれば送る ----
  async function flushOutbox() {
    if (state.flushing) return;
    state.flushing = true;
    try {
      for (;;) {
        const box = load(OUTBOX, []);
        if (!box.length || !state.connected) break;
        const item = box[0];
        try {
          await call('sendQuestion', { code: item.code, q: item.q });
          if (!keep(OUTBOX, load(OUTBOX, []).filter((x) => x.key !== item.key))) break;
          notifyStatus();
        } catch (e) {
          if (e.fromRelay && /少し待って/.test(e.message)) { await sleep(retryQuestionMs); continue; } // 送りすぎの制限:少し待って、もう一度
          if (e.fromRelay) {
            state.deliveryError = e.message;
            const removed = keep(OUTBOX, load(OUTBOX, []).filter((x) => x.key !== item.key));
            notifyStatus();
            if (removed) continue; // 条件に合わない問いは、本文を保ったまま学習画面で直せる。
          }
          break; // 切れた・返事がない:つながったら、もう一度
        }
      }
    } finally { state.flushing = false; }
  }

  const noTeacher = () => Promise.reject(new Error('Bluetooth の端末では、先生の操作はできません'));
  const transport = {
    mode: 'ble',
    status, onStatus(cb) { statusCbs.add(cb); return () => statusCbs.delete(cb); },
    async connect() {
      if (state.closed) throw new Error('この接続は終了しています');
      if (!state.connected) { await link.connect(); await afterConnect(); }
    },
    async getClass(code) {
      let why = null;
      if (state.connected) {
        try { const c = await call('getClass', { code }); if (c) keep(CLASS(code), c); return c; } catch (e) { if (e.fromRelay) throw e; why = e; }
      }
      const cached = load(CLASS(code), null); // つながらないときは、前に入ったクラスなら、覚えているものを返す
      if (cached) return cached;
      throw why ?? new Error('先生のパソコンにつながっていません'); // 返事がなかったなら、その理由を返す
    },
    myUid() {
      let id = null;
      try { id = storage.getItem(UID); } catch { /* なくてもよい */ }
      if (!id) { id = `ble-${globalThis.crypto.randomUUID()}`; try { storage.setItem(UID, id); } catch { /* なくてもよい */ } }
      return id;
    },
    // 教材:前に届いたものを、すぐ出す → つながっていれば、いまの一覧が届いて更新される
    watchMaterials(code, cb) {
      const set = state.mat.get(code) ?? new Set(); state.mat.set(code, set); set.add(cb);
      const cached = load(CACHE(code), null); if (cached) cb(cached);
      if (state.connected) call('watchMaterials', { code }).catch(() => {});
      return () => { set.delete(cb); if (!set.size) { state.mat.delete(code); if (state.connected) call('unwatch', { kind: 'materials' }).catch(() => {}); } };
    },
    watchMyReplies(code, cb) {
      const set = state.rep.get(code) ?? new Set(); state.rep.set(code, set); set.add(cb);
      if (state.connected) call('watchReplies', { code, uid: transport.myUid() }).catch(() => {});
      return () => { set.delete(cb); if (!set.size) { state.rep.delete(code); if (state.connected) call('unwatch', { kind: 'replies' }).catch(() => {}); } };
    },
    // 質問:待たない(つながっていなくても、端末に積んで、つながったら届く)。Firebase 版と同じ
    async sendQuestion(code, q) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // 送ってよい項目だけにする(Firebase 版と同じ。null や、もとと同じ文は送らない)。質問の条件は、先生PCの側でも確かめる
      const item = { key, code, q: { ...questionFields(q), uid: transport.myUid() } };
      if (!keep(OUTBOX, [...load(OUTBOX, []), item])) throw new Error('送信待ちの問いをこの端末に保存できません');
      state.deliveryError = ''; notifyStatus();
      flushOutbox();
      return { queued: true };
    },
    async getIdToken() { return null; },
    // 先生の操作は、Bluetooth ではできない(先生の画面は、先生PC側から使う)
    createClass: noTeacher, publishMaterial: noTeacher, watchQuestions() { throw new Error('Bluetooth の端末では、先生の操作はできません'); },
    setQuestionStatus: noTeacher, updateQuestion: noTeacher, sendReply: noTeacher,
    close() { state.closed = true; link.close(); for (const [, w] of state.pending) clearTimeout(w.timer); state.pending.clear(); },
  };
  link.onDisconnect(lost);
  if (connectNow) await transport.connect();
  return transport;
}
