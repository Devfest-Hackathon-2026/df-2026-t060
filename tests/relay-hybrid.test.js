// 併用(先生はオンライン + 児童はオンラインか Bluetooth)の通信層(relay/transport-hybrid.js)のテスト。
// オンライン(Firestore)と、先生PCの Bluetooth 教室は、同じ形の偽物(この中のメモリ)で動かす。本物の Bluetooth・Firebase は使わない。
//   node --test tests/relay-hybrid.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomStore } from "../public/js/relay/room-store.js";
import { RelayHub } from "../public/js/relay/hub.js";
import { createHybridTeacherTransport } from "../public/js/relay/transport-hybrid.js";

const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`時間内に条件にならなかった:${fn}`); await new Promise((r) => setTimeout(r, 5)); } };

/** オンライン(Firestore)のまね:transport.js と同じ形 */
function fakeOnline() {
  const classes = new Map(); const subs = new Set(); let n = 0, tick = 1000;
  const notify = (code, kind) => { for (const s of subs) if (s.code === code && s.kind === kind) s.fn(); };
  const room = (code) => { const r = classes.get(code); if (!r) throw new Error("クラスが見つかりません"); return r; };
  const on = { mode: "firebase", fail: false, calls: [], classes };
  Object.assign(on, {
    async createClass(name, grade) { const code = `ONL${String(++n).padStart(3, "0")}`; classes.set(code, { name, grade, materials: [], questions: [], replies: [] }); return code; },
    async getClass(code) { const r = classes.get(code); return r ? { name: r.name, grade: r.grade, mine: true } : null; },
    async publishMaterial(code, m, { id } = {}) { if (on.fail) throw new Error("ネットが切れている"); const item = { ...m, id: id ?? `auto-${++n}`, publishedAt: ++tick }; room(code).materials.push(item); notify(code, "materials"); return { id: item.id, publishedAt: item.publishedAt }; },
    watchMaterials(code, cb) { const s = { code, kind: "materials", fn: () => cb([...room(code).materials].sort((a, b) => b.publishedAt - a.publishedAt)) }; subs.add(s); s.fn(); return () => subs.delete(s); },
    watchQuestions(code, cb) { const s = { code, kind: "questions", fn: () => cb([...room(code).questions].sort((a, b) => b.createdAt - a.createdAt)) }; subs.add(s); s.fn(); return () => subs.delete(s); },
    async updateQuestion(code, id, fields) { on.calls.push(["updateQuestion", id, fields]); Object.assign(room(code).questions.find((q) => q.id === id), fields); notify(code, "questions"); },
    async sendReply(code, r) { on.calls.push(["sendReply", r.uid]); room(code).replies.push({ ...r, id: `r${++n}` }); },
    teacherState: () => ({ kind: "google", name: "先生", uid: "g1" }), async getIdToken() { return "tok"; }, myUid: () => "g1", async listMyClasses() { return []; },
    /** オンラインの児童が、質問を送る */
    ask(code, text, createdAt) { room(code).questions.push({ id: `oq${++n}`, seat: 1, text, uid: "online-student-uid", status: "new", createdAt }); notify(code, "questions"); },
  });
  return on;
}

/** transport-local.js(先生PCのサーバー)のまね:HTTP のかわりに、教室のデータ(RoomStore)を直接使う */
function fakeLocal(store, hub) {
  const l = { down: false, calls: [] };
  const guard = () => { if (l.down) throw new Error("つながりません"); };
  Object.assign(l, {
    async status() { guard(); return { enabled: true }; },
    async createClass(name, grade, { code } = {}) { guard(); l.calls.push(["createClass", code]); return store.createClass({ name, grade, code }); },
    async publishMaterial(code, m, { id, publishedAt } = {}) { guard(); l.calls.push(["publishMaterial", id]); const it = store.publishMaterial(code, { ...m, ...(id ? { id } : {}), ...(publishedAt !== undefined ? { publishedAt } : {}) }); return { id: it.id, publishedAt: it.publishedAt }; },
    watchQuestions(code, cb) { const send = () => cb(store.questions(code)); const off = store.onChange((c, k) => { if (c === code && k === "questions") send(); }); send(); return off; },
    watchStudents(code, cb) { cb({ count: 0 }); return hub.onSessionsChange((n, by) => cb({ count: by[code] ?? 0, total: n })); },
    async updateQuestion(code, id, fields) { guard(); l.calls.push(["updateQuestion", id]); store.updateQuestion(code, id, fields); },
    async sendReply(code, r) { guard(); l.calls.push(["sendReply", r.uid]); store.addReply(code, r); },
  });
  return l;
}

