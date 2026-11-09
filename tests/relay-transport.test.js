// Bluetooth 中継の、児童の端末の通信層(transport-ble.js)のテスト。
// 偽の Web Bluetooth(tests/browser/fake-bluetooth.js)で、先生PC側の窓口(RelayHub)につなぐ。本物の Bluetooth の機器は使わない。
//   node --test tests/relay-transport.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomStore } from "../public/js/relay/room-store.js";
import { RelayHub } from "../public/js/relay/hub.js";
import { RelayPeripheral } from "../public/js/relay/peripheral.js";
import { WebBluetoothLink, createBleTransport } from "../public/js/relay/transport-ble.js";
import { SERVICE_UUID, RX_UUID, TX_UUID } from "../public/js/relay/protocol.js";
import { createFakeBluetooth } from "./browser/fake-bluetooth.js";

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`時間内に条件にならなかった:${fn}`); await new Promise((r) => setTimeout(r, 5)); } };
const instant = () => Promise.resolve();
const UUIDS = { service: SERVICE_UUID, rx: RX_UUID, tx: TX_UUID };

async function world({ notifyBytes = 185, hubOpt = {}, tOpt = {}, storage = memStorage() } = {}) {
  const store = new RoomStore(); const hub = new RelayHub({ store, ...hubOpt });
  const warns = [];
  const peripheral = new RelayPeripheral({ hub, onWarn: (m) => warns.push(m) });
  const fake = createFakeBluetooth({ uuids: UUIDS, peripheral, notifyBytes, mtu: notifyBytes + 3 });
  const code = store.createClass({ name: "5年2組", grade: 5 });
  const link = new WebBluetoothLink({ bluetooth: fake.bluetooth });
  await link.pick();
  const t = await createBleTransport({ link, storage, sleep: instant, retryQuestionMs: 5, rpcTimeoutMs: 1500, ...tOpt });
  return { store, hub, peripheral, fake, link, t, code, storage, warns };
}

test("つなぐ:Web Bluetooth の手順(機器の選択 → GATT 接続 → サービス → 特性 → 通知)で、クラスコードを確かめられる", async () => {
  const w = await world();
  assert.equal(w.t.mode, "ble");
  assert.deepEqual(await w.t.getClass(w.code), { name: "5年2組", grade: 5 });
  assert.equal(await w.t.getClass("ZZZZZZ"), null, "ないクラスは null");
  assert.equal(w.hub.sessionCount, 1);
  assert.equal(w.t.status().connected, true); assert.equal(w.t.status().device, "KyozaiRelay-TEST");
  assert.match(w.t.myUid(), /^ble-[0-9a-f-]{36}$/); assert.equal(w.t.myUid(), w.t.myUid(), "同じ端末は、同じ番号");
  w.t.close();
});

test("つなげないとき:Bluetooth がない・機器の選択をやめた・先生PCが見つからないときは、わかる理由で失敗する", async () => {
  assert.equal(WebBluetoothLink.supported(undefined), false);
  await assert.rejects(new WebBluetoothLink({ bluetooth: undefined }).pick(), /Bluetooth でつなげません/);
  const store = new RoomStore(); const peripheral = new RelayPeripheral({ hub: new RelayHub({ store }) });
  const fake = createFakeBluetooth({ uuids: UUIDS, peripheral }); fake.ctl.chooserCancels = true;
  await assert.rejects(new WebBluetoothLink({ bluetooth: fake.bluetooth }).pick(), /cancelled/);
  fake.ctl.chooserCancels = false; fake.ctl.connectable = false;
  const link = new WebBluetoothLink({ bluetooth: fake.bluetooth }); await link.pick();
  await assert.rejects(createBleTransport({ link, storage: memStorage(), sleep: instant }), /Connection attempt failed/);
  await assert.rejects(new WebBluetoothLink({ bluetooth: fake.bluetooth }).connect(), /先に pick/);
});

