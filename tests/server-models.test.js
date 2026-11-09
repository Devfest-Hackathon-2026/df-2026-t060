// 先生の画面から AI モデルを用意するしくみのテスト。本物のサーバーを起動し、偽の Google と偽の Ollama(/api/tags・/api/pull)につなぐ。
//   ・12B がダウンロードずみ → ダウンロードしない
//   ・なければ 12B をダウンロード → できなければ E4B(ダウンロードずみなら、しない)
//   node --test tests/server-models.test.js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const { generateKeyPair, exportJWK, SignJWT } = await import(pathToFileURL(createRequire(new URL("../server/index.js", import.meta.url)).resolve("jose")).href);

const PROJECT = "kyoiku-hakkason";
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const listen = (h) => new Promise((ok) => { const s = http.createServer(h).listen(0, "127.0.0.1", () => ok(s)); });
const kid = "k";
let keys, google, ollama;
const llm = { models: [], pulls: [], failPull: new Set(), down: false };

const token = () => new SignJWT({ email: "t@school.ed.jp", email_verified: true, firebase: { sign_in_provider: "google.com", identities: { "google.com": ["1"], email: ["t@school.ed.jp"] } } })
  .setProtectedHeader({ alg: "RS256", kid }).setIssuer(`https://securetoken.google.com/${PROJECT}`).setAudience(PROJECT).setSubject("uid-teacher").setIssuedAt().setExpirationTime("1h").sign(keys.privateKey);

async function startServer(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: String(port), LLM_BASE_URL: `http://127.0.0.1:${ollama.address().port}`, FIREBASE_JWKS_URL: `http://127.0.0.1:${google.address().port}/jwks`, FIRESTORE_URL: `http://127.0.0.1:${google.address().port}`, FIREBASE_PROJECT: PROJECT, TEACHER_EMAILS: "", TEACHER_DOMAINS: "", RELAY: "0", LLM_MODEL: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = { text: "" };
  child.stdout.on("data", (d) => { log.text += d; });
  child.stderr.on("data", (d) => { log.text += d; });
  await new Promise((ok, ng) => {
    const t = setTimeout(() => ng(new Error(`起動しない:${log.text}`)), 10000);
    const iv = setInterval(() => { if (log.text.includes("先生の側のAIサーバー")) { clearTimeout(t); clearInterval(iv); ok(); } }, 50);
    child.on("exit", () => { clearTimeout(t); clearInterval(iv); ng(new Error(`すぐ終了した:${log.text}`)); });
  });
  return { url: `http://127.0.0.1:${port}`, log, stop: () => new Promise((ok) => { if (child.exitCode !== null) return ok(); child.once("exit", ok); child.kill(); }) };
}

before(async () => {
  keys = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid, alg: "RS256", use: "sig" };
  google = await listen((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/jwks") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ keys: [jwk] })); }
    if (/\/documents\/classes\/MINE22$/.test(u.pathname)) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ fields: { teacherUid: { stringValue: "uid-teacher" }, grade: { integerValue: "6" } } })); }
    res.writeHead(404); res.end("{}");
  });
  ollama = await listen((req, res) => {
    if (llm.down) { res.writeHead(500); return res.end("down"); }
    if (req.url === "/api/tags") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ models: llm.models.map((name) => ({ name })) })); }
    if (req.url === "/api/pull") {
      let b = ""; req.on("data", (d) => { b += d; });
      req.on("end", async () => {
        const { model } = JSON.parse(b);
        llm.pulls.push(model);
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.write(JSON.stringify({ status: "pulling manifest" }) + "\n");
        if (llm.failPull.has(model)) return res.end(JSON.stringify({ error: "pull model manifest: file does not exist" }) + "\n");
        res.write(JSON.stringify({ status: "pulling abc", total: 1000, completed: 400 }) + "\n");
        await new Promise((r) => setTimeout(r, 60));
        res.write(JSON.stringify({ status: "pulling abc", total: 1000, completed: 1000 }) + "\n");
        llm.models.push(model);
        res.end(JSON.stringify({ status: "success" }) + "\n");
      });
      return;
    }
    res.writeHead(404); res.end();
  });
});
after(() => { google?.close(); ollama?.close(); });

const reset = (models = [], failPull = []) => { llm.models = [...models]; llm.pulls = []; llm.failPull = new Set(failPull); llm.down = false; };
const ensure = async (s, body = { code: "MINE22" }, tok) => fetch(`${s.url}/api/models/ensure`, { method: "POST", headers: { "Content-Type": "application/json", ...(tok === null ? {} : { Authorization: `Bearer ${tok ?? await token()}` }) }, body: JSON.stringify(body) });
const status = async (s) => (await fetch(`${s.url}/api/models`)).json();
async function waitPhase(s, ph) {
  for (let i = 0; i < 100; i++) { const j = await status(s); if (j.progress.phase === ph) return j; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`${ph} にならない: ${JSON.stringify(await status(s))}`);
}

