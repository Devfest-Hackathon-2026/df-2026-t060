// AIサーバーの場所(api-url.js)のテスト:使ってよいアドレスだけ許す・どこを使うかの順番・Cloud Run の起動待ち。
//   node --test tests/api-url.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateApiUrl, chooseApiUrl, apiKind, apiKindLabel, waitUntilReady, waitText, LOCAL_API } from "../public/js/api-url.js";

test("使ってよいアドレス:先生PC(localhost)と Cloud Run(*.run.app, https)だけ。トークンや質問を盗めるアドレスは断る", () => {
  assert.equal(validateApiUrl("http://localhost:8787"), "http://localhost:8787");
  assert.equal(validateApiUrl("http://127.0.0.1:8787/teacher.html"), "http://127.0.0.1:8787", "パスは落として、場所(オリジン)だけにする");
  assert.equal(validateApiUrl("https://kyozai-ai-abc123-an.a.run.app/"), "https://kyozai-ai-abc123-an.a.run.app");
  assert.equal(validateApiUrl("  https://kyozai-ai-1234567890.asia-northeast1.run.app  "), "https://kyozai-ai-1234567890.asia-northeast1.run.app");
  for (const bad of [
    "https://evil.example", "http://evil.example", "https://run.app", "https://evil-run.app", "https://x.run.app.evil.com",
    "https://evil.com/.run.app", "https://x.run.app@evil.com", "https://user:pass@x.run.app", "http://x.run.app", // Cloud Run は https だけ
    "https://localhost:8787", "http://localhost.evil.com:8787", "ftp://localhost", "javascript:alert(1)", "//evil.com", "", null, undefined, "x.run.app",
  ]) assert.equal(validateApiUrl(bad), null, `断るべき:${bad}`);
});

test("どこを使うか:?api=(試すとき用)→ 先生が選んで保存したもの → 先生PC。使えないアドレスは飛ばす", () => {
  const cr = "https://kyozai-ai-x.a.run.app";
  assert.equal(chooseApiUrl({}), LOCAL_API);
  assert.equal(chooseApiUrl({ stored: cr }), cr);
  assert.equal(chooseApiUrl({ param: "http://127.0.0.1:9000", stored: cr }), "http://127.0.0.1:9000");
  assert.equal(chooseApiUrl({ param: "https://evil.example", stored: cr }), cr, "?api= が使えないアドレスなら、保存したものを使う");
  assert.equal(chooseApiUrl({ param: "https://evil.example", stored: "https://evil2.example" }), LOCAL_API);
  assert.equal(apiKind(cr), "cloud"); assert.equal(apiKind(LOCAL_API), "local");
  assert.equal(apiKindLabel(cr), "Cloud Run"); assert.equal(apiKindLabel(LOCAL_API), "先生PC");
});

test("Cloud Run の起動待ち:準備ができたらすぐ戻る・できるまで間をおいて見る・待ちすぎたらあきらめて理由を返す・つながらなくても落ちない", async () => {
  let t = 0; const sleeps = [];
  const clock = { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } };
  // すぐ使える
  assert.deepEqual(await waitUntilReady({ check: async () => ({ ok: true }), ...clock }), { ok: true, waitedMs: 0 });
  // 3回目で使える(はじめの2回は、つながらない・モデルがまだ)
  let n = 0; const seen = [];
  const r = await waitUntilReady({
    check: async () => { n++; if (n === 1) throw new Error("network"); return n < 3 ? { ok: false, reason: "モデルがまだありません" } : { ok: true }; },
    onWait: (i) => seen.push(i.reason), intervalMs: 5000, ...clock,
  });
  assert.equal(r.ok, true); assert.equal(r.waitedMs, 10000); assert.deepEqual(sleeps, [5000, 5000]);
  assert.match(seen[0], /つながりません/); assert.equal(seen[1], "モデルがまだありません");
  // 待ちすぎ:最後の理由を返す
  t = 0;
  const ng = await waitUntilReady({ check: async () => ({ ok: false, reason: "Ollama が 500" }), intervalMs: 10000, maxMs: 30000, ...clock });
  assert.deepEqual({ ok: ng.ok, reason: ng.reason, waitedMs: ng.waitedMs }, { ok: false, reason: "Ollama が 500", waitedMs: 30000 });
  assert.equal(waitText(5000), "5秒"); assert.equal(waitText(65000), "1分05秒"); assert.equal(waitText(200000), "3分20秒");
});
