// Bluetooth 中継の、共通の部分(分割・組み立ての取り決め・教室のデータ・児童の端末の窓口)のテスト。Bluetooth の機器は使わない。
//   node --test tests/relay-core.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Framer, Reassembler, encodeMessage, decodeMessage, toBase64, fromBase64, HEADER_BYTES, MAX_MESSAGE_BYTES, SERVICE_UUID, RX_UUID, TX_UUID } from "../public/js/relay/protocol.js";
import { RoomStore, validateQuestion, isUid, randomCode } from "../public/js/relay/room-store.js";
import { RelayHub } from "../public/js/relay/hub.js";

// ---------- 分割と組み立て ----------
const bytesOf = (n, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);
const feed = (r, chunks) => { let out = null; for (const c of chunks) { const x = r.push(c); if (x.message) out = x.message; } return out; };

test("分割と組み立て:どんな大きさ・どんな chunk の大きさでも、元に戻る(日本語・空・ちょうど境目)", () => {
  const f = new Framer();
  for (const n of [0, 1, 14, 15, 16, 100, 175, 176, 177, 1000, 70000]) for (const max of [20, 21, 64, 180, 244, 512]) {
    const bytes = bytesOf(n);
    const chunks = f.split(bytes, max);
    assert.ok(chunks.every((c) => c.length <= max && c.length > HEADER_BYTES - 1), `大きさ n=${n} max=${max}`);
    assert.deepEqual(feed(new Reassembler(), chunks), bytes, `n=${n} max=${max}`);
  }
  const msg = { op: "sendQuestion", q: { seat: 3, text: "ふりこ🙂の周期は?\n改行も" } };
  const chunks = f.split(encodeMessage(msg), 20); // 日本語・絵文字の途中で chunk が切れる
  assert.ok(chunks.length > 4);
  assert.deepEqual(decodeMessage(feed(new Reassembler(), chunks)), msg);
});

test("組み立て:順番が入れかわっても・同じ chunk が2回来ても・2つのメッセージがまざっても、正しく組み立てる", () => {
  const f = new Framer(), a = bytesOf(500, 1), b = bytesOf(300, 2);
  const ca = f.split(a, 64), cb = f.split(b, 64);
  const mixed = []; for (let i = 0; i < Math.max(ca.length, cb.length); i++) { if (cb[i]) mixed.push(cb[i]); if (ca[i]) mixed.push(ca[i]); }
  const r = new Reassembler(); const got = [];
  for (const c of [...mixed, mixed[2], mixed[5]]) { const x = r.push(c); if (x.message) got.push(x.message); }
  assert.deepEqual(got.map((g) => g.length).sort(), [300, 500]);
  assert.deepEqual(got.find((g) => g.length === 500), a);
  // 逆順
  const rev = new Reassembler();
  assert.deepEqual(feed(rev, [...f.split(a, 64)].reverse()), a);
});

test("組み立て:でたらめな入力で、メモリを使いきらない(大きすぎる・古い・短い・同時に多すぎる・番号0)", () => {
  const f = new Framer();
  assert.throws(() => f.split(bytesOf(MAX_MESSAGE_BYTES + 1), 180), /大きすぎる/);
  assert.throws(() => f.split(bytesOf(10), 5), /小さすぎる/);
  // 受けた大きさが上限をこえたら捨てる
  const r = new Reassembler({ maxMessage: 100 });
  const chunks = f.split(bytesOf(300), 50);
  const results = chunks.map((c) => r.push(c));
  assert.ok(results.some((x) => /大きすぎる/.test(x.dropped ?? "")));
  assert.equal(r.open.size, 0);
  assert.match(r.push(new Uint8Array([1, 2])).dropped, /短すぎる/);
  assert.match(r.push(new Uint8Array([0, 0, 0, 0, 1, 9])).dropped, /番号が 0/);
  // 最後まで来ない途中のものは、時間がたつと捨てる
  let t = 0; const r2 = new Reassembler({ ttlMs: 1000, now: () => t });
  r2.push(f.split(bytesOf(100), 30)[0]);
  assert.equal(r2.open.size, 1); t = 5000; r2.push(f.split(bytesOf(10), 30)[0]);
  assert.ok(r2.open.size <= 1, "古い途中のものは消えている");
  // 同時に組み立てる数に上限がある
  const r3 = new Reassembler({ maxOpen: 3 });
  for (let i = 0; i < 20; i++) r3.push(f.split(bytesOf(100), 30)[0]);
  assert.ok(r3.open.size <= 3);
  // 欠けたまま終わりの chunk が来ても、完成させない
  const r4 = new Reassembler(); const cs = f.split(bytesOf(100), 30);
  assert.deepEqual(r4.push(cs.at(-1)), {}); assert.deepEqual(r4.push(cs[0]), {});
});

