// 先生の側のAIサーバー。先生画面から呼ばれ、質問のまとめと教材の案を返す。
//   cd server; npm install; npm start   → http://localhost:8787
// いまは先生PCで動かす。Cloud Run に載せるときも、このまま(LLM_BASE_URL を Ollama に向ける)。
//
// 守っていること
// - 呼べるのは、そのクラスの先生だけ(Firebase の ID トークンを確かめ、先生本人の権限でクラスを読む)。
//   サーバーに秘密の鍵は置かない。
// - 児童の質問の文は、ログに残さない(件数と時間だけ)。
// - AIは一度に1つずつ動かす。待ちが多いときは断る(GPUを守る)。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { checkTeacherClaims } from "./auth.js";
import { createRelay } from "./relay/index.js";
import { groupQuestions, draftMaterial, answerQuestion, checkLlm, MODEL } from "./draft.js";
import { modelStatus, ensureModel, autoSelect } from "./models.js";
import { labPreset } from '../public/js/hybrid-lab.js';
import { proposeInquiry } from './inquiry-plan.js';
import { proposeLab } from './lab-plan.js';

const PORT = Number(process.env.PORT ?? 8787);
const PROJECT = process.env.FIREBASE_PROJECT ?? "kyoiku-hakkason";
const ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ??
    "https://kyoiku-hakkason.web.app,https://kyoiku-hakkason.firebaseapp.com,https://kyoiku-hakkason--demo-share-yupfa3zo.web.app,http://localhost:5000,http://127.0.0.1:5000,http://localhost:8001,http://127.0.0.1:8001")
    .split(",").map((s) => s.trim()).filter(Boolean)
);
// ログインの確認に使う鍵の場所と、クラスを読む Firestore の場所。ふつうは Google のもの。テストでだけ、環境変数で差しかえる
const JWKS_URL = process.env.FIREBASE_JWKS_URL ?? "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const FIRESTORE_URL = process.env.FIRESTORE_URL ?? "https://firestore.googleapis.com";
// Cloud Run で動いているとき(K_SERVICE が入る)
const WHERE = process.env.K_SERVICE ? "cloudrun" : "local";

// Bluetooth 教室(先生PCの中に教室のデータを持ち、児童の Chromebook と Bluetooth でつなぐ)。先生PCのときだけ。Cloud Run では動かさない。
//   RELAY=0 で止める / RELAY_BLE_PORT:中継アプリ(relay/TeacherRelay)がつなぐ口(ふつう 8788。off で口を開けない) / RELAY_DATA_DIR:教室のデータの保存先
const RELAY_ON = WHERE === "local" && process.env.RELAY !== "0";
const BLE_PORT_ENV = process.env.RELAY_BLE_PORT ?? "8788";
const relay = RELAY_ON
  ? await createRelay({
    dataDir: process.env.RELAY_DATA_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "data"),
    bridgePort: BLE_PORT_ENV === "off" ? null : Number(BLE_PORT_ENV),
    log: (m) => console.log(`[bluetooth教室] ${m}`),
  })
  : null;
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