/** Bluetooth の児童の端末(窓口につながった1台) */
function bleStudent(hub) {
  const out = []; const session = hub.openSession((m) => out.push(m)); let id = 0;
  const call = (op, rest = {}) => { const mid = ++id; session.receive({ id: mid, op, ...rest }); return out.find((m) => m.id === mid); };
  const lists = (kind) => out.filter((m) => m.push === kind);
  return { out, call, session, latest: (kind) => lists(kind).at(-1)?.list ?? null };
}

async function world({ relayDown = false } = {}) {
  const store = new RoomStore(); const hub = new RelayHub({ store, questionIntervalMs: 0 });
  const online = fakeOnline(); const local = fakeLocal(store, hub); local.down = relayDown;
  const t = await createHybridTeacherTransport({ online, local, probeMs: 200 });
  return { store, hub, online, local, t };
}

test("クラスをつくると、オンラインと同じコードの教室が、Bluetooth 教室にもできる(名前・学年も同じ)。クラスを開いても、ふえない", async () => {
  const w = await world();
  assert.equal(w.t.bluetooth.available, true); assert.equal(w.t.hybrid, true); assert.equal(w.t.mode, "firebase");
  const code = await w.t.createClass("5年2組 理科", 6);
  await until(() => w.store.getClass(code));
  assert.deepEqual({ name: w.store.getClass(code).name, grade: w.store.getClass(code).grade }, { name: "5年2組 理科", grade: 6 });
  // 前にオンラインで作ったクラスを、あとから開く:Bluetooth 教室にも、同じコードの教室ができる
  const old = w.online.classes.set("OLD234", { name: "前のクラス", grade: 5, materials: [], questions: [], replies: [] }) && "OLD234";
  assert.ok((await w.t.getClass(old)).mine);
  await until(() => w.store.getClass(old));
  await w.t.getClass(old); await w.t.getClass(old);
  assert.equal(w.local.calls.filter((c) => c[0] === "createClass" && c[1] === old).length, 1, "何回開いても、1回だけ用意する");
  assert.equal(w.store.classes.size, 2);
});

test("配信:オンラインと Bluetooth 教室の両方に、同じ教材 id で届く。Bluetooth の児童にも、すぐ届く。二重にならない", async () => {
  const w = await world(); const code = await w.t.createClass("A", 5);
  const kid = bleStudent(w.hub); kid.call("watchMaterials", { code });
  const mats = []; w.t.watchMaterials(code, (l) => mats.push(l.map((m) => m.title)));
  const r = await w.t.publishMaterial(code, { title: "ふりこ", explanation: "e", sim: null, quiz: [] });
  assert.equal(r.online, true); assert.equal(r.bluetooth, true);
  const onlineIds = w.online.classes.get(code).materials.map((m) => m.id), bleIds = w.store.materials(code).map((m) => m.id);
  assert.deepEqual(onlineIds, [r.id]); assert.deepEqual(bleIds, [r.id], "同じ教材 id");
  await until(() => kid.latest("materials")?.length === 1);
  assert.equal(kid.latest("materials")[0].title, "ふりこ");
  // オンラインの一覧が更新されて返ってきても、Bluetooth 教室には、2回目を入れない(id が同じ)
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(w.local.calls.filter((c) => c[0] === "publishMaterial").length, 1, "教材の書きこみは1回だけ");
  assert.equal(w.store.materials(code).length, 1);
  assert.deepEqual(mats.at(-1), ["ふりこ"]);
});

test("あとから開いたクラス:オンラインにすでにある教材を、Bluetooth 教室にも写す(同じ id・同じ配信時刻・古い順)。何回見ても、ふえない", async () => {
  const w = await world();
  w.online.classes.set("OLD234", { name: "前のクラス", grade: 5, materials: [], questions: [], replies: [] });
  await w.online.publishMaterial("OLD234", { title: "1つめ" }, { id: "m-1" });
  await w.online.publishMaterial("OLD234", { title: "2つめ" }, { id: "m-2" });
  await w.t.getClass("OLD234");
  w.t.watchMaterials("OLD234", () => {});
  await until(() => w.store.getClass("OLD234") && w.store.materials("OLD234").length === 2);
  assert.deepEqual(w.store.materials("OLD234").map((m) => [m.id, m.title]), [["m-2", "2つめ"], ["m-1", "1つめ"]], "新しい順(配信時刻が同じ並び)");
  const pubs = w.online.classes.get("OLD234").materials.map((m) => m.publishedAt);
  assert.deepEqual(w.store.materials("OLD234").map((m) => m.publishedAt).sort(), [...pubs].sort(), "配信時刻も写る");
  // Bluetooth の児童が、あとから入っても、全部見える
  const kid = bleStudent(w.hub); kid.call("watchMaterials", { code: "OLD234" });
  assert.equal(kid.latest("materials").length, 2);
  await w.online.publishMaterial("OLD234", { title: "3つめ" }, { id: "m-3" });
  await until(() => w.store.materials("OLD234").length === 3);
  assert.equal(w.local.calls.filter((c) => c[0] === "publishMaterial").length, 3, "写したのは3つだけ(見るたびに、写し直さない)");
});