test("教材:いまある分がすぐ届き、あとから先生が配信した分も届く。大きな教材も、通知の大きさが小さくても届く(20〜244 バイト)", async () => {
  for (const notifyBytes of [20, 64, 185, 244]) {
    const w = await world({ notifyBytes });
    w.store.publishMaterial(w.code, { title: "ふりこ", explanation: "あ".repeat(300) });
    const seen = []; const off = w.t.watchMaterials(w.code, (l) => seen.push(l.map((m) => m.title)));
    await until(() => seen.length >= 1);
    assert.deepEqual(seen.at(-1), ["ふりこ"], `notify=${notifyBytes}`);
    const big = { title: "大きな教材", explanation: "い".repeat(40000), sim: { type: "cfg", config: { params: { x: 1 } } } }; // 約 120KB
    w.store.publishMaterial(w.code, big);
    await until(() => seen.at(-1)?.[0] === "大きな教材", 8000);
    assert.deepEqual(seen.at(-1), ["大きな教材", "ふりこ"]);
    off(); w.t.close();
  }
});

test("教材の一覧が長いとき(分けて届く)も、全部そろってから1回で届く。端末に覚えて、つぎは、つながる前に出せる", async () => {
  const storage = memStorage();
  const w = await world({ storage, hubOpt: { maxBatchBytes: 3000 } });
  for (let i = 0; i < 12; i++) w.store.publishMaterial(w.code, { title: `教材${i}`, explanation: "う".repeat(400) });
  const calls = []; w.t.watchMaterials(w.code, (l) => calls.push(l.length));
  await until(() => calls.length >= 1);
  assert.deepEqual(calls, [12], "分かれて届いても、画面には、そろった1回だけ");
  w.t.close();
  // 別の接続(ページを開きなおした)で、つながる前に、覚えていた教材が出る
  const link2 = { connect: async () => {}, write: async () => {}, onChunk() {}, onDisconnect() {}, close() {} };
  const t2 = await createBleTransport({ link: link2, storage, sleep: instant, autoReconnect: false });
  const first = []; t2.watchMaterials(w.code, (l) => first.push(l.length));
  assert.deepEqual(first, [12], "覚えていた教材がすぐ出る");
});

test("返事:自分あてだけ届く。ほかの端末の返事は届かない", async () => {
  const w = await world();
  const mine = []; w.t.watchMyReplies(w.code, (l) => mine.push(l.map((r) => r.text)));
  await until(() => mine.length >= 1);
  w.store.addReply(w.code, { uid: w.t.myUid(), text: "あなたへ" });
  w.store.addReply(w.code, { uid: "student-someone-else", text: "ほかの人へ" });
  await until(() => mine.at(-1)?.length === 1);
  assert.deepEqual(mine.at(-1), ["あなたへ"]);
  w.t.close();
});

test("質問:先生PCの教室に届く(端末の番号・AIに聞いたか・教材の題つき)。1回の書きこみは chunk の上限以下で、まざらない", async () => {
  const w = await world();
  await w.t.sendQuestion(w.code, { seat: 7, text: "ふりこ🙂のおもりを重くすると?", aiTried: true, materialTitle: "ふりこ", original: "それ、なんで?" });
  await until(() => w.store.questions(w.code).length === 1);
  const q = w.store.questions(w.code)[0];
  assert.deepEqual({ seat: q.seat, text: q.text, aiTried: q.aiTried, materialTitle: q.materialTitle, original: q.original, uid: q.uid, status: q.status }, { seat: 7, text: "ふりこ🙂のおもりを重くすると?", aiTried: true, materialTitle: "ふりこ", original: "それ、なんで?", uid: w.t.myUid(), status: "new" });
  await until(() => w.t.status().queued === 0);
  assert.ok(w.fake.ctl.writeSizes.length > 0 && w.fake.ctl.writeSizes.every((n) => n <= 180), `書きこみの大きさ:${w.fake.ctl.writeSizes}`);
  w.t.close();
});