// ---------- 先生の画面(public/)を配る ----------
const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".gz": "application/gzip", ".webmanifest": "application/manifest+json" };
async function serveStatic(pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return false; }
  if (rel === "/") rel = "/index.html";
  const file = resolve(PUBLIC_DIR, "." + rel);
  // public/ の外のファイルは配らない(../ で外に出ようとしても止める)
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + sep)) return false;
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) return false;
  try {
    const body = await readFile(file);
    // 閉じた枠(sandbox)の中から読むモジュール(js/・mpl/)は、ほかのアドレス扱いになるので許可をつける
    const shared = /^\/(js|css|mpl)\//.test(rel) ? { "Access-Control-Allow-Origin": "*" } : {};
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache", ...shared });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- 先生かどうかを確かめる ----------

async function verifyTeacher(req, code) {
  // Bluetooth 教室(先生PCの中のクラス)の先生は、この先生PC自身(localhost の先生の画面)。Google ログインなしで、AIを使える
  // (ネットがなくても、先生PCの Ollama で動かせるように)。そのクラスのコードを知っていて、同じパソコンの画面からの呼び出しだけ
  if (!req.headers.authorization) { const local = relay?.localTeacher(req, code); if (local) return local; }
  const m = /^Bearer ([\w.-]+)$/.exec(req.headers.authorization ?? "");
  if (!m) throw new HttpError(401, "ログインの情報がありません");
  const token = m[1];
  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT}`,
      audience: PROJECT,
    }));
  } catch {
    throw new HttpError(401, "ログインの情報を確かめられませんでした。ページを読みこみ直してください");
  }
  // 先生は Google ログインの人だけ(匿名ログインの児童は使えない)。許可するメール・ドメインが決めてあれば、その人だけ
  try { checkTeacherClaims(payload); } catch (e) { throw new HttpError(e.status ?? 403, e.message); }
  if (typeof code !== "string" || !/^[A-Z0-9]{4,8}$/.test(code)) throw new HttpError(400, "クラスコードがおかしい");

  // 先生本人のトークンで Firestore のクラスを読む(ルールどおりに読める範囲だけ)
  const res = await fetch(
    `${FIRESTORE_URL}/v1/projects/${PROJECT}/databases/(default)/documents/classes/${code}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 404) throw new HttpError(404, "クラスが見つかりません");
  if (!res.ok) throw new HttpError(403, "クラスを読めませんでした");
  const f = (await res.json()).fields ?? {};
  if (f.teacherUid?.stringValue !== payload.sub) throw new HttpError(403, "このクラスの先生ではありません");
  const grade = Number(f.grade?.integerValue);
  // 対象は小5〜中3。学年のない前のクラスは小5として扱う
  return { uid: payload.sub, grade: Number.isInteger(grade) && grade >= 5 && grade <= 9 ? grade : 5 };
}


// 公開デモから先生PCのOllamaを使うための限定認証。
// Firebaseの通常認証は変更せず、明示ヘッダー + 許可済みOrigin + loopback接続に限定する。
function verifyLocalDemo(req, body) {
  const ip = String(req.socket?.remoteAddress ?? "");
  const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const origin = req.headers.origin;
  if (WHERE !== "local" || !loopback || req.headers["x-kyozai-demo"] !== "1" || !origin || !ORIGINS.has(origin)) {
    throw new HttpError(401, "デモ用のローカルAI接続が許可されていません");
  }
  if (typeof body.code !== "string" || !/^[A-Z0-9]{4,8}$/.test(body.code)) {
    throw new HttpError(400, "クラスコードがおかしい");
  }
  const grade = Number(body.grade);
  return { uid: "local-demo", grade: Number.isInteger(grade) && grade >= 5 && grade <= 9 ? grade : 9 };
}

async function verifyTeacherRequest(req, body) {
  if (req.headers["x-kyozai-demo"] === "1") return verifyLocalDemo(req, body);
  return verifyTeacher(req, body.code);
}

// ---------- AIは1つずつ ----------

let chain = Promise.resolve();
let waiting = 0;
const MAX_WAITING = 3;
function oneAtATime(fn) {
  if (waiting >= MAX_WAITING) throw new HttpError(429, "AIがいそがしいので、少し待ってからもう一度ためしてください");
  waiting++;
  const run = chain.then(fn);
  chain = run.catch(() => {}).finally(() => { waiting--; });
  return run;
}

// ---------- 入力を調べる ----------

const str = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
// 今日の授業(なくてもよい)
function readLesson(b) {
  if (b.lesson === undefined || b.lesson === null || b.lesson === "") return "";
  if (typeof b.lesson !== "string" || b.lesson.length > 200) throw new HttpError(400, "今日の授業は200字までです");
  return b.lesson.trim();
}

function readAnswerBody(b) {
  if (!str(b.question, 200)) throw new HttpError(400, "質問は200字までです");
  if (b.materialTitle !== undefined && b.materialTitle !== null && (typeof b.materialTitle !== "string" || b.materialTitle.length > 60)) {
    throw new HttpError(400, "教材の題がおかしい");
  }
  return { question: b.question.trim(), materialTitle: b.materialTitle?.trim() || "", lesson: readLesson(b) };
}

function readSampleBody(b) {
  if (!str(b.topic, 100)) throw new HttpError(400, "テーマは100字までです");
  if (b.simType && !labPreset(b.simType)) throw new HttpError(400, "工房の実験から選んでください");
  return { topic: b.topic.trim(), simType: b.simType || null, lesson: readLesson(b) };
}