test("メッセージ番号は 1〜65535 をまわる。base64 は行き来できる。JSON でないものは読まない", () => {
  const f = new Framer(); f.nextId = 0xffff;
  const a = f.split(bytesOf(3), 20)[0], b = f.split(bytesOf(3), 20)[0];
  assert.equal(a[0] | (a[1] << 8), 0xffff); assert.equal(b[0] | (b[1] << 8), 1, "0 は飛ばして 1 にもどる");
  const raw = bytesOf(1000); assert.deepEqual(fromBase64(toBase64(raw)), raw);
  assert.throws(() => decodeMessage(new TextEncoder().encode("[1,2]")), /オブジェクト/);
  assert.throws(() => decodeMessage(new TextEncoder().encode("{")));
  assert.throws(() => decodeMessage(new Uint8Array([0xff, 0xfe, 0x00])));
  for (const u of [SERVICE_UUID, RX_UUID, TX_UUID]) assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set([SERVICE_UUID, RX_UUID, TX_UUID]).size, 3);
});

// ---------- 教室のデータ ----------
test("教室のデータ:クラス・教材・質問・返事。質問の条件は firestore.rules と同じ。返事は、宛先の端末だけが読める", () => {
  let t = 1000; const s = new RoomStore({ now: () => t++ });
  const code = s.createClass({ name: "5年2組", grade: 5 });
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.deepEqual({ ...s.getClass(code) }, { code, name: "5年2組", grade: 5, createdAt: s.getClass(code).createdAt });
  assert.equal(s.getClass("ZZZZZZ"), null);
  assert.throws(() => s.createClass({ name: "" }), /クラス名/); assert.throws(() => s.createClass({ name: "x", grade: 4 }), /学年/);
  const m1 = s.publishMaterial(code, { title: "ふりこ" }), m2 = s.publishMaterial(code, { title: "斜面" });
  assert.deepEqual(s.materials(code).map((m) => m.title), ["斜面", "ふりこ"], "新しい順");
  assert.ok(m1.id && m1.id !== m2.id);
  const uidA = "student-aaaaaaaa", uidB = "student-bbbbbbbb";
  const q = s.addQuestion(code, { seat: 3, text: "なぜ?", uid: uidA, aiTried: true });
  assert.equal(q.status, "new"); assert.ok(q.createdAt && q.id);
  for (const bad of [{ seat: 0, text: "x" }, { seat: 61, text: "x" }, { seat: 1.5, text: "x" }, { seat: 1, text: "" }, { seat: 1, text: "あ".repeat(201) }, { seat: 1, text: "x", extra: 1 }, { seat: 1, text: "x", status: "done" }, { seat: 1, text: "x", createdAt: 1 }, { seat: 1, text: "x", uid: "short" }, { seat: 1, text: "x", aiTried: "yes" }, { seat: 1, text: "x", materialTitle: "あ".repeat(61) }, null, "q"]) {
    assert.equal(validateQuestion(bad).ok, false, JSON.stringify(bad));
  }
  assert.throws(() => s.addQuestion("ZZZZZZ", { seat: 1, text: "x" }), /クラスが見つかりません/);
  // 先生は状態・関係の強さを変えられる。質問の文・番号・端末の番号は変えられない
  s.updateQuestion(code, q.id, { status: "done", relevance: "上", text: "書きかえ", seat: 9, uid: uidB });
  const got = s.questions(code)[0];
  assert.deepEqual({ status: got.status, relevance: got.relevance, text: got.text, seat: got.seat, uid: got.uid }, { status: "done", relevance: "上", text: "なぜ?", seat: 3, uid: uidA });
  s.addReply(code, { uid: uidA, text: "Aへ" }); s.addReply(code, { uid: uidB, text: "Bへ" });
  assert.deepEqual(s.repliesFor(code, uidA).map((r) => r.text), ["Aへ"]);
  assert.deepEqual(s.repliesFor(code, uidB).map((r) => r.text), ["Bへ"]);
  assert.deepEqual(s.repliesFor(code, "student-cccccccc"), []);
  assert.throws(() => s.addReply(code, { uid: "x", text: "y" }), /宛先/);
  assert.ok(isUid("abc-DEF_123") && !isUid("a b c d e f g h") && !isUid(123));
  assert.notEqual(randomCode(), randomCode());
});

