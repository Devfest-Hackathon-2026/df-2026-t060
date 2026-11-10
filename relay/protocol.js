// Bluetooth(BLE の GATT)で、先生PCの中継アプリと、児童の端末(Web Bluetooth)が話すための取り決め。ブラウザと Node の両方で使う。
//
// BLE の1回で送れるのは、数十〜数百バイトだけ。長いメッセージ(教材は数十KB)は、小さく分けて(chunk)送り、受けた側で組み立てる。
//   メッセージ = UTF-8 の JSON(1つの JSON オブジェクト)
//   chunk      = [メッセージ番号 u16][何番目か u16][フラグ u8][中身…]   (ヘッダ 5 バイト。数は little endian)
//                フラグの bit0 = 最後の chunk
// GATT のしくみ(先生PCが「ペリフェラル」=待ち受ける側。児童の端末がセントラル):
//   サービス SERVICE_UUID の中に、2つの特性(characteristic)
//     RX_UUID(Write / WriteWithoutResponse):児童 → 先生PC。chunk を1つずつ書く
//     TX_UUID(Notify):先生PC → 児童。chunk を1つずつ通知する(先生PCの中継アプリが、接続ごとの最大サイズに合わせて分ける)

export const SERVICE_UUID = '6c2f0001-8a4e-4b1d-9d3a-7f5e2c1b0a90';
export const RX_UUID = '6c2f0002-8a4e-4b1d-9d3a-7f5e2c1b0a90';
export const TX_UUID = '6c2f0003-8a4e-4b1d-9d3a-7f5e2c1b0a90';
/** 児童の端末に見える、先生PCの名前の頭(例:KyozaiRelay-ABC) */
export const DEVICE_NAME_PREFIX = 'KyozaiRelay';

export const HEADER_BYTES = 5;
export const MAX_MESSAGE_BYTES = 256 * 1024;
/** 児童 → 先生PC に書く chunk の大きさ(ヘッダ込み)。BLE の最小の MTU(23)でも「長い書きこみ」で送れる大きさ */
export const WRITE_CHUNK_BYTES = 180;
/** 先生PC → 児童 の chunk は、中継アプリが知らせる「1回の通知で送れる大きさ」(mtu)に合わせる。知らせがなければ、これを使う */
export const DEFAULT_NOTIFY_BYTES = 20;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export const encodeMessage = (obj) => enc.encode(JSON.stringify(obj));
/** @returns {object} 読めなければ例外 */
export function decodeMessage(bytes) {
  const v = JSON.parse(dec.decode(bytes));
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('メッセージが JSON のオブジェクトではない');
  return v;
}

/** バイト列 ⇄ base64(中継アプリとの行区切り JSON で使う) */
export function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(str) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(str), 'base64'));
  const s = atob(String(str));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** メッセージ(バイト列)を、maxChunk バイト以下の chunk に分ける */
export class Framer {
  constructor() { this.nextId = 1; }
  /** @param {Uint8Array} bytes  @param {number} maxChunk  ヘッダ込みの最大(最小 HEADER_BYTES + 1) @returns {Uint8Array[]} */
  split(bytes, maxChunk) {
    if (!(maxChunk > HEADER_BYTES)) throw new Error(`chunk の大きさが小さすぎる(${maxChunk})`);
    if (bytes.length > MAX_MESSAGE_BYTES) throw new Error(`メッセージが大きすぎる(${bytes.length} バイト。上限 ${MAX_MESSAGE_BYTES})`);
    const id = this.nextId;
    this.nextId = this.nextId >= 0xffff ? 1 : this.nextId + 1; // 0 は使わない
    const room = maxChunk - HEADER_BYTES;
    const n = Math.max(1, Math.ceil(bytes.length / room));
    if (n > 0xffff) throw new Error('chunk の数が多すぎる');
    const out = [];
    for (let i = 0; i < n; i++) {
      const body = bytes.subarray(i * room, (i + 1) * room);
      const c = new Uint8Array(HEADER_BYTES + body.length);
      c[0] = id & 0xff; c[1] = id >> 8; c[2] = i & 0xff; c[3] = i >> 8;
      c[4] = i === n - 1 ? 1 : 0;
      c.set(body, HEADER_BYTES);
      out.push(c);
    }
    return out;
  }
}

/**
 * chunk を受けて、メッセージに組み立てる。BLE は順番どおりに届くが、重複・欠け・でたらめな入力にも耐える
 * (メモリを使いすぎない:同時に組み立てるのは 8 つまで、1つの大きさは上限まで、古いものは捨てる)。
 */
export class Reassembler {
  constructor({ maxMessage = MAX_MESSAGE_BYTES, ttlMs = 15000, maxOpen = 8, now = Date.now } = {}) {
    Object.assign(this, { maxMessage, ttlMs, maxOpen, now });
    this.open = new Map(); // メッセージ番号 → { parts: Map(index→bytes), lastIndex, size, t0 }
    this.dead = new Map(); // 捨てたメッセージの番号 → 捨てた時刻。残りの chunk が来ても、また組み立て始めない
  }
  /** @returns {{message?: Uint8Array, dropped?: string}}  まだ途中なら {}。捨てたときは理由 */
  push(chunk) {
    if (!(chunk instanceof Uint8Array) || chunk.length < HEADER_BYTES) return { dropped: 'chunk が短すぎる' };
    const t = this.now();
    for (const [id, m] of this.open) if (t - m.t0 > this.ttlMs) this.open.delete(id); // 受信が途切れた途中のものを捨てる
    for (const [id, t0] of this.dead) if (t - t0 > this.ttlMs) this.dead.delete(id);
    const id = chunk[0] | (chunk[1] << 8), index = chunk[2] | (chunk[3] << 8), last = (chunk[4] & 1) === 1;
    if (id === 0) return { dropped: 'メッセージ番号が 0' };
    if (this.dead.has(id)) { if (last) this.dead.delete(id); return {}; } // 捨てたメッセージの残り
    let m = this.open.get(id);
    if (!m) {
      if (this.open.size >= this.maxOpen) this.open.delete(this.open.keys().next().value); // いちばん古いものを捨てる
      m = { parts: new Map(), lastIndex: null, size: 0, t0: t };
      this.open.set(id, m);
    }
    if (!m.parts.has(index)) { m.parts.set(index, chunk.subarray(HEADER_BYTES)); m.size += chunk.length - HEADER_BYTES; m.t0 = t; } // 新しい断片が届く間は受信期限を延長する
    if (last) m.lastIndex = index;
    if (m.size > this.maxMessage) {
      this.open.delete(id);
      if (!last) { this.dead.set(id, t); if (this.dead.size > 64) this.dead.delete(this.dead.keys().next().value); }
      return { dropped: `メッセージが大きすぎる(${m.size} バイトをこえた)` };
    }
    if (m.lastIndex === null || m.parts.size !== m.lastIndex + 1) return {};
    // 0..lastIndex が全部そろった
    const out = new Uint8Array(m.size);
    let p = 0;
    for (let i = 0; i <= m.lastIndex; i++) {
      const part = m.parts.get(i);
      if (!part) { this.open.delete(id); return { dropped: 'chunk が欠けている' }; }
      out.set(part, p); p += part.length;
    }
    this.open.delete(id);
    return { message: out };
  }
}