test("質問:オンラインの児童と Bluetooth の児童の質問が、1つの一覧に(新しい順・via つき)。印・関係の強さは、その質問のある側へ", async () => {
  const w = await world(); const code = await w.t.createClass("A", 5);
  const seen = []; w.t.watchQuestions(code, (l) => seen.push(l));
  const kid = bleStudent(w.hub);
  w.online.ask(code, "オンラインの質問", Date.now() - 5000);
  assert.equal(kid.call("sendQuestion", { code, q: { seat: 7, text: "Bluetoothの質問", uid: "ble-aaaaaaaa-1111" } }).ok, true);
  await until(() => seen.at(-1)?.length === 2);
  const list = seen.at(-1);
  assert.deepEqual(list.map((q) => [q.text, q.via]), [["Bluetoothの質問", "ble"], ["オンラインの質問", "online"]], "新しい順");
  // 印をつける:Bluetooth の質問 → 先生PC、オンラインの質問 → オンライン
  await w.t.setQuestionStatus(code, list[0].id, "done");
  await w.t.updateQuestion(code, list[1].id, { relevance: "上" });
  assert.equal(w.store.questions(code)[0].status, "done"); assert.deepEqual(w.local.calls.filter((c) => c[0] === "updateQuestion").length, 1);
  assert.deepEqual(w.online.calls.filter((c) => c[0] === "updateQuestion").map((c) => c[2]), [{ relevance: "上" }]);
  await until(() => seen.at(-1).find((q) => q.via === "ble")?.status === "done");
});

test("返事:Bluetooth の児童(uid が ble- で始まる)には先生PCの教室へ、オンラインの児童にはオンラインへ。Bluetooth の児童には、その児童の分だけ届く", async () => {
  const w = await world(); const code = await w.t.createClass("A", 5);
  const a = bleStudent(w.hub), b = bleStudent(w.hub);
  a.call("watchReplies", { code, uid: "ble-aaaaaaaa-1111" }); b.call("watchReplies", { code, uid: "ble-bbbbbbbb-2222" });
  await w.t.sendReply(code, { uid: "ble-aaaaaaaa-1111", question: "q", answer: "Aさんへ" });
  await w.t.sendReply(code, { uid: "online-student-uid", question: "q", answer: "オンラインの人へ" });
  await until(() => a.latest("replies")?.length === 1);
  assert.equal(a.latest("replies")[0].answer, "Aさんへ"); assert.deepEqual(b.latest("replies"), [], "Bには届かない");
  assert.deepEqual(w.online.calls.filter((c) => c[0] === "sendReply").map((c) => c[1]), ["online-student-uid"], "オンラインへは、オンラインの児童の分だけ");
  assert.deepEqual(w.local.calls.filter((c) => c[0] === "sendReply").map((c) => c[1]), ["ble-aaaaaaaa-1111"]);
});

test("Bluetooth でつながっている児童の端末の数が、先生の画面に出る", async () => {
  const w = await world(); const code = await w.t.createClass("A", 5);
  const counts = []; const off = w.t.bluetooth.watchStudents(code, (s) => counts.push(s.count));
  await until(() => counts.length > 0);
  const a = bleStudent(w.hub); a.call("watchMaterials", { code }); const b = bleStudent(w.hub); b.call("watchMaterials", { code });
  await until(() => counts.at(-1) === 2); a.session.close(); await until(() => counts.at(-1) === 1);
  off();
});

