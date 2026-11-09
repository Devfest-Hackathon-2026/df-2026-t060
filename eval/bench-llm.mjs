// AIの速さをくらべる(Ollama / llama.cpp、下書き用モデルあり・なし)。
//   node eval/bench-llm.mjs ollama                         … Ollama(http://127.0.0.1:11434)
//   node eval/bench-llm.mjs llamacpp http://127.0.0.1:8090 名前 … llama.cpp の llama-server
// 3つの仕事(分類・差分だけを返す・プログラムを書く)を、同じ指示・同じ出力の形でたのみ、
// 時間・出力のトークン数・1秒あたりのトークン数を出す。結果は eval/history/bench.jsonl に足す。
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CLASSIFY_SYSTEM, CLASSIFY_SCHEMA, editSystem, editSchema } from "../server/sim2-prompts.js";
import { simCodeSystem, SIM_CODE_SCHEMA } from "../server/draft.js";
import { getSystem } from "../public/js/sim2/systems/index.js";

const [kind = "ollama", url = kind === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:8090", name = kind] = process.argv.slice(2);
const pend = getSystem("pendulum").examples[1].config;
const TASKS = [
  { id: "classify", system: CLASSIFY_SYSTEM, user: "要望:位置エネルギーと運動エネルギーの移り変わりを見せたい", schema: CLASSIFY_SCHEMA, max: 80 },
  { id: "edit", system: editSystem("pendulum"), user: `いまの設定:${JSON.stringify({ params: pend.params, controls: pend.controls, speed: 1 })}\n要望:重力を2倍にして`, schema: editSchema("pendulum"), max: 160 },
  { id: "code", system: simCodeSystem(7), user: "学年: 中1\n授業のテーマ: 月でボールを落とすと、地球よりおそく落ちるか", schema: SIM_CODE_SCHEMA, max: 400 },
];

async function ollama(t) {
  const t0 = performance.now();
  const r = await (await fetch(`${url}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    model: "gemma4:12b", stream: false, think: false, format: t.schema, keep_alive: "30m",
    options: { temperature: 0, num_ctx: 4096, num_predict: t.max }, messages: [{ role: "system", content: t.system }, { role: "user", content: t.user }],
  }) })).json();
  return { ms: performance.now() - t0, tokens: r.eval_count, tps: r.eval_count / (r.eval_duration / 1e9), promptTps: r.prompt_eval_count / (r.prompt_eval_duration / 1e9), text: r.message?.content };
}

async function llamacpp(t) {
  const t0 = performance.now();
  const r = await (await fetch(`${url}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    messages: [{ role: "system", content: t.system }, { role: "user", content: t.user }], temperature: 0, max_tokens: t.max,
    response_format: { type: "json_schema", json_schema: { name: "out", schema: t.schema } },
  }) })).json();
  const tm = r.timings ?? {};
  return { ms: performance.now() - t0, tokens: tm.predicted_n ?? r.usage?.completion_tokens, tps: tm.predicted_per_second, promptTps: tm.prompt_per_second,
    draft: tm.draft_n !== undefined ? `${tm.draft_n_accepted}/${tm.draft_n}` : undefined, text: r.choices?.[0]?.message?.content };
}

const run = kind === "ollama" ? ollama : llamacpp;
const rows = [];
await run({ ...TASKS[0], max: 4 }); // 読みこみ(1回目の時間は数えない)
for (const t of TASKS) {
  const r = await run(t);
  let ok = true; try { JSON.parse(r.text); } catch { ok = false; }
  rows.push({ task: t.id, sec: +(r.ms / 1000).toFixed(1), tokens: r.tokens, tps: +(r.tps ?? 0).toFixed(1), promptTps: +(r.promptTps ?? 0).toFixed(0), draft: r.draft, json: ok });
  console.log(`${name} ${t.id}: ${(r.ms / 1000).toFixed(1)}秒 / 出力 ${r.tokens} トークン / ${(r.tps ?? 0).toFixed(1)} トークン毎秒${r.draft ? ` / 下書きの採用 ${r.draft}` : ""} / JSON ${ok ? "○" : "×"}`);
}
const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(resolve(here, "history"), { recursive: true });
appendFileSync(resolve(here, "history", "bench.jsonl"), JSON.stringify({ at: new Date().toISOString(), name, rows }) + "\n");