test("質問:続けて送ると、先生PC側の「少し待って」で、あとから自動で送り直す。条件に合わない質問は、積みっぱなしにせず捨てる", async () => {
  const w = await world({ hubOpt: { questionIntervalMs: 60 } });
  await w.t.sendQuestion(w.code, { seat: 1, text: "1つめ" });
  await w.t.sendQuestion(w.code, { seat: 1, text: "2つめ(すぐ続けて)" });
  await w.t.sendQuestion(w.code, { seat: 1, text: "3つめ" });
  await until(() => w.store.questions(w.code).length === 3, 5000);
  assert.deepEqual(w.store.questions(w.code).map((q) => q.text).reverse(), ["1つめ", "2つめ(すぐ続けて)", "3つめ"], "順番どおり");
  // 条件に合わない質問(出席番号 99)は、何度送っても通らないので、捨てる(あとの質問を止めない)
  const warn = console.warn; console.warn = () => {};
  try {
    await w.t.sendQuestion(w.code, { seat: 99, text: "通らない" });
    await w.t.sendQuestion(w.code, { seat: 2, text: "そのあとの質問" });
    await until(() => w.store.questions(w.code).some((q) => q.text === "そのあとの質問"), 5000);
  } finally { console.warn = warn; }
  assert.ok(!w.store.questions(w.code).some((q) => q.text === "通らない"));
  assert.equal(w.t.status().queued, 0);
  w.t.close();
});

test("切れたとき:質問は端末に積まれ、つながりなおしたら、順番どおり自動で届く。見ていた教材・返事も、つながりなおして、切れていた間の分が届く", async () => {
  const w = await world();
  const mats = []; w.t.watchMaterials(w.code, (l) => mats.push(l.length));
  const reps = []; w.t.watchMyReplies(w.code, (l) => reps.push(l.length));
  await until(() => mats.length >= 1 && reps.length >= 1);
  w.fake.ctl.connectable = false; // 電波がとどかない
  w.fake.drop();
  await until(() => !w.t.status().connected);
  await w.t.sendQuestion(w.code, { seat: 5, text: "切れている間の質問1" });
  await w.t.sendQuestion(w.code, { seat: 5, text: "切れている間の質問2" });
  assert.equal(w.t.status().queued, 2, "端末に積んである");
  assert.equal(w.store.questions(w.code).length, 0);
  w.store.publishMaterial(w.code, { title: "切れている間の教材" }); // 先生は、そのあいだに教材を配信した
  w.store.addReply(w.code, { uid: w.t.myUid(), text: "切れている間の返事" });
  assert.ok(w.fake.ctl.connects >= 2, "つなぎなおそうとしている");
  w.fake.ctl.connectable = true; // 電波がもどった
  await until(() => w.t.status().connected, 5000);
  await until(() => w.store.questions(w.code).length === 2, 5000);
  assert.deepEqual(w.store.questions(w.code).map((q) => q.text).reverse(), ["切れている間の質問1", "切れている間の質問2"]);
  await until(() => w.t.status().queued === 0);
  await until(() => mats.at(-1) === 1 && reps.at(-1) === 1, 5000);
  assert.equal(w.hub.sessionCount, 1, "古い接続は片づいて、1台分だけ");
  w.t.close();
});

