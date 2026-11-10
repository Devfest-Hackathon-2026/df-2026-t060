// Cloud Run に置くAIサーバーの動きのテスト。本物のサーバー(server/index.js)を別のプロセスで起動し、
// 偽の Google(ログインの鍵・クラスを読む Firestore)と、偽の Ollama をつなぐ。インターネットや GPU はいらない。
//   node --test tests/server-cloudrun.test.js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
// jose はサーバー側(server/node_modules)に入っている
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const { generateKeyPair, exportJWK, SignJWT } = await import(pathToFileURL(createRequire(new URL("../server/index.js", import.meta.url)).resolve("jose")).href);

const PROJECT = "kyoiku-hakkason";
const SECRET = "ひみつの質問テキスト12345";
const ORIGIN = "https://kyoiku-hakkason.web.app";

const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const listen = (handler) => new Promise((ok) => { const s = http.createServer(handler).listen(0, "127.0.0.1", () => ok(s)); });

// ---- 偽の Google:ログインの鍵と、クラス(Firestore)。クラスの持ち主は uid-teacher ----
let keys, google, ollama;
const llm = { models: ["gemma4:12b"], down: false, reply: null };
const kid = "test-key";

async function token({ uid = "uid-teacher", email = "hanako@school.ed.jp", google: isGoogle = true, verified = true, aud = PROJECT, iss = `https://securetoken.google.com/${PROJECT}`, exp = "1h" } = {}) {
  const claims = { email, email_verified: verified, firebase: isGoogle ? { sign_in_provider: "google.com", identities: { "google.com": ["1"], email: [email] } } : { sign_in_provider: "anonymous", identities: {} } };
  if (!isGoogle) delete claims.email;
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid }).setIssuer(iss).setAudience(aud).setSubject(uid).setIssuedAt().setExpirationTime(exp).sign(keys.privateKey);
}

async function startServer(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: String(port), LLM_BASE_URL: `http://127.0.0.1:${ollama.address().port}`, FIREBASE_JWKS_URL: `http://127.0.0.1:${google.address().port}/jwks`, FIRESTORE_URL: `http://127.0.0.1:${google.address().port}`, FIREBASE_PROJECT: PROJECT, ALLOWED_ORIGINS: ORIGIN, K_SERVICE: "kyozai-ai-test", TEACHER_EMAILS: "", TEACHER_DOMAINS: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = { text: "" };
  child.stdout.on("data", (d) => { log.text += d; });
  child.stderr.on("data", (d) => { log.text += d; });
  await new Promise((ok, ng) => {
    const t = setTimeout(() => ng(new Error(`サーバーが起動しない:${log.text}`)), 10000);
    const iv = setInterval(() => { if (log.text.includes("先生の側のAIサーバー")) { clearTimeout(t); clearInterval(iv); ok(); } }, 50);
    child.on("exit", () => { clearTimeout(t); clearInterval(iv); ng(new Error(`すぐ終了した:${log.text}`)); });
  });
  const url = `http://127.0.0.1:${port}`;
  return { child, log, url, stop: () => new Promise((ok) => { if (child.exitCode !== null) return ok(); child.once("exit", ok); child.kill(); }) };
}

const post = (url, path, body, tok) => fetch(url + path, { method: "POST", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });

let main;
before(async () => {
  keys = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid, alg: "RS256", use: "sig" };
  google = await listen((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/jwks") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ keys: [jwk] })); }
    const m = /\/documents\/classes\/([A-Z0-9]+)$/.exec(u.pathname);
    if (m && /^Bearer /.test(req.headers.authorization ?? "")) {
      const owner = { MINE22: "uid-teacher", OTHER9: "someone-else" }[m[1]];
      if (!owner) { res.writeHead(404); return res.end("{}"); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ fields: { teacherUid: { stringValue: owner }, grade: { integerValue: "6" } } }));
    }
    res.writeHead(404); res.end();
  });
  ollama = await listen((req, res) => {
    if (llm.down) { res.writeHead(500); return res.end("down"); }
    if (req.url === "/api/tags") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ models: llm.models.map((name) => ({ name })) })); }
    if (req.url === "/api/chat") {
      req.resume();
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      // 返事:JSON として読めない文(児童の質問の文がまざっている、というつもり)
      return res.end(JSON.stringify({ message: { content: llm.reply ?? `これはJSONではありません ${SECRET}` }, done: true, eval_count: 1, eval_duration: 1e9 }) + "\n");
    }
    res.writeHead(404); res.end();
  });
  main = await startServer();
});
after(async () => { await main?.stop(); google?.close(); ollama?.close(); });

