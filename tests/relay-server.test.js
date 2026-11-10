// Bluetooth 教室のサーバー側(server/relay)のテスト。本物のサーバーを別のプロセスで起動して、
//   ・先生の画面が使う HTTP / SSE
//   ・中継アプリのかわりに、TCP(行区切りの JSON)でつなぐ偽のアプリ(児童の端末 1台ぶんを、Bluetooth の chunk でまねる)
// をつなぐ。Bluetooth の機器は使わない。
//   node --test tests/relay-server.test.js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Framer, Reassembler, encodeMessage, decodeMessage, toBase64, fromBase64 } from "../public/js/relay/protocol.js";

const SECRET_Q = "ひみつの質問テキスト98765";
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

async function startServer(env = {}, dataDir = mkdtempSync(join(tmpdir(), "relay-"))) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, PORT: String(port), RELAY_DATA_DIR: dataDir, RELAY_BLE_PORT: "0", LLM_BASE_URL: "http://127.0.0.1:1", TEACHER_EMAILS: "", TEACHER_DOMAINS: "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const log = { text: "" };
  child.stdout.on("data", (d) => { log.text += d; }); child.stderr.on("data", (d) => { log.text += d; });
  await new Promise((ok, ng) => {
    const t = setTimeout(() => ng(new Error(`起動しない:${log.text}`)), 10000);
    const iv = setInterval(() => { if (log.text.includes("使ってよい画面")) { clearTimeout(t); clearInterval(iv); ok(); } }, 30);
    child.on("exit", () => { clearTimeout(t); clearInterval(iv); ng(new Error(`すぐ終了:${log.text}`)); });
  });
  const bridgePort = Number(/中継アプリとの口:127\.0\.0\.1:(\d+)/.exec(log.text)?.[1] ?? 0);
  return { child, log, port, bridgePort, dataDir, url: `http://localhost:${port}`, stop: () => new Promise((ok) => { if (child.exitCode !== null) return ok(); child.once("exit", ok); child.kill(); }) };
}

// http.request:Host・Origin を自由に付けられる(fetch は Host を変えられない)
const req = (s, method, path, { body, headers = {} } = {}) => new Promise((ok, ng) => {
  const data = body ? JSON.stringify(body) : null;
  const r = http.request({ host: "127.0.0.1", port: s.port, method, path, headers: { Host: `localhost:${s.port}`, ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
    let t = ""; res.on("data", (c) => { t += c; }); res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* json でない */ } ok({ status: res.statusCode, body: j, text: t }); });
  });
  r.on("error", ng); if (data) r.write(data); r.end();
});

/** SSE を読む(先生の画面の watch) */
function openStream(s, code) {
  const events = []; let buf = "";
  const r = http.request({ host: "127.0.0.1", port: s.port, path: `/relay/class/${code}/stream`, headers: { Host: `localhost:${s.port}` } }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n\n")) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (.+)$/m.exec(block), d = /^data: (.+)$/m.exec(block); if (ev && d) events.push([ev[1], JSON.parse(d[1])]); } });
  });
  r.end();
  return { events, close: () => r.destroy(), last: (kind) => events.filter((e) => e[0] === kind).at(-1)?.[1] };
}

/** 中継アプリのまね:TCP で bridge につなぎ、児童の端末(Bluetooth の接続)を何台か開く */
async function fakeApp(port) {
  const socket = net.connect(port, "127.0.0.1"); socket.setEncoding("utf8");
  await new Promise((ok, ng) => { socket.once("connect", ok); socket.once("error", ng); });
  const rx = {}; let buf = ""; const raw = [];
  socket.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); raw.push(m); if (m.t === "tx") (rx[m.s] ??= { re: new Reassembler(), msgs: [] }, (() => { const r = rx[m.s].re.push(fromBase64(m.b)); if (r.message) rx[m.s].msgs.push(decodeMessage(r.message)); })()); } catch { /* 行が読めない */ } } });
  const send = (o) => socket.write(JSON.stringify(o) + "\n");
  send({ t: "hello", app: "TestRelay", name: "KyozaiRelay-TEST" });
  const device = (name, mtu = 100, idStart = 0) => {
    const framer = new Framer(); let id = idStart;
    send({ t: "open", s: name, mtu });
    return {
      msgs: () => rx[name]?.msgs ?? [],
      // 端末が、メッセージを送る(chunk に分けて、1つずつ「書く」)
      say(op, rest = {}) { const mid = ++id; for (const c of framer.split(encodeMessage({ id: mid, op, ...rest }), 60)) send({ t: "rx", s: name, b: toBase64(c) }); return mid; },
      async call(op, rest = {}) { const mid = this.say(op, rest); await until(() => this.msgs().some((m) => m.id === mid)); return this.msgs().find((m) => m.id === mid); },
      close: () => send({ t: "close", s: name }),
    };
  };
  return { socket, send, device, raw, close: () => socket.destroy() };
}
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`時間内に条件にならなかった:${fn}`); await new Promise((r) => setTimeout(r, 10)); } };