test("教室のデータ:変わったことが知らせられ、保存して読みこみなおしても同じ", () => {
  const s = new RoomStore(); const seen = [];
  const off = s.onChange((code, kind) => seen.push(kind));
  const code = s.createClass({ name: "A" });
  s.publishMaterial(code, { title: "t" }); s.addQuestion(code, { seat: 1, text: "q" }); s.addReply(code, { uid: "student-aaaaaaaa", text: "r" });
  assert.deepEqual(seen, ["class", "materials", "questions", "replies"]);
  off(); s.publishMaterial(code, { title: "u" }); assert.equal(seen.length, 4, "解除したあとは知らせない");
  s.onChange(() => { throw new Error("知らせの失敗"); }); s.publishMaterial(code, { title: "v" }); // 知らせの失敗で、データは止まらない
  const back = RoomStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  assert.deepEqual(back.materials(code).map((m) => m.title).sort(), ["t", "u", "v"]);
  assert.equal(back.questions(code).length, 1); assert.equal(back.getClass(code).name, "A");
  assert.equal(RoomStore.fromJSON({ classes: [{ code: 1 }, null] }).classes.size, 0, "こわれたデータは読まない");
});

// ---------- 児童の端末の窓口 ----------
function setup(opt = {}) {
  let t = 100000; const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const store = new RoomStore({ now: clock.now }); const hub = new RelayHub({ store, now: clock.now, ...opt });
  const code = store.createClass({ name: "5年2組", grade: 6 });
  const connect = () => {
    const out = [];
    const session = hub.openSession((m) => out.push(m));
    let id = 0;
    const call = (op, rest = {}) => { const mid = ++id; session.receive({ id: mid, op, ...rest }); return out.find((m) => m.id === mid); };
    return { session, out, call, pushes: () => out.filter((m) => m.push) };
  };
  return { store, hub, code, connect, clock };
}
const UID_A = "student-aaaaaaaa", UID_B = "student-bbbbbbbb";

test("窓口:クラスコードの確認・教材を見る(いまある分がすぐ届き、あとから配信した分も届く)", () => {
  const { store, code, connect, hub } = setup();
  store.publishMaterial(code, { title: "ふりこ" });
  const c = connect();
  assert.deepEqual(c.call("getClass", { code }).result, { name: "5年2組", grade: 6 });
  assert.equal(c.call("getClass", { code: "ZZZZZZ" }).result, null);
  assert.equal(c.call("getClass", { code: 123 }).result, null);
  assert.equal(c.call("watchMaterials", { code: "ZZZZZZ" }).ok, false);
  assert.equal(c.call("watchMaterials", { code }).ok, true);
  assert.deepEqual(c.pushes().map((p) => [p.push, p.list.map((m) => m.title)]), [["materials", ["ふりこ"]]]);
  store.publishMaterial(code, { title: "斜面" });
  assert.deepEqual(c.pushes().at(-1).list.map((m) => m.title), ["斜面", "ふりこ"]);
  assert.equal(hub.sessionCount, 1);
  c.call("unwatch", { kind: "materials" }); const n = c.pushes().length;
  store.publishMaterial(code, { title: "もう届かない" }); assert.equal(c.pushes().length, n);
  c.session.close(); assert.equal(hub.sessionCount, 0);
  const other = store.createClass({ name: "別のクラス" }); const d = connect();
  d.call("watchMaterials", { code: other }); store.publishMaterial(code, { title: "別のクラスの教材" });
  assert.ok(!d.pushes().some((p) => p.list.some((m) => m.title === "別のクラスの教材")), "ほかのクラスの教材は届かない");
});