test("/health は動いているかだけ(すぐ返す)・Cloud Run で動いていることがわかる。/ready は AI(Ollama)にモデルがあるときだけ 200", async () => {
  const h = await (await fetch(`${main.url}/health`)).json();
  assert.deepEqual({ ok: h.ok, where: h.where, model: h.model }, { ok: true, where: "cloudrun", model: "gemma4:12b" });
  let r = await fetch(`${main.url}/ready`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  llm.models = ["llama3:8b"]; // モデルがまだ読みこまれていない(Cloud Run の起動中)
  r = await fetch(`${main.url}/ready`);
  assert.equal(r.status, 503);
  assert.match((await r.json()).reason, /gemma4:12b がまだありません/);
  llm.models = ["gemma4:12b:latest"]; // :latest のついた名前も同じモデル
  assert.equal((await fetch(`${main.url}/ready`)).status, 200);
  llm.down = true; // Ollama が応答しない
  r = await fetch(`${main.url}/ready`);
  assert.equal(r.status, 503);
  assert.equal((await fetch(`${main.url}/health`)).status, 200, "AI が落ちていても、サーバー自体は動いている");
  llm.down = false; llm.models = ["gemma4:12b"];
});

test("ブラウザの許可(CORS):公開の画面だけ許す。ほかのアドレスには許可を出さない。先生PC(localhost)向けの Private Network の確認にも答える", async () => {
  const ok = await fetch(`${main.url}/api/draft`, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Private-Network": "true" } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(ok.headers.get("access-control-allow-private-network"), "true");
  assert.match(ok.headers.get("access-control-allow-headers"), /Authorization/);
  const bad = await fetch(`${main.url}/ready`, { headers: { Origin: "https://evil.example" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("AIを使えるのは、Google でログインした、そのクラスの先生だけ(ログインなし・匿名・期限切れ・別のアドレス向け・ほかの先生のクラスは断る)", async () => {
  const body = { code: "MINE22", questions: [] }; // 中身はわざとおかしい:ログインが通れば 400(質問は1〜40件)、通らなければ 401/403
  assert.equal((await post(main.url, "/api/group", body)).status, 401, "ログインなし");
  const anon = await post(main.url, "/api/group", body, await token({ google: false, uid: "kid-1" }));
  assert.equal(anon.status, 401);
  assert.match((await anon.json()).error, /Google でログイン/);
  assert.equal((await post(main.url, "/api/group", body, "not.a.jwt")).status, 401, "でたらめなトークン");
  assert.equal((await post(main.url, "/api/group", body, await token({ exp: "-1h" }))).status, 401, "期限切れ");
  assert.equal((await post(main.url, "/api/group", body, await token({ aud: "other-project" }))).status, 401, "別のプロジェクト向け");
  assert.equal((await post(main.url, "/api/group", body, await token({ iss: "https://evil.example" }))).status, 401, "発行元がちがう");
  const other = await post(main.url, "/api/group", { code: "OTHER9", questions: [] }, await token());
  assert.equal(other.status, 403);
  assert.match((await other.json()).error, /このクラスの先生ではありません/);
  assert.equal((await post(main.url, "/api/group", { code: "NOCLASS", questions: [] }, await token())).status, 404);
  const good = await post(main.url, "/api/group", body, await token());
  assert.equal(good.status, 400, "ログインは通った(中身のまちがいで 400)");
  assert.match((await good.json()).error, /質問は1〜40件/);
});

test("許可するメール・ドメインを決めると、ほかの Google アカウントは、クラスの先生でも使えない(Cloud Run で、他人にAIを使われない)", async () => {
  const s = await startServer({ TEACHER_DOMAINS: "school.ed.jp", TEACHER_EMAILS: "guest@example.com" });
  try {
    const body = { code: "MINE22", questions: [] };
    assert.equal((await post(s.url, "/api/group", body, await token({ email: "hanako@school.ed.jp" }))).status, 400, "ドメインで許可");
    assert.equal((await post(s.url, "/api/group", body, await token({ email: "guest@example.com" }))).status, 400, "メールで許可");
    const no = await post(s.url, "/api/group", body, await token({ email: "someone@gmail.com" }));
    assert.equal(no.status, 403);
    assert.match((await no.json()).error, /許可されていません/);
    assert.equal((await post(s.url, "/api/group", body, await token({ email: "x@school.ed.jp.evil.com" }))).status, 403, "ドメインのなりすまし");
    assert.equal((await post(s.url, "/api/group", body, await token({ email: "hanako@school.ed.jp", verified: false }))).status, 403, "メールが確かめられていない");
  } finally { await s.stop(); }
});

test("児童の質問の文は、サーバーのログに残らない(AIの返事がこわれて 500 になったときも)", async () => {
  const q = [{ id: "q1", text: `${SECRET} 振り子の周期は?` }];
  const res = await post(main.url, "/api/group", { code: "MINE22", questions: q }, await token());
  assert.equal(res.status, 500, "AIの返事がJSONでないので、500");
  assert.match((await res.json()).error, /AIの案を作れませんでした/);
  assert.ok(main.log.text.includes("500"), "500 が起きたことは記録する");
  assert.ok(!main.log.text.includes(SECRET), `質問の文がログに出ている:${main.log.text}`);
  assert.ok(!main.log.text.includes("振り子の周期"), "質問の文がログに出ている");
});

test("止める合図(SIGTERM)で、きれいに止まる(Linux。Windows では SIGTERM が強制終了になるので試さない)", { skip: process.platform === "win32" }, async () => {
  const s = await startServer();
  const code = await new Promise((ok) => { s.child.once("exit", (c) => ok(c)); s.child.kill("SIGTERM"); });
  assert.equal(code, 0);
  assert.match(s.log.text, /SIGTERM を受けとったので止めます/);
});