let s;
before(async () => { s = await startServer(); });
after(async () => { await s?.stop(); });

test("先生の画面の HTTP:クラスを作り・教材を配信し・質問に印をつけ・返事を書ける。おかしな入力は、理由つきで断る", async () => {
  const st = await req(s, "GET", "/relay/status");
  assert.equal(st.status, 200); assert.equal(st.body.enabled, true); assert.equal(st.body.bridge.listening, true);
  const c = await req(s, "POST", "/relay/classes", { body: { name: "5年2組 理科", grade: 5 } });
  assert.equal(c.status, 200); assert.match(c.body.code, /^[A-HJ-NP-Z2-9]{6}$/);
  const code = c.body.code;
  assert.equal((await req(s, "POST", "/relay/classes", { body: { name: "", grade: 5 } })).status, 400);
  assert.equal((await req(s, "POST", "/relay/classes", { body: { name: "x", grade: 3 } })).status, 400);
  assert.deepEqual((await req(s, "GET", `/relay/class/${code}`)).body, { code, name: "5年2組 理科", grade: 5, createdAt: (await req(s, "GET", `/relay/class/${code}`)).body.createdAt, mine: true });
  assert.equal((await req(s, "GET", "/relay/class/ZZZZZZ")).status, 404);
  assert.ok((await req(s, "GET", "/relay/classes")).body.some((x) => x.code === code));
  assert.equal((await req(s, "POST", `/relay/class/${code}/materials`, { body: { material: { title: "ふりこ", explanation: "e", sim: null, quiz: [] } } })).status, 200);
  assert.equal((await req(s, "POST", `/relay/class/${code}/materials`, { body: { material: 5 } })).status, 400);
  assert.equal((await req(s, "POST", `/relay/class/ZZZZZZ/materials`, { body: { material: { title: "x" } } })).status, 404);
  assert.equal((await req(s, "POST", `/relay/class/${code}/replies`, { body: { reply: { uid: "bad", text: "x" } } })).status, 400);
  assert.equal((await req(s, "GET", "/relay/nothing")).status, 404);
});

test("先生の画面だけが使える:ほかのサイト(Origin)・別の名前(Host)からの呼び出しは断る(悪い Web ページが localhost を呼ぶのを防ぐ)", async () => {
  const ok = await req(s, "GET", "/relay/status", { headers: { Origin: `http://localhost:${s.port}` } });
  assert.equal(ok.status, 200, "同じ場所の画面(Origin が自分)は使える");
  for (const [why, headers] of [
    ["ほかのサイトの画面", { Origin: "https://evil.example" }],
    ["公開の画面(Firebase Hosting)", { Origin: "https://kyoiku-hakkason.web.app" }],
    ["DNS リバインディング(Host が別の名前)", { Host: `evil.example:${s.port}` }],
    ["別の名前の localhost もどき", { Host: `localhost.evil.example:${s.port}` }],
  ]) {
    const r = await req(s, "GET", "/relay/classes", { headers });
    assert.equal(r.status, 403, why); assert.match(r.body.error, /localhost からだけ/);
    assert.equal((await req(s, "POST", "/relay/classes", { headers, body: { name: "x" } })).status, 403, why);
  }
});

