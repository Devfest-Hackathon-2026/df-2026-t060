// 児童の実験助手の評価(児童らしい言い方の要望50件)。
//   node eval/run-student.mjs local                      … AIなし(ことばの照らし合わせ)
//   node eval/run-student.mjs ollama <モデル>             … Ollama のモデル(同じ指示・同じ出力の形)
//   node eval/run-student.mjs file 結果.json "名前"       … ブラウザ(WebLLM)で出した答えを採点する
// 正答率・応答時間(平均・最大)・メモリ(わかるとき)を出し、eval/history/student.jsonl に足す。
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assistantPrompt, actionSchema, applyAction, localAction } from "../public/js/sim2/core/assistant.js";
import { getSystem } from "../public/js/sim2/systems/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const [mode = "local", arg, label] = process.argv.slice(2);
export const REQS = readFileSync(resolve(here, process.env.STUDENT_SET ?? "student-requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const baseOf = (ref) => { const [s, i] = ref.split("#"); return getSystem(s).examples[Number(i)].config; };

/** 採点:アクションをアプリで当てた結果が、期待どおりか */
export function judge(req, action) {
  const base = baseOf(req.base), e = req.expect;
  const r = applyAction(base, action, { base });
  if (r.kind !== e.kind) return [`種類 ${r.kind}(正解 ${e.kind})`];
  const why = [];
  if (e.kind === "set") {
    const c = r.changes.find((x) => x.key === e.param);
    if (!c) return [`${e.param} が変わっていない(${r.changes.map((x) => x.key).join(",")})`];
    if (e.dir === "up" && !(c.after > c.before)) why.push(`${e.param} が大きくなっていない`);
    if (e.dir === "down" && !(c.after < c.before)) why.push(`${e.param} が小さくなっていない`);
    if (e.value !== undefined && Math.abs(c.after - e.value) > Math.abs(e.value) * 0.01) why.push(`${e.param}=${c.after}(正解 ${e.value})`);
    if (e.message && !r.messages.some((m) => m.includes(e.message))) why.push(`「${e.message}」の知らせがない`);
  }
  if ((e.kind === "preset" || e.kind === "explain") && (action.id !== e.id)) why.push(`id ${action.id}(正解 ${e.id})`);
  if (e.kind === "compare" && !r.variants.some((v, i) => i > 0 && v.params[e.param] !== r.variants[0].params[e.param])) why.push(`${e.param} をくらべていない`);
  return why;
}

async function ollamaAction(model, req) {
  const base = baseOf(req.base);
  const t0 = performance.now();
  const r = await (await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    model, stream: false, think: false, format: actionSchema(base.system, base.curriculum.grade), keep_alive: "10m",
    options: { temperature: 0, num_ctx: 2048, num_predict: 120 },
    messages: [{ role: "system", content: assistantPrompt(base.system, base.curriculum.grade) }, { role: "user", content: `生徒:${req.text}` }],
  }) })).json();
  let action = { action: "unknown" };
  try { action = JSON.parse(r.message?.content ?? ""); } catch { /* 形がこわれていたら unknown */ }
  return { action, ms: performance.now() - t0, promptTokens: r.prompt_eval_count };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let answers;
  let name = mode;
  if (mode === "file") { answers = JSON.parse(readFileSync(arg, "utf8")); name = label ?? arg; }
  else {
    answers = {};
    if (mode === "ollama" || mode === "hybrid") { name = `${mode === "hybrid" ? "ことば→" : ""}Ollama ${arg}`; await ollamaAction(arg, REQS[0]); } // 読みこみ(数えない)
    for (const req of REQS) {
      const t0 = performance.now();
      const local = localAction(baseOf(req.base), req.text);
      if (mode === "local") answers[req.id] = { action: local, ms: performance.now() - t0 };
      // hybrid:画面と同じ流れ(ことばで読めないときだけAI)
      else if (mode === "hybrid" && local.action !== "unknown") answers[req.id] = { action: local, ms: performance.now() - t0 };
      else answers[req.id] = await ollamaAction(arg, req);
    }
  }
  let ok = 0, sum = 0, max = 0, tokens = 0;
  for (const req of REQS) {
    const a = answers[req.id] ?? { action: { action: "unknown" }, ms: 0 };
    const why = judge(req, a.action);
    if (!why.length) ok++;
    sum += a.ms; max = Math.max(max, a.ms); tokens = Math.max(tokens, a.promptTokens ?? 0);
    if (why.length) console.log(`✗ ${req.id} 「${req.text}」 → ${JSON.stringify(a.action).slice(0, 90)} / ${why.join(" / ")}`);
  }
  const memory = mode === "file" ? answers._memory : undefined;
  const summary = { at: new Date().toISOString(), name, n: REQS.length, accuracy: ok / REQS.length, msAvg: Math.round(sum / REQS.length), msMax: Math.round(max), maxPromptTokens: tokens || undefined, memory };
  console.log(`\n${name}:正答率 ${(summary.accuracy * 100).toFixed(0)}%(${ok}/${REQS.length})/ 応答時間 平均 ${summary.msAvg} ms・最大 ${summary.msMax} ms${tokens ? ` / 指示の長さ 最大 ${tokens} トークン` : ""}${memory ? ` / メモリ ${memory}` : ""}`);
  mkdirSync(resolve(here, "history"), { recursive: true });
  appendFileSync(resolve(here, "history", "student.jsonl"), JSON.stringify(summary) + "\n");
}
