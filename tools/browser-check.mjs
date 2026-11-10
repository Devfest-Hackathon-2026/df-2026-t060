// 本物のブラウザ(Chrome / Edge のヘッドレス)で、tests/browser/*.html を開いて結果を確かめる。
//   node tools/browser-check.mjs                     … tests/browser の全部
//   node tools/browser-check.mjs three3d-input       … 1つだけ
//   SCREENSHOT=1 node tools/browser-check.mjs        … 画面の写真も tests/browser/out/ に残す
// しくみ:public/ を http://localhost:8099/ で配り、tests/browser/<名前>.html を /__test/<名前>.html で配る。
//   ページは結果を <pre id="result">{"ok":true,...}</pre> に書く。--dump-dom でそれを読む。
// 3D(WebGL)は SwiftShader(ソフトウェアの描画)で動かすので、GPU がなくても確かめられる。
import http from "node:http";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const PAGES = path.join(ROOT, "tests", "browser");
const PORT = Number(process.env.PORT ?? 8099);
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".html": "text/html; charset=utf-8", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

const BROWSERS = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

// 名前が relay- で始まるページのために、本物のサーバー(server/index.js)を起動して、そこへ /relay/ と /api/ をそのまま通す。
// (ページは tests/browser から配られる別の場所なので、サーバーの「同じ場所の画面だけ」の確認を通るよう、Host と Origin は、サーバー自身のものに書きかえて通す。
//  サーバーの確認そのものは、tests/relay-server.test.js で確かめている)
// /__relay/ask?code=…&text=… は、中継アプリのかわりに、Bluetooth の口(TCP)から、児童の端末が質問を送る。
let relayServer = null;
async function startRelayServer() {
  const probe = net.createServer().listen(0);
  await new Promise((ok) => probe.once("listening", ok));
  const port = probe.address().port; probe.close();
  const child = spawn(process.execPath, ["server/index.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), RELAY_BLE_PORT: "0", RELAY_DATA_DIR: mkdtempSync(path.join(tmpdir(), "relay-bc-")), LLM_BASE_URL: "http://127.0.0.1:1" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
  await new Promise((ok, ng) => { const t0 = Date.now(); const iv = setInterval(() => { if (log.includes("使ってよい画面")) { clearInterval(iv); ok(); } else if (Date.now() - t0 > 10000) { clearInterval(iv); ng(new Error("サーバーが起動しない:" + log)); } }, 50); });
  return { child, port, bridgePort: Number(/中継アプリとの口:127\.0\.0\.1:(\d+)/.exec(log)?.[1]), stop: () => child.kill() };
}
async function askViaBridge(bridgePort, code, text, seat = 7) {
  const { Framer, Reassembler, encodeMessage, decodeMessage, toBase64, fromBase64 } = await import("../public/js/relay/protocol.js");
  const sock = net.connect(bridgePort, "127.0.0.1"); sock.setEncoding("utf8");
  await new Promise((ok, ng) => { sock.once("connect", ok); sock.once("error", ng); });
  const re = new Reassembler(); const msgs = []; let buf = "";
  sock.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.t === "tx") { const r = re.push(fromBase64(m.b)); if (r.message) msgs.push(decodeMessage(r.message)); } } catch { /* 読めない行 */ } } });
  const send = (o) => sock.write(JSON.stringify(o) + "\n");
  send({ t: "open", s: "browser-check", mtu: 100 });
  const f = new Framer();
  for (const c of f.split(encodeMessage({ id: 1, op: "sendQuestion", code, q: { seat, text } }), 60)) send({ t: "rx", s: "browser-check", b: toBase64(c) });
  const t0 = Date.now();
  while (!msgs.some((m) => m.id === 1) && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 20));
  sock.destroy();
  return msgs.find((m) => m.id === 1) ?? { ok: false, error: "返事がない" };
}
// Bluetooth の児童の端末として、教材の一覧を受けとる(watchMaterials をして、最初に届く一覧を返す)
async function materialsViaBridge(bridgePort, code) {
  const { Framer, Reassembler, encodeMessage, decodeMessage, toBase64, fromBase64 } = await import("../public/js/relay/protocol.js");
  const sock = net.connect(bridgePort, "127.0.0.1"); sock.setEncoding("utf8");
  await new Promise((ok, ng) => { sock.once("connect", ok); sock.once("error", ng); });
  const re = new Reassembler(); const parts = []; let buf = "";
  sock.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.t === "tx") { const r = re.push(fromBase64(m.b)); if (r.message) { const x = decodeMessage(r.message); if (x.push === "materials") parts.push(x); } } } catch { /* 読めない行 */ } } });
  const send = (o) => sock.write(JSON.stringify(o) + "\n");
  send({ t: "open", s: "browser-check-m", mtu: 100 });
  const f = new Framer();
  for (const c of f.split(encodeMessage({ id: 1, op: "watchMaterials", code }), 60)) send({ t: "rx", s: "browser-check-m", b: toBase64(c) });
  const t0 = Date.now();
  while ((!parts.length || parts.length < parts[0].parts) && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 20));
  sock.destroy();
  return parts.flatMap((p) => p.list);
}
function proxy(req, res, url) {
  const headers = { ...req.headers, host: `localhost:${relayServer.port}` }; delete headers.origin; delete headers.referer;
  const p = http.request({ host: "127.0.0.1", port: relayServer.port, method: req.method, path: url.pathname + url.search, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", () => { res.writeHead(502).end(); });
  req.pipe(p);
  res.on("close", () => p.destroy());
}

function serve() {
  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, "http://x");
    if (relayServer && (reqUrl.pathname.startsWith("/relay/") || reqUrl.pathname.startsWith("/api/") || reqUrl.pathname === "/ready" || reqUrl.pathname === "/health")) { proxy(req, res, reqUrl); return; }
    if (relayServer && reqUrl.pathname === "/__relay/materials") {
      const r = await materialsViaBridge(relayServer.bridgePort, reqUrl.searchParams.get("code"));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(r)); return;
    }
    if (relayServer && reqUrl.pathname === "/__relay/ask") {
      const r = await askViaBridge(relayServer.bridgePort, reqUrl.searchParams.get("code"), reqUrl.searchParams.get("text") ?? "", Number(reqUrl.searchParams.get("seat")) || 7);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(r)); return;
    }
    const u = decodeURIComponent(reqUrl.pathname);
    const file = u.startsWith("/__test/") ? path.join(PAGES, path.basename(u)) : path.join(PUBLIC, path.normalize(u).replace(/^([/\\])+/, ""));
    if (!file.startsWith(PUBLIC) && !file.startsWith(PAGES)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

function run(exe, args, timeoutMs = 60000) {
  return new Promise((ok) => {
    const p = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    // BROWSER_LOG=1:ブラウザの console のメッセージ(エラーなど)を表示する(原因をさがすとき用)
    if (process.env.BROWSER_LOG) p.stderr.on("data", (d) => { const t = String(d); if (/CONSOLE|Uncaught/.test(t)) process.stderr.write(t); });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.on("close", () => { clearTimeout(timer); ok(out); });
  });
}

const exe = BROWSERS.find((b) => existsSync(b));
if (!exe) { console.error("Chrome / Edge が見つかりません(環境変数 CHROME で場所を指定できます)"); process.exit(2); }
const only = process.argv[2];
const names = (await readdir(PAGES)).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)).filter((n) => !only || n === only);
const server = await serve();
const flags = ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--window-size=900,900", "--virtual-time-budget=30000", ...(process.env.BROWSER_LOG ? ["--enable-logging=stderr", "--v=0"] : [])];
// Playwright を入れた環境では、仮想時計ではなく実時間のブラウザで同じテストを実行できる。
const driver = process.env.BROWSER_DRIVER === 'playwright' ? createRequire(import.meta.url)('playwright').chromium : null;
async function readPage(url, noWebgl) {
  const browser = await driver.launch({ executablePath: exe, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(noWebgl ? ['--disable-3d-apis'] : [])] });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    page.on('pageerror', err => process.env.BROWSER_LOG && console.error(err.message));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    try { await page.waitForFunction(() => {
      try { return typeof JSON.parse(document.querySelector('#result').textContent).ok === 'boolean' && !JSON.parse(document.querySelector('#result').textContent).partial; }
      catch { return false; }
    }, { timeout: 20000 }); }
    catch { /* 結果欄が読めなかった場合は既存の集計に渡す */ }
    return await page.content();
  } finally { await browser.close(); }
}
let failed = 0;
for (const name of names) {
  const url = `http://localhost:${PORT}/__test/${name}.html`;
  // relay- のページには、ページごとに、新しい本物のサーバーをつなぐ(前のページが作ったクラスが残らないように)
  if (name.startsWith("relay-")) { relayServer?.stop(); await new Promise((r) => setTimeout(r, 300)); relayServer = await startRelayServer(); }
  // 名前に "nowebgl" を含むページは、WebGL を無効にして開く(GPU が使えない端末のまねをする)
  const pageFlags = name.includes("nowebgl") ? [...flags, "--disable-3d-apis"] : flags;
  // (relay- のページは、終わらない通信(SSE)があると仮想の時間が進まないので、ページの側で、SSE のかわりに、最初の知らせだけ読む偽の EventSource を使う)
  const runFlags = pageFlags;
  const dom = driver ? await readPage(url, name.includes("nowebgl")) : await run(exe, [...runFlags, "--dump-dom", url]);
  const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(dom);
  let result = null;
  try { result = m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")) : null; } catch { result = null; }
  if (!result && process.env.BROWSER_LOG) {
    // 結果が読めないとき、結果欄のまわりと DOM の長さを表示する(原因をさがすとき用)
    const around = /<pre id="result">[\s\S]{0,400}/.exec(dom)?.[0] ?? "(結果欄がない)";
    console.log("   [DOM の結果欄のまわり]", around, "\n   [DOM の長さ]", dom.length);
  }
  const ok = result?.ok === true;
  if (!ok) failed++;
  console.log(`${ok ? "✔" : "✖"} ${name}${result ? "" : "(結果が読めない)"}`);
  for (const c of result?.checks ?? []) console.log(`   ${c.ok ? "✔" : "✖"} ${c.name}${c.detail ? `:${c.detail}` : ""}`);
  if (result?.error) console.log(`   エラー:${result.error}`);
  if (process.env.SCREENSHOT) {
    await mkdir(path.join(PAGES, "out"), { recursive: true });
    await run(exe, [...runFlags, `--screenshot=${path.join(PAGES, "out", `${name}.png`)}`, url]);
  }
}
relayServer?.stop();
server.close();
process.exit(failed ? 1 : 0);