test("中継アプリ(TCP)から、児童の端末が、クラスコードの確認・教材を見る・質問を送る・返事を受けとる。先生の画面(SSE)にも、すぐ届く", async () => {
  const code = (await req(s, "POST", "/relay/classes", { body: { name: "つなぐクラス", grade: 6 } })).body.code;
  const stream = openStream(s, code);
  await until(() => stream.last("students"));
  assert.equal(stream.last("students").count, 0);
  const app = await fakeApp(s.bridgePort);
  await until(async () => (await req(s, "GET", "/relay/status")).body.bridge.appConnected || false).catch(() => {});
  const a = app.device("phone-a", 100), b = app.device("phone-b", 64);
  const UID_A = "student-aaaaaaaa", UID_B = "student-bbbbbbbb";
  try {
    assert.deepEqual((await a.call("getClass", { code })).result, { name: "つなぐクラス", grade: 6 });
    assert.equal((await a.call("getClass", { code: "ZZZZZZ" })).result, null);
    // 教材:先に配信した分がすぐ届き、あとで配信した分も届く(大きい教材は、小さい通知に分かれて届く)
    await req(s, "POST", `/relay/class/${code}/materials`, { body: { material: { title: "先に配信", explanation: "あ".repeat(3000) } } });
    assert.equal((await a.call("watchMaterials", { code })).ok, true);
    await until(() => a.msgs().some((m) => m.push === "materials" && m.list.length === 1));
    await req(s, "POST", `/relay/class/${code}/materials`, { body: { material: { title: "あとで配信", explanation: "い".repeat(3000) } } });
    await until(() => a.msgs().filter((m) => m.push === "materials").at(-1)?.list.length === 2);
    assert.deepEqual(a.msgs().filter((m) => m.push === "materials").at(-1).list.map((m) => m.title), ["あとで配信", "先に配信"]);
    // 質問:先生の画面に、すぐ届く(文は、日本語・絵文字)
    const q = await a.call("sendQuestion", { code, q: { seat: 12, text: `${SECRET_Q} 🙂`, uid: UID_A, aiTried: true } });
    assert.equal(q.ok, true);
    await until(() => stream.last("questions")?.length === 1);
    assert.equal(stream.last("questions")[0].text, `${SECRET_Q} 🙂`);
    assert.equal(stream.last("questions")[0].seat, 12);
    assert.equal((await b.call("sendQuestion", { code, q: { seat: 99, text: "x" } })).ok, false, "出席番号が範囲の外");
    // 先生が、質問に印をつけ、Aさんだけに返事を書く
    const qid = stream.last("questions")[0].id;
    assert.equal((await req(s, "POST", `/relay/class/${code}/questions/${qid}`, { body: { fields: { status: "done", relevance: "上", text: "書きかえ" } } })).status, 200);
    await until(() => stream.last("questions")[0].status === "done");
    assert.equal(stream.last("questions")[0].text.startsWith(SECRET_Q), true, "質問の文は書きかえられない");
    await a.call("watchReplies", { code, uid: UID_A }); await b.call("watchReplies", { code, uid: UID_B });
    await req(s, "POST", `/relay/class/${code}/replies`, { body: { reply: { uid: UID_A, text: "Aさんへの返事" } } });
    await until(() => a.msgs().filter((m) => m.push === "replies").at(-1)?.list.length === 1);
    assert.equal(a.msgs().filter((m) => m.push === "replies").at(-1).list[0].text, "Aさんへの返事");
    assert.equal(b.msgs().filter((m) => m.push === "replies").at(-1).list.length, 0, "Bさんには届かない");
    // つながっている端末の数が、先生の画面に出る
    await until(() => stream.last("students")?.count === 2);
    b.close(); await until(() => stream.last("students")?.count === 1);
    app.close(); await until(() => stream.last("students")?.count === 0);
  } finally { app.close(); stream.close(); }
});

test("中継アプリとの口が、でたらめな入力・長すぎる行・同じ名前の端末・新しい中継アプリに、きちんと対応する", async () => {
  const code = (await req(s, "POST", "/relay/classes", { body: { name: "でたらめ" } })).body.code;
  const app = await fakeApp(s.bridgePort);
  // 読めない行・形のちがうもの・名前のおかしい端末は、無視される(つなぎは切れない)
  for (const line of ["これはJSONではない", "[1,2,3]", JSON.stringify({ t: "rx", s: "no-such", b: "AAAA" }), JSON.stringify({ t: "open", s: "bad name!", mtu: 20 }), JSON.stringify({ t: "open", s: "x".repeat(200) }), JSON.stringify({ t: "unknown" }), "", "null"]) app.socket.write(line + "\n");
  const d = app.device("ok-device", 20);
  assert.equal((await d.call("getClass", { code })).ok, true, "そのあとも、ふつうに使える");
  assert.ok(!app.raw.some((m) => m.s === "bad name!"));
  // 同じ名前でもう一度つなぐと、前のものは切り替わる(切れて、つなぎなおしたとき)
  const d2 = app.device("ok-device", 20, 1000); // 同じ名前でも、メッセージ番号は別にする(返事が混ざらないように)
  assert.equal((await d2.call("ping")).result.pong, true);
  // 新しい中継アプリがつながると、前のアプリは切られる
  const closed = new Promise((ok) => app.socket.once("close", ok));
  const app2 = await fakeApp(s.bridgePort);
  await closed;
  assert.equal((await app2.device("another", 20).call("getClass", { code })).ok, true);
  // 長すぎる行(64KB 超え)は、通信ごと切る
  const closed2 = new Promise((ok) => app2.socket.once("close", ok));
  app2.socket.write("a".repeat(200 * 1024));
  await closed2;
  // その後も、あたらしいアプリはつながれる
  const app3 = await fakeApp(s.bridgePort);
  assert.equal((await app3.device("again", 20).call("ping")).ok, true);
  app3.close();
});

