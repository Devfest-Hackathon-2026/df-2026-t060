// 教室のデータ(クラス・教材・質問・返事)を、先生PCの中に持つ。Firestore のかわりをする(Bluetooth の教室用)。
// データの形は、Firestore 版(README の「データの形」)と同じ。質問を受けつける条件も、firestore.rules と同じにする。
// ブラウザと Node の両方で使える(ファイルへの保存は、使う側が toJSON/fromJSON でする)。

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 読みまちがえやすい I O 0 1 は使わない
export function randomCode(n = 6) {
  const a = new Uint32Array(n);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}
const newId = () => globalThis.crypto.randomUUID();

/** 児童の端末の番号(質問に付く。返事をその児童だけに返すのに使う)。短すぎる・変な文字は断る */
// 新しい順(同じミリ秒に入ったものは、あとから入れたほうを先に)
const newestFirst = (arr, key) => arr.map((x, i) => [x, i]).sort((a, b) => b[0][key] - a[0][key] || b[1] - a[1]).map(([x]) => x);

export const isUid = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(v);

/**
 * 児童が送る質問を確かめる(firestore.rules の questions の create と同じ条件)。
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function validateQuestion(q) {
  if (!q || typeof q !== 'object') return { ok: false, error: '質問の形がおかしい' };
  const allowed = new Set(['seat', 'text', 'uid', 'aiTried', 'materialTitle', 'original', 'inquiryContext']);
  for (const k of Object.keys(q)) if (!allowed.has(k)) return { ok: false, error: `質問に入れられない項目:${k}` };
  if (!Number.isInteger(q.seat) || q.seat < 1 || q.seat > 60) return { ok: false, error: '出席番号は 1〜60' };
  if (typeof q.text !== 'string' || q.text.length < 1 || q.text.length > 200) return { ok: false, error: '質問は 1〜200 字' };
  if ('aiTried' in q && typeof q.aiTried !== 'boolean') return { ok: false, error: 'aiTried がおかしい' };
  if ('materialTitle' in q && !(typeof q.materialTitle === 'string' && q.materialTitle.length <= 60)) return { ok: false, error: '教材の題は 60 字まで' };
  if ('original' in q && !(typeof q.original === 'string' && q.original.length <= 200)) return { ok: false, error: 'もとの言い方は 200 字まで' };
  if ('inquiryContext' in q && (typeof q.inquiryContext !== 'string' || q.inquiryContext.length > 40000)) return { ok: false, error: '根拠データは40000字以内' };
  if ('uid' in q && !isUid(q.uid)) return { ok: false, error: '端末の番号がおかしい' };
  return { ok: true, value: { ...q } };
}

export class RoomStore {
  /** @param {{now?: () => number, code?: () => string}} [opt] */
  constructor({ now = Date.now, code = randomCode } = {}) {
    this.now = now; this.newCode = code;
    this.classes = new Map(); // code → { code, name, grade, createdAt, materials: [], questions: [], replies: [] }
    this.listeners = new Set();
  }

  // ---- 変わったことを知らせる(画面・Bluetooth の児童の端末に、すぐ届けるため) ----
  /** @param {(code: string, kind: 'materials'|'questions'|'replies'|'class') => void} fn @returns {() => void} */
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #emit(code, kind) { for (const fn of this.listeners) { try { fn(code, kind); } catch { /* 知らせの失敗で、教室のデータを止めない */ } } }

  #room(code) {
    const r = this.classes.get(code);
    if (!r) throw new Error('クラスが見つかりません');
    return r;
  }

  /**
   * クラスをつくる。code を決めると、そのコードで作る(オンライン(Firestore)のクラスと、同じコードの教室にするため)。
   * そのコードの教室がもうあれば、何も変えず、そのコードを返す(何回よんでも同じ:ふやさない・名前を書きかえない)。
   */
  createClass({ name, grade, code: want }) {
    if (typeof name !== 'string' || !name.trim() || name.length > 40) throw new Error('クラス名は 1〜40 字');
    if (grade !== undefined && grade !== null && !(Number.isInteger(grade) && grade >= 5 && grade <= 9)) throw new Error('学年は 5〜9(小5〜中3)');
    if (want !== undefined && want !== null) {
      if (typeof want !== 'string' || !/^[A-Z0-9]{4,8}$/.test(want)) throw new Error('クラスコードは 英大文字と数字の 4〜8 字');
      if (this.classes.has(want)) return want;
      this.classes.set(want, { code: want, name: name.trim(), grade: grade ?? null, createdAt: this.now(), materials: [], questions: [], replies: [] });
      this.#emit(want, 'class');
      return want;
    }
    let code;
    for (let i = 0; i < 20; i++) { code = this.newCode(); if (!this.classes.has(code)) break; code = null; }
    if (!code) throw new Error('クラスコードを作れませんでした');
    this.classes.set(code, { code, name: name.trim(), grade: grade ?? null, createdAt: this.now(), materials: [], questions: [], replies: [] });
    this.#emit(code, 'class');
    return code;
  }
  getClass(code) {
    const r = this.classes.get(code);
    return r ? { code: r.code, name: r.name, grade: r.grade, createdAt: r.createdAt } : null;
  }
  listClasses() { return [...this.classes.values()].map((r) => this.getClass(r.code)).sort((a, b) => b.createdAt - a.createdAt); }

  // ---- 教材 ----
  publishMaterial(code, m) {
    const r = this.#room(code);
    if (!m || typeof m !== 'object') throw new Error('教材の形がおかしい');
    // id を決めて入れると、同じ id がもうあるときは、何もしない(オンラインにも同じ教材を配信しているとき、二重に入らない)
    const id = m.id === undefined ? newId() : m.id;
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) throw new Error('教材の id がおかしい');
    const had = r.materials.find((x) => x.id === id);
    if (had) return had;
    const publishedAt = Number.isFinite(m.publishedAt) ? m.publishedAt : this.now();
    const item = { ...m, id, publishedAt };
    r.materials.push(item);
    this.#emit(code, 'materials');
    return item;
  }
  materials(code) { return newestFirst(this.#room(code).materials, 'publishedAt'); }

  // ---- 質問 ----
  addQuestion(code, q) {
    const r = this.#room(code);
    const v = validateQuestion(q);
    if (!v.ok) throw new Error(v.error);
    const item = { ...v.value, id: newId(), status: 'new', createdAt: this.now() };
    r.questions.push(item);
    this.#emit(code, 'questions');
    return item;
  }
  questions(code) { return newestFirst(this.#room(code).questions, 'createdAt'); }
  /** 先生が、質問の状態・関係の強さなどを変える(質問そのものの文・番号は変えられない) */
  updateQuestion(code, id, fields) {
    const q = this.#room(code).questions.find((x) => x.id === id);
    if (!q) throw new Error('質問が見つかりません');
    const locked = new Set(['id', 'seat', 'text', 'uid', 'createdAt', 'original']);
    for (const [k, v] of Object.entries(fields ?? {})) if (!locked.has(k)) q[k] = v;
    this.#emit(code, 'questions');
    return q;
  }

  // ---- 先生から1人の児童への返事 ----
  addReply(code, r0) {
    const r = this.#room(code);
    if (!r0 || !isUid(r0.uid)) throw new Error('返事の宛先(uid)がおかしい');
    const item = { ...r0, id: newId(), createdAt: this.now() };
    r.replies.push(item);
    this.#emit(code, 'replies');
    return item;
  }
  /** その児童(uid)あての返事だけ */
  repliesFor(code, uid) { return newestFirst(this.#room(code).replies.filter((x) => x.uid === uid), 'createdAt'); }

  // ---- 保存・読みこみ(ファイルに書くのは、使う側) ----
  toJSON() { return { version: 1, classes: [...this.classes.values()] }; }
  static fromJSON(json, opt) {
    const s = new RoomStore(opt);
    for (const r of json?.classes ?? []) {
      if (typeof r?.code === 'string' && typeof r.name === 'string') {
        s.classes.set(r.code, { code: r.code, name: r.name, grade: r.grade ?? null, createdAt: r.createdAt ?? 0, materials: r.materials ?? [], questions: r.questions ?? [], replies: r.replies ?? [] });
      }
    }
    return s;
  }
}