test("窓口:返事は、宛先の端末にだけ届く。ほかの端末には届かない", () => {
  const { store, code, connect } = setup();
  const a = connect(), b = connect();
  assert.equal(a.call("watchReplies", { code, uid: "short" }).ok, false);
  a.call("watchReplies", { code, uid: UID_A }); b.call("watchReplies", { code, uid: UID_B });
  store.addReply(code, { uid: UID_A, text: "Aさんへ" });
  assert.deepEqual(a.pushes().at(-1).list.map((r) => r.text), ["Aさんへ"]);
  assert.deepEqual(b.pushes().at(-1).list, [], "Bには、Aあての返事は入らない");
});

test("窓口:質問を送れる。条件に合わないもの・短い間にたくさん・上限をこえたものは断る。教室の質問に入る", () => {
  const { store, code, connect, clock } = setup({ questionIntervalMs: 1500, maxQuestionsPerSession: 3 });
  const c = connect();
  const ok = c.call("sendQuestion", { code, q: { seat: 4, text: "なぜ?", uid: UID_A } });
  assert.equal(ok.ok, true);
  assert.equal(store.questions(code)[0].text, "なぜ?");
  assert.equal(c.call("sendQuestion", { code, q: { seat: 4, text: "すぐもう1つ", uid: UID_A } }).ok, false, "間があかないと断る");
  clock.advance(2000);
  const bad = c.call("sendQuestion", { code, q: { seat: 99, text: "x" } });
  assert.equal(bad.ok, false); assert.match(bad.error, /出席番号/);
  assert.equal(c.call("sendQuestion", { code, q: { seat: 4, text: "x", status: "done" } }).ok, false, "ほかの項目は入れられない");
  assert.equal(c.call("sendQuestion", { code: "ZZZZZZ", q: { seat: 1, text: "x" } }).ok, false);
  for (let i = 0; i < 2; i++) { clock.advance(2000); assert.equal(c.call("sendQuestion", { code, q: { seat: 4, text: `q${i}` } }).ok, true); }
  clock.advance(2000);
  const many = c.call("sendQuestion", { code, q: { seat: 4, text: "4つめ" } });
  assert.equal(many.ok, false); assert.match(many.error, /送りすぎ/);
  assert.equal(store.questions(code).length, 3);
});

test("窓口:先生の操作・知らない操作は、断る。でたらめなメッセージで落ちない", () => {
  const { store, code, connect } = setup();
  const c = connect();
  for (const op of ["createClass", "publishMaterial", "updateQuestion", "sendReply", "listClasses", "watchQuestions", "__proto__", "constructor"]) {
    const r = c.call(op, { code, name: "x" });
    assert.equal(r.ok, false, op); assert.match(r.error, /できません/);
  }
  assert.equal(store.materials(code).length, 0); assert.equal(store.listClasses().length, 1);
  const before = c.out.length;
  for (const bad of [null, undefined, 1, "x", [], {}, { id: "a", op: "ping" }, { id: -1, op: "ping" }, { id: 1.5, op: "ping" }, { id: 1, op: 5 }]) c.session.receive(bad);
  assert.equal(c.out.length, before, "形がおかしいものには、返事をしない");
  assert.equal(c.call("ping").ok, true, "そのあとも使える");
  c.session.close(); c.session.receive({ id: 9, op: "ping" }); // 閉じたあとは、何もしない
});

test("窓口:長い一覧は、上限をこえないように分けて送る。分けた全部で、元の一覧になる", () => {
  const { store, code, connect } = setup({ maxBatchBytes: 2000 });
  for (let i = 0; i < 30; i++) store.publishMaterial(code, { title: `教材${i}`, explanation: "あ".repeat(200) });
  const c = connect(); c.call("watchMaterials", { code });
  const ps = c.pushes();
  assert.ok(ps.length > 5 && ps.every((p) => p.parts === ps.length && p.seq === ps[0].seq));
  assert.deepEqual(ps.map((p) => p.part), ps.map((_, i) => i));
  assert.ok(ps.every((p) => new TextEncoder().encode(JSON.stringify(p.list)).length <= 2000 + 800), "1つの大きさが、ほぼ上限");
  assert.equal(ps.flatMap((p) => p.list).length, 30);
  assert.equal(new Set(ps.flatMap((p) => p.list).map((m) => m.id)).size, 30);
  // 空の一覧も、1つの push で届く
  const e = connect(); const other = store.createClass({ name: "空" }); e.call("watchMaterials", { code: other });
  assert.deepEqual(e.pushes().map((p) => [p.parts, p.list.length]), [[1, 0]]);
});