test("先生PC自身の画面(Bluetooth 教室のクラス)は、ログインなしで、AIサーバーの認証を通る。知らないクラス・Authorization のある呼び出しは、いままでどおり", async () => {
  const code = (await req(s, "POST", "/relay/classes", { body: { name: "AI用", grade: 7 } })).body.code;
  // 認証を通る → 中身のまちがい(質問が 0 件)で 400(通らなければ 401/403)
  const ok = await req(s, "POST", "/api/group", { body: { code, questions: [] } });
  assert.equal(ok.status, 400); assert.match(ok.body.error, /質問は1〜40件/);
  assert.equal((await req(s, "POST", "/api/group", { body: { code: "ZZZZZZ", questions: [] } })).status, 401, "Bluetooth 教室にないクラスは、ログインが要る");
  assert.equal((await req(s, "POST", "/api/group", { body: { code, questions: [] }, headers: { Authorization: "Bearer not.a.jwt" } })).status, 401, "トークンをつけたら、トークンで確かめる");
  assert.equal((await req(s, "POST", "/api/group", { body: { code, questions: [] }, headers: { Origin: "https://evil.example" } })).status, 401, "ほかのサイトの画面からは、通らない");
  assert.equal((await req(s, "POST", "/api/group", { body: { code, questions: [] }, headers: { Host: `evil.example:${s.port}` } })).status, 401, "別の名前(Host)からは、通らない");
});

test("児童の質問の文は、サーバーのログに残らない。教室のデータはファイルに保存され、サーバーを再起動しても残る", async () => {
  const code = (await req(s, "POST", "/relay/classes", { body: { name: "保存のクラス", grade: 8 } })).body.code;
  await req(s, "POST", `/relay/class/${code}/materials`, { body: { material: { title: "残る教材" } } });
  const app = await fakeApp(s.bridgePort); const d = app.device("saver", 100);
  await d.call("sendQuestion", { code, q: { seat: 3, text: `${SECRET_Q} 保存`, uid: "student-saveuser" } });
  app.close();
  assert.ok(!s.log.text.includes(SECRET_Q), `ログに質問の文が出ている:${s.log.text}`);
  await new Promise((r) => setTimeout(r, 900)); // 保存は、少しまとめてから書く
  const file = join(s.dataDir, "relay-rooms.json");
  assert.ok(existsSync(file));
  assert.ok(readFileSync(file, "utf8").includes("残る教材"));
  // 再起動(同じ保存先)
  const dir = s.dataDir; await s.stop();
  s = await startServer({}, dir);
  const back = await req(s, "GET", `/relay/class/${code}`);
  assert.equal(back.body.name, "保存のクラス");
  const stream = openStream(s, code);
  await until(() => stream.last("materials") && stream.last("questions"));
  assert.deepEqual(stream.last("materials").map((m) => m.title), ["残る教材"]);
  assert.equal(stream.last("questions")[0].seat, 3);
  stream.close();
});

test("Cloud Run では Bluetooth 教室は動かない(先生PCのもの)。RELAY=0 でも動かない。口を開けない設定(off)もできる", async () => {
  const cr = await startServer({ K_SERVICE: "kyozai-ai" });
  try { assert.equal((await req(cr, "GET", "/relay/status")).status, 404); assert.equal(cr.bridgePort, 0); assert.ok(!/Bluetooth 教室/.test(cr.log.text)); } finally { await cr.stop(); }
  const off = await startServer({ RELAY: "0" });
  try { assert.equal((await req(off, "GET", "/relay/status")).status, 404); } finally { await off.stop(); }
  const nobridge = await startServer({ RELAY_BLE_PORT: "off" });
  try { const st = await req(nobridge, "GET", "/relay/status"); assert.equal(st.status, 200); assert.equal(st.body.bridge.listening, false); assert.equal(nobridge.bridgePort, 0); } finally { await nobridge.stop(); }
});
