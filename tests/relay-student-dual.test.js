// 児童の通信層(オンライン + あとから Bluetooth)の、まとめ方と送り先のテスト
//   node --test tests/relay-student-dual.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudentDualTransport } from "../public/js/relay/transport-student.js";

function fakeOnline() {
  const w = { mat: [], rep: [] }; const sent = [];
  return {
    mode: "firebase", sent, w,
    myUid: () => "u-online",
    getClass: async () => ({ name: "A" }),
    watchMaterials: (c, cb) => { w.mat.push(cb); return () => { w.mat = w.mat.filter((x) => x !== cb); }; },
    watchMyReplies: (c, cb) => { w.rep.push(cb); return () => { w.rep = w.rep.filter((x) => x !== cb); }; },
    sendQuestion: async (c, q) => { sent.push(["online", q.text]); },
  };
}
function fakeBle() {
  const w = { mat: [], rep: [] }; const sent = []; let connected = true; let closed = false;
  return {
    sent, w, get closed() { return closed; },
    setConnected: (v) => { connected = v; },
    status: () => ({ connected, queued: 0 }), onStatus: () => () => {}, myUid: () => "ble-1", getClass: async () => ({ name: "A" }),
    watchMaterials: (c, cb) => { w.mat.push(cb); return () => { w.mat = w.mat.filter((x) => x !== cb); }; },
    watchMyReplies: (c, cb) => { w.rep.push(cb); return () => { w.rep = w.rep.filter((x) => x !== cb); }; },
    sendQuestion: async (c, q) => { sent.push(["ble", q.text]); },
    close: () => { closed = true; },
  };
}

test("Bluetooth を足す前は、オンラインのものがそのまま出る。ble は null", () => {
  const on = fakeOnline(); const t = createStudentDualTransport(on);
  assert.equal(t.mode, "firebase"); assert.equal(t.ble, null);
  let got; t.watchMaterials("X", (l) => { got = l; });
  on.w.mat[0]([{ id: "a", publishedAt: 1 }]);
  assert.deepEqual(got.map((m) => m.id), ["a"]);
});

test("足したあと:教材は両方から受けて、同じ id は1つ、新しい順。見ていたものも Bluetooth から受けはじめる", () => {
  const on = fakeOnline(); const b = fakeBle(); const t = createStudentDualTransport(on);
  let got; t.watchMaterials("X", (l) => { got = l; });
  on.w.mat[0]([{ id: "a", publishedAt: 1 }, { id: "c", publishedAt: 5 }]);
  t.attachBle(b);
  assert.equal(b.w.mat.length, 1, "足した時点で、見ているものを Bluetooth でも見はじめる");
  b.w.mat[0]([{ id: "a", publishedAt: 1 }, { id: "b", publishedAt: 3 }]);
  assert.deepEqual(got.map((m) => m.id), ["c", "b", "a"]);
  assert.ok(t.ble && t.ble.status().connected);
});

test("返事も両方から受けてまとめる", () => {
  const on = fakeOnline(); const b = fakeBle(); const t = createStudentDualTransport(on);
  let got; t.watchMyReplies("X", (l) => { got = l; });
  t.attachBle(b);
  on.w.rep[0]([{ id: "r1", createdAt: 1 }]);
  b.w.rep[0]([{ id: "r2", createdAt: 2 }]);
  assert.deepEqual(got.map((r) => r.id), ["r2", "r1"]);
});

test("質問:Bluetooth がつながっているあいだは Bluetooth、切れたらオンライン、足す前もオンライン", async () => {
  const on = fakeOnline(); const b = fakeBle(); const t = createStudentDualTransport(on);
  await t.sendQuestion("X", { text: "1" });
  t.attachBle(b);
  await t.sendQuestion("X", { text: "2" });
  b.setConnected(false);
  await t.sendQuestion("X", { text: "3" });
  assert.deepEqual(on.sent, [["online", "1"], ["online", "3"]]);
  assert.deepEqual(b.sent, [["ble", "2"]]);
});

test("外すと Bluetooth を閉じて、オンラインだけにもどる", () => {
  const on = fakeOnline(); const b = fakeBle(); const t = createStudentDualTransport(on);
  t.watchMaterials("X", () => {});
  t.attachBle(b);
  t.detachBle();
  assert.equal(b.closed, true); assert.equal(t.ble, null); assert.equal(b.w.mat.length, 0);
});