test("窓口:つながっている端末の数が、クラスごとに先生の画面へ知らされる", () => {
  const { code, connect, hub } = setup();
  const seen = []; hub.onSessionsChange((n, by) => seen.push([n, { ...by }]));
  const a = connect(); a.call("watchMaterials", { code }); const b = connect(); b.call("watchMaterials", { code });
  assert.deepEqual(seen.at(-1), [2, { [code]: 2 }]);
  a.session.close(); assert.deepEqual(seen.at(-1), [1, { [code]: 1 }]);
  b.session.close(); assert.deepEqual(seen.at(-1), [0, {}]);
});


test('長い根拠データ:新しい断片が届き続ける転送は、開始からTTLを越えても組み立てられる', () => {
  let t=0; const re=new Reassembler({ttlMs:1000,now:()=>t});
  const value={op:'sendQuestion',q:{seat:1,text:'比較した結果は？',inquiryContext:'根拠'.repeat(1500)}};
  const framer=new Framer();let result;
  for(const c of framer.split(encodeMessage(value),180)){t+=400;const r=re.push(c);if(r.message)result=decodeMessage(r.message);}
  assert.ok(t>1000);assert.deepEqual(result,value);
});
// ---------- オンラインと併用するための、クラスのコード・教材の id ----------
test("併用:クラスを、決めたコードで作れる(オンラインのクラスと同じコード)。もうあるコードなら、何も変えない。コードの形がおかしければ断る", () => {
  const s = new RoomStore();
  assert.equal(s.createClass({ name: "5年2組", grade: 5, code: "ABC234" }), "ABC234");
  assert.deepEqual({ name: s.getClass("ABC234").name, grade: s.getClass("ABC234").grade }, { name: "5年2組", grade: 5 });
  // 同じコードでもう一度(先生の画面を開くたびに呼ぶ):ふえない・名前も変わらない・知らせも出ない
  const seen = []; s.onChange((c, k) => seen.push(k));
  assert.equal(s.createClass({ name: "別の名前", grade: 6, code: "ABC234" }), "ABC234");
  assert.equal(s.getClass("ABC234").name, "5年2組"); assert.equal(s.classes.size, 1); assert.deepEqual(seen, []);
  for (const bad of ["abc234", "AB", "ABCDEFGHI", "AB C23", "ＡＢＣ２３４", 123, ""]) assert.throws(() => s.createClass({ name: "x", code: bad }), /クラスコード/, String(bad));
  assert.match(s.createClass({ name: "コードなし" }), /^[A-HJ-NP-Z2-9]{6}$/, "コードを決めなければ、これまでどおり");
});

test("併用:教材を、決めた id と配信時刻で入れられる(オンラインと同じ教材ID)。同じ id は二重に入らない。形のおかしい id は断る", () => {
  const s = new RoomStore({ now: () => 5000 }); const code = s.createClass({ name: "A", code: "ABC234" });
  const a = s.publishMaterial(code, { id: "mat-1", title: "ふりこ", publishedAt: 1234 });
  assert.deepEqual({ id: a.id, publishedAt: a.publishedAt }, { id: "mat-1", publishedAt: 1234 });
  const seen = []; s.onChange((c, k) => seen.push(k));
  const again = s.publishMaterial(code, { id: "mat-1", title: "書きかえようとした" });
  assert.equal(again.title, "ふりこ"); assert.equal(s.materials(code).length, 1); assert.deepEqual(seen, [], "二重には入らず、知らせも出ない");
  assert.equal(s.publishMaterial(code, { title: "id なし" }).publishedAt, 5000, "id がなければ、これまでどおり新しい id と今の時刻");
  for (const bad of ["", "a b", "あ", "x".repeat(101), 5, null]) assert.throws(() => s.publishMaterial(code, { id: bad, title: "x" }), /id がおかしい/, String(bad));
  assert.equal(s.materials(code).length, 2);
});