test("ページを開きなおしても、積んであった質問は残り、つながったら届く(端末に保存してある)", async () => {
  const storage = memStorage();
  const w = await world({ storage });
  w.fake.ctl.connectable = false; w.fake.drop();
  await until(() => !w.t.status().connected);
  await w.t.sendQuestion(w.code, { seat: 8, text: "ページを閉じる前の質問" });
  w.t.close(); // ページを閉じた
  assert.equal(JSON.parse(storage.getItem("kyozai-ble-outbox")).length, 1);
  // 開きなおして、つなぎなおす(同じ端末の保存)
  const link = new WebBluetoothLink({ bluetooth: createFakeBluetooth({ uuids: UUIDS, peripheral: w.peripheral }).bluetooth }); await link.pick();
  const t2 = await createBleTransport({ link, storage, sleep: instant });
  await until(() => w.store.questions(w.code).length === 1, 4000);
  assert.equal(w.store.questions(w.code)[0].text, "ページを閉じる前の質問");
  assert.equal(w.store.questions(w.code)[0].uid, t2.myUid(), "同じ端末の番号");
  t2.close();
});

test("返事がない(先生PC側が応えない)ときは、時間でやめて理由つきで失敗する。切れたときは、待っていた呼び出しがすぐ失敗する。閉じたあとは、つなぎなおさない", async () => {
  // 先生PC側が、書きこみを受けとるだけで、返事をしない
  const silent = { openConnection: () => ({ write() {}, close() {} }) };
  const fake = createFakeBluetooth({ uuids: UUIDS, peripheral: silent });
  const link = new WebBluetoothLink({ bluetooth: fake.bluetooth }); await link.pick();
  const t = await createBleTransport({ link, storage: memStorage(), sleep: instant, rpcTimeoutMs: 80, autoReconnect: false });
  const t0 = Date.now();
  await assert.rejects(t.getClass("ABC234"), /返事がありません/);
  assert.ok(Date.now() - t0 >= 70 && Date.now() - t0 < 1000, "timeout の時間");
  // 返事を待っているあいだに切れたら、待たずに失敗する
  const waiting = assert.rejects(t.getClass("ABC234"), /接続が切れました/);
  await new Promise((r) => setTimeout(r, 10)); fake.drop();
  await waiting;
  t.close();
  // 閉じたあとは、つなぎなおさない(自動で つなぎなおす設定でも)
  const w = await world();
  w.t.close();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(w.fake.connected, false, "閉じたら切れる");
  const n = w.fake.ctl.connects; await new Promise((r) => setTimeout(r, 60));
  assert.equal(w.fake.ctl.connects, n, "閉じたあとは、つなぎなおさない");
});

test("先生の操作(クラスを作る・教材を配信する・質問を読む)は、Bluetooth の端末からはできない", async () => {
  const w = await world();
  await assert.rejects(w.t.createClass("x"), /先生の操作はできません/);
  await assert.rejects(w.t.publishMaterial(w.code, {}), /先生の操作/);
  assert.throws(() => w.t.watchQuestions(w.code, () => {}), /先生の操作/);
  assert.equal(await w.t.getIdToken(), null);
  assert.equal(w.store.materials(w.code).length, 0);
  // 窓口の側でも断る(端末が作り変えたメッセージでも、できない)
  const link = w.link; // 直接、先生の操作を送る
  const { Framer, encodeMessage } = await import("../public/js/relay/protocol.js");
  for (const c of new Framer().split(encodeMessage({ id: 99, op: "publishMaterial", code: w.code, m: { title: "ずる" } }), 180)) await link.write(c);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(w.store.materials(w.code).length, 0, "先生PC側で断る");
  w.t.close();
});

test("児童の画面が送る形(使わない項目が null・もとと同じ文)でも、そのまま送れる(Firebase 版と同じ取りのぞき)", async () => {
  const w = await world();
  // student.js の sendQuestion と同じ形
  await w.t.sendQuestion(w.code, { seat: 5, text: "同じ文", original: "同じ文", aiTried: true, materialTitle: null });
  await until(() => w.store.questions(w.code).length === 1);
  const q = w.store.questions(w.code)[0];
  assert.deepEqual(Object.keys(q).sort(), ["aiTried", "createdAt", "id", "seat", "status", "text", "uid"], "null の項目・もとと同じ文は入らない");
  assert.equal(w.warns.length, 0);
  w.t.close();
});