test("Bluetooth 教室(先生PCの中継)が動いていなくても、オンラインは止まらない。使えないことは、知らせる", async () => {
  const w = await world({ relayDown: true });
  assert.equal(w.t.bluetooth.available, false); assert.match(w.t.bluetooth.lastError, /つながりません/);
  const code = await w.t.createClass("A", 5);
  const r = await w.t.publishMaterial(code, { title: "オンラインだけ" });
  assert.equal(r.online, true); assert.equal(r.bluetooth, false);
  assert.equal(w.online.classes.get(code).materials.length, 1, "オンラインへは配信できた");
  assert.equal(w.store.classes.size, 0, "Bluetooth 教室は作っていない");
  const seen = []; w.t.watchQuestions(code, (l) => seen.push(l)); w.online.ask(code, "オンラインの質問", Date.now());
  await until(() => seen.at(-1)?.length === 1); assert.equal(seen.at(-1)[0].via, "online");
  const off = w.t.bluetooth.watchStudents(code, () => {}); off(); // 使えなくても、例外にならない
});

test("あとから使えるようになったら(recheck)、教室を用意し、教材を写し、質問・つながっている数を見はじめる", async () => {
  const w = await world({ relayDown: true });
  const code = await w.t.createClass("A", 5);
  await w.t.publishMaterial(code, { title: "つながる前の教材" });
  const seen = []; w.t.watchQuestions(code, (l) => seen.push(l)); w.t.watchMaterials(code, () => {});
  const counts = []; w.t.bluetooth.watchStudents(code, (s) => counts.push(s.count));
  assert.equal(w.store.classes.size, 0);
  const changes = []; w.t.bluetooth.onChange((s) => changes.push(s.available));
  assert.equal(await w.t.bluetooth.recheck(), false, "まだ使えない");
  w.local.down = false; // 先生PCの中継を起動した
  assert.equal(await w.t.bluetooth.recheck(), true);
  assert.deepEqual(changes.slice(-1), [true]);
  await until(() => w.store.getClass(code) && w.store.materials(code).length === 1);
  assert.equal(w.store.materials(code)[0].title, "つながる前の教材", "つながる前に配信した教材も、写る");
  const kid = bleStudent(w.hub);
  kid.call("sendQuestion", { code, q: { seat: 3, text: "つながったあとの質問", uid: "ble-cccccccc-3333" } });
  await until(() => seen.at(-1)?.some((q) => q.via === "ble"));
  await until(() => counts.length > 0);
});

test("配信のとき、片方だけ失敗したら、成功した側には届き、知らせる。両方失敗したら、例外", async () => {
  const w = await world(); const code = await w.t.createClass("A", 5);
  const notes = []; w.t.bluetooth.onNotice((m) => notes.push(m));
  // Bluetooth 教室だけ失敗
  w.local.down = true;
  const r1 = await w.t.publishMaterial(code, { title: "オンラインだけ届く" });
  assert.deepEqual({ online: r1.online, bluetooth: r1.bluetooth }, { online: true, bluetooth: false });
  assert.match(notes.at(-1) ?? "", /Bluetooth の児童には、教材が届きませんでした/);
  // オンラインだけ失敗(ネットが切れた)
  w.local.down = false; w.online.fail = true;
  const r2 = await w.t.publishMaterial(code, { title: "Bluetoothだけ届く" });
  assert.deepEqual({ online: r2.online, bluetooth: r2.bluetooth }, { online: false, bluetooth: true });
  assert.match(notes.at(-1), /オンラインへは配信できませんでした.*Bluetooth の児童には届きました/);
  assert.deepEqual(w.store.materials(code).map((m) => m.title), ["Bluetoothだけ届く"]);
  // 両方
  w.local.down = true;
  await assert.rejects(w.t.publishMaterial(code, { title: "どちらにも届かない" }), /ネットが切れている/);
});

test("起こしたときの確認が成功したら、時間切れのタイマーが、あとで「使えない」に変えない(確認の待ち時間をこえて待っても、使える)", async () => {
  const w = await world(); // probeMs: 200
  assert.equal(w.t.bluetooth.available, true);
  await new Promise((r) => setTimeout(r, 450)); // 確認の待ち時間(200ms)の倍以上、待つ
  assert.equal(w.t.bluetooth.available, true, "成功したあとに、時間切れで「使えない」にならない");
  assert.equal(w.t.bluetooth.lastError, "");
  // 遅く返る確認は、時間切れで一度「使えない」になっても、返ってきたら「使える」にもどる
  const store = new RoomStore(); const hub = new RelayHub({ store }); const slow = fakeLocal(store, hub);
  const realStatus = slow.status; slow.status = async () => { await new Promise((r) => setTimeout(r, 120)); return realStatus(); };
  const t2 = await createHybridTeacherTransport({ online: fakeOnline(), local: slow, probeMs: 40 });
  assert.equal(t2.bluetooth.available, false, "時間切れのあいだは、使えない");
  await until(() => t2.bluetooth.available === true);
});