test("12B がダウンロードずみなら、ダウンロードしない", async () => {
  reset(["gemma4:12b"]);
  const s = await startServer();
  try {
    const st = await status(s);
    assert.deepEqual(st.installed, { "gemma4:12b": true, "gemma4:e4b": false });
    assert.equal(st.active, "gemma4:12b");
    assert.equal((await ensure(s)).status, 202);
    const done = await waitPhase(s, "done");
    assert.equal(done.progress.model, "gemma4:12b");
    assert.match(done.progress.message, /ダウンロードずみ/);
    assert.deepEqual(llm.pulls, [], "ダウンロードしていない");
  } finally { await s.stop(); }
});

test("12B がなければ 12B をダウンロードする(進み具合が見える)", async () => {
  reset([]);
  const s = await startServer();
  try {
    assert.equal((await ensure(s)).status, 202);
    const done = await waitPhase(s, "done");
    assert.deepEqual(llm.pulls, ["gemma4:12b"]);
    assert.equal(done.progress.model, "gemma4:12b");
    assert.equal(done.active, "gemma4:12b");
    assert.equal(done.installed["gemma4:12b"], true);
    assert.equal((await fetch(`${s.url}/ready`)).status, 200);
  } finally { await s.stop(); }
});

test("12B をダウンロードできなければ E4B をダウンロードして、E4B で動かす(/ready・/health も E4B になる)", async () => {
  reset([], ["gemma4:12b"]);
  const s = await startServer();
  try {
    await ensure(s);
    const done = await waitPhase(s, "done");
    assert.deepEqual(llm.pulls, ["gemma4:12b", "gemma4:e4b"]);
    assert.equal(done.progress.model, "gemma4:e4b");
    assert.equal(done.progress.tried[0].model, "gemma4:12b");
    assert.match(done.progress.message, /E4B/);
    assert.equal(done.active, "gemma4:e4b");
    const ready = await (await fetch(`${s.url}/ready`)).json();
    assert.deepEqual({ ok: ready.ok, model: ready.model }, { ok: true, model: "gemma4:e4b" });
    assert.equal((await (await fetch(`${s.url}/health`)).json()).model, "gemma4:e4b");
  } finally { await s.stop(); }
});

test("12B をダウンロードできず、E4B がダウンロードずみなら、E4B はダウンロードしない", async () => {
  reset(["gemma4:e4b"], ["gemma4:12b"]);
  const s = await startServer();
  try {
    await ensure(s);
    const done = await waitPhase(s, "done");
    assert.deepEqual(llm.pulls, ["gemma4:12b"]);
    assert.equal(done.active, "gemma4:e4b");
  } finally { await s.stop(); }
});

test("両方ともダウンロードできなければ、失敗と理由を返す", async () => {
  reset([], ["gemma4:12b", "gemma4:e4b"]);
  const s = await startServer();
  try {
    await ensure(s);
    const e = await waitPhase(s, "error");
    assert.match(e.progress.message, /どちらも|12B も E4B も/);
    assert.equal(e.progress.tried.length, 2);
  } finally { await s.stop(); }
});

test("起動のとき、12B がなく E4B がダウンロードずみなら、E4B で動かす。LLM_MODEL を決めていれば、それを守る", async () => {
  reset(["gemma4:e4b"]);
  let s = await startServer();
  try { assert.equal((await (await fetch(`${s.url}/health`)).json()).model, "gemma4:e4b"); } finally { await s.stop(); }
  s = await startServer({ LLM_MODEL: "gemma4:12b" });
  try { assert.equal((await (await fetch(`${s.url}/health`)).json()).model, "gemma4:12b"); } finally { await s.stop(); }
});

test("ダウンロードを始められるのは、そのクラスの先生だけ。Cloud Run ではできない。Ollama が止まっていれば理由を返す", async () => {
  reset([]);
  const s = await startServer();
  try {
    assert.equal((await ensure(s, { code: "MINE22" }, null)).status, 401, "ログインなし");
    assert.equal((await ensure(s, { code: "NOPE99" })).status, 404, "ないクラス");
    assert.deepEqual(llm.pulls, [], "断ったので、ダウンロードしていない");
    llm.down = true;
    const st = await status(s);
    assert.equal(st.ollama, false);
    assert.match(st.reason, /Ollama/);
  } finally { await s.stop(); }
  const c = await startServer({ K_SERVICE: "x" });
  try {
    assert.equal((await ensure(c)).status, 409);
    assert.equal((await status(c)).canDownload, false);
  } finally { await c.stop(); }
});