function readGroupBody(b) {
  if (!Array.isArray(b.questions) || b.questions.length < 1 || b.questions.length > 40) {
    throw new HttpError(400, "質問は1〜40件で送ってください");
  }
  const questions = b.questions.map((q) => {
    if (!q || !str(q.id, 64) || !str(q.text, 200)) throw new HttpError(400, "質問の形がおかしい");
    return { id: q.id, text: q.text.trim() };
  });
  return { questions };
}

function readDraftBody(b) {
  // 「これだけで案」は児童の質問(200字まで)をそのまま問いとして送る
  if (!str(b.rephrased, 200)) throw new HttpError(400, "取り上げる問いは200字までです");
  if (!Array.isArray(b.questions) || b.questions.length < 1 || b.questions.length > 40 || !b.questions.every((t) => str(t, 200))) {
    throw new HttpError(400, "質問は1〜40件、1件200字までです");
  }
  return { rephrased: b.rephrased.trim(), questions: b.questions.map((t) => t.trim()) };
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new HttpError(413, "送る量が多すぎます"); // 直すシミュレーションのプログラムも入るので 64KB まで
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new HttpError(400, "JSONではありません"); }
}

// ---------- サーバー ----------

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Kyozai-Demo");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
    // 公開ページ → 先生PC(localhost)への呼び出しをブラウザに許してもらう
    if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const started = performance.now();
  const url = new URL(req.url, "http://x");
  cors(req, res);
  try {
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (relay && url.pathname.startsWith("/relay/") && await relay.handleHttp(req, res, url, { readJson, HttpError })) return;
    // /health:このサーバーが動いているか(すぐ返す)。/ready:AI(Ollama)まで使えるか(Cloud Run の起動の確認・先生の画面の「つながっています」)
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, model: MODEL, where: WHERE });
    if (req.method === "GET" && url.pathname === "/ready") {
      const r = await checkLlm();
      return send(res, r.ok ? 200 : 503, { ...r, where: WHERE });
    }

    // AIモデルの用意(先生PCの Ollama)。状態は誰でも見られる(モデル名と進み具合だけ)。ダウンロードを始めるのは、そのクラスの先生だけ。Cloud Run では使わない
    if (req.method === "GET" && url.pathname === "/api/models") return send(res, 200, { ...(await modelStatus()), where: WHERE, canDownload: WHERE === "local" });
    if (req.method === "POST" && url.pathname === "/api/models/ensure") {
      const body = await readJson(req);
      if (WHERE !== "local") throw new HttpError(409, "Cloud Run のAIは、画面からはダウンロードできません(Ollama 側にモデルを入れてください)");
      await verifyTeacherRequest(req, body);
      let r;
      try { r = ensureModel(); } catch (e) { throw new HttpError(e.status ?? 500, e.message); }
      return send(res, 202, { ...r, ...(await modelStatus()) });
    }

    if (req.method === "POST" && url.pathname === "/api/group") {
      const body = await readJson(req);
      const { grade } = await verifyTeacherRequest(req, body);
      const { questions } = readGroupBody(body);
      const lesson = readLesson(body);
      const out = await oneAtATime(() => groupQuestions(questions, grade, lesson));
      console.log(`group ${questions.length}件 → ${out.groups.length}グループ ${Math.round(performance.now() - started)}ms`);
      return send(res, 200, { ...out, grade, model: MODEL });
    }

    if (req.method === "POST" && url.pathname === "/api/draft") {
      const body = await readJson(req);
      const { grade } = await verifyTeacherRequest(req, body);
      const group = readDraftBody(body);
      const lesson = readLesson(body);
      const out = await oneAtATime(() => draftMaterial(group, grade, { lesson }));
      console.log(`draft 質問${group.questions.length}件 警告${out.warnings.length} ${Math.round(performance.now() - started)}ms`);
      return send(res, 200, { ...out, grade, model: MODEL });
    }

    if (req.method === 'POST' && url.pathname === '/api/lab-plan') {
      const body = await readJson(req);
      const { grade } = await verifyTeacherRequest(req, body);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > 500) throw new HttpError(400, '実験の希望を1〜500字で書いてください');
      let out;
      try { out = await oneAtATime(() => proposeLab(text, grade)); }
      catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, 'Gemmaの案を確認できませんでした。AIの接続を確認するか、実験一覧から選んでください。'); }
      return send(res, 200, out);
    }
    if (req.method === 'POST' && url.pathname === '/api/inquiry-plan') {
      const body = await readJson(req);
      await verifyTeacherRequest(req, body);
      const out = await oneAtATime(() => proposeInquiry(body.inquiryContext, body.question));
      return send(res, 200, out);
    }

    // 1人の質問に答える(先生が直して、その児童だけに返す)
    if (req.method === "POST" && url.pathname === "/api/answer") {
      const body = await readJson(req);
      const { grade } = await verifyTeacherRequest(req, body);
      const q = readAnswerBody(body);
      let out;
      if (body.inquiryContext) {
        const generated = await oneAtATime(() => proposeInquiry(body.inquiryContext, q.question));
        const plan = generated.plan;
        out = { answer: plan.answer, teacherNote: plan.rationale + '\n' + plan.distinguish,
          sim: { type: 'cfg', config: plan.configs[0], goal: plan.question }, facts: [], warnings: [],
          notes: ['児童が送った実験記録を根拠にした未承認案です。比較2件をクラスへ返す場合は、質問の根拠カードから教材を作ってください。'], stats: { sec: Number(((performance.now() - started) / 1000).toFixed(1)) } };
      } else out = await oneAtATime(() => answerQuestion(q, grade));
      console.log(`answer 警告${out.warnings.length} ${Math.round(performance.now() - started)}ms`);
      return send(res, 200, { ...out, grade, model: MODEL });
    }

    // サンプル教材(テーマとシミュレーションの種類から)
    if (req.method === "POST" && url.pathname === "/api/sample") {
      const body = await readJson(req);
      const { grade } = await verifyTeacherRequest(req, body);
      const s = readSampleBody(body);
      const out = await oneAtATime(() => draftMaterial({ rephrased: s.topic, questions: [] }, grade, { simType: s.simType, lesson: s.lesson }));
      console.log(`sample ${s.simType ?? "おまかせ"} 警告${out.warnings.length} ${Math.round(performance.now() - started)}ms`);
      return send(res, 200, { ...out, grade, model: MODEL });
    }

    // 先生の画面そのもの(public/)も配る。先生PCで http://localhost:8787/teacher.html を開けば、
    // 画面とAIが同じ場所になり、ブラウザの「ローカルネットワークへのアクセス」の許可がいらない
    // オフライン保存も同じ配信元から読む。公開版への案内は、オンライン教室のリンクにだけ置く。
    if (req.method === "GET" && await serveStatic(url.pathname, res)) return;

    send(res, 404, { error: "ありません" });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    // 500 のログには、エラーの種類と、最初の一文だけを残す。AIの返事の一部(児童の質問の文がまざることがある)は残さない
    // (くわしく見たいときだけ LOG_VERBOSE=1。先生PCで試すとき用)
    if (status === 500) console.error(process.env.LOG_VERBOSE === "1" ? err : `500 ${err?.name ?? "Error"}: ${String(err?.message ?? err).split(/[:：\n]/)[0].slice(0, 80)}`);
    send(res, status, { error: status === 500 ? "AIの案を作れませんでした。AI(Ollama)が動いているか確かめてください" : err.message });
  }
});

// 停止の合図(Cloud Run は止める前に SIGTERM を送る):新しい接続を止めて、いまの処理は終わるまで待つ(最長 9 秒)
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`${sig} を受けとったので止めます`);
    server.close(() => { Promise.resolve(relay?.close()).finally(() => process.exit(0)); });
    setTimeout(() => process.exit(0), 9000).unref();
  });
}

await autoSelect();
server.listen(PORT, () => {
  console.log(`先生の側のAIサーバー http://localhost:${PORT}  モデル: ${MODEL}${WHERE === "cloudrun" ? "(Cloud Run)" : ""}`);
  console.log(`先生の画面はここを開く(許可がいらない): http://localhost:${PORT}/teacher.html`);
  console.log(`使ってよい画面: ${[...ORIGINS].join(", ")}`);
  if (relay) console.log(`Bluetooth 教室:先生の画面は http://localhost:${PORT}/teacher.html?relay${relay.bridge ? `(中継アプリとの口 127.0.0.1:${relay.bridge.port})` : ""}`);
});
