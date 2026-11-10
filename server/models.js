// 先生PCの Ollama にある AI モデルを、先生の画面から用意する。
//   ・Gemma 4 12B がダウンロードずみなら、何もしない(そのまま使う)
//   ・なければ 12B をダウンロードする。できなかったら Gemma 4 E4B(小さい)をダウンロードして、そちらで動かす
//   ・E4B がすでにあれば、それを使う(ダウンロードしない)
// Ollama の API だけを使う(/api/tags・/api/pull)。Cloud Run では動かさない(モデルは Ollama 側に置く)。
import { BASE, BACKEND, MODEL, setModel } from "./draft.js";

export const PREFERRED = "gemma4:12b";
export const FALLBACK = "gemma4:e4b";
const CANDIDATES = [PREFERRED, FALLBACK];

const state = { phase: "idle", model: null, status: "", completed: 0, total: 0, tried: [], message: "", startedAt: 0 };
let running = null;

const has = (names, m) => names.some((n) => n === m || n === `${m}:latest`);

export async function installedModels({ timeoutMs = 3000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}/api/tags`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Ollama が ${r.status} を返した`);
    return ((await r.json()).models ?? []).map((m) => m.name ?? m.model ?? "");
  } finally {
    clearTimeout(timer);
  }
}

/** 画面に見せる状態。Ollama につながらなければ ollama:false */
export async function modelStatus() {
  const base = { backend: BACKEND, active: MODEL, preferred: PREFERRED, fallback: FALLBACK, progress: { ...state, tried: [...state.tried] } };
  if (BACKEND !== "ollama") return { ...base, ollama: false, installed: {}, reason: "このAIは Ollama ではないので、画面からはダウンロードできません" };
  try {
    const names = await installedModels();
    return { ...base, ollama: true, installed: Object.fromEntries(CANDIDATES.map((m) => [m, has(names, m)])) };
  } catch (e) {
    return { ...base, ollama: false, installed: {}, reason: e?.name === "AbortError" ? "Ollama の応答がありません" : "Ollama につながりません。Ollama を起動してください" };
  }
}

/** 起動のとき:12B がなく E4B がある(かつ環境変数で決めていない)なら、E4B で動かす。名前を決めていれば、それを尊重する */
export async function autoSelect() {
  if (BACKEND !== "ollama" || process.env.LLM_MODEL) return MODEL;
  try {
    const names = await installedModels();
    if (!has(names, PREFERRED) && has(names, FALLBACK)) setModel(FALLBACK);
  } catch { /* Ollama が止まっていれば、そのまま */ }
  return MODEL;
}

/** Ollama に 1つ ダウンロードさせる。進み具合を state に入れる。失敗したら投げる */
async function pull(model, fetchImpl = fetch) {
  state.model = model; state.status = "ダウンロードを始めています"; state.completed = 0; state.total = 0;
  const res = await fetchImpl(`${BASE}/api/pull`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, stream: true }) });
  if (!res.ok) throw new Error(`Ollama が ${res.status} を返した`);
  let buf = "", ok = false;
  const decoder = new TextDecoder();
  const line = (l) => {
    if (!l.trim()) return;
    const j = JSON.parse(l);
    if (j.error) throw new Error(String(j.error).slice(0, 200));
    if (j.status) state.status = String(j.status).slice(0, 80);
    if (typeof j.total === "number" && j.total > 0) { state.total = j.total; state.completed = j.completed ?? 0; }
    if (j.status === "success") ok = true;
  };
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) { line(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  line(buf);
  if (!ok) throw new Error("ダウンロードが最後まで終わりませんでした");
}

async function run() {
  Object.assign(state, { phase: "pulling", model: null, status: "", completed: 0, total: 0, tried: [], message: "", startedAt: Date.now() });
  let names;
  try { names = await installedModels(); } catch { throw new Error("Ollama につながりません。Ollama を起動してから、もう一度ためしてください"); }
  // ① 12B がすでにある → ダウンロードしない
  if (has(names, PREFERRED)) { setModel(PREFERRED); return finish(PREFERRED, "ダウンロードずみです。そのまま使います"); }
  // ② 12B をダウンロード
  try {
    await pull(PREFERRED);
    setModel(PREFERRED);
    return finish(PREFERRED, "Gemma 4 12B をダウンロードしました");
  } catch (e) {
    state.tried.push({ model: PREFERRED, error: String(e?.message ?? e).slice(0, 200) });
  }
  // ③ できなかった → E4B(すでにあれば、ダウンロードしない)
  if (has(names, FALLBACK)) { setModel(FALLBACK); return finish(FALLBACK, "12B はダウンロードできませんでした。ダウンロードずみの E4B で動かします"); }
  try {
    await pull(FALLBACK);
    setModel(FALLBACK);
    return finish(FALLBACK, "12B はダウンロードできなかったので、E4B をダウンロードして使います");
  } catch (e) {
    state.tried.push({ model: FALLBACK, error: String(e?.message ?? e).slice(0, 200) });
    throw new Error("12B も E4B もダウンロードできませんでした。ネットのつながりと、パソコンの空き容量を確かめてください");
  }
}
function finish(model, message) {
  Object.assign(state, { phase: "done", model, message, status: "完了" });
  return state;
}

/** 用意を始める(すでに動いていれば、それをそのまま返す)。進み具合は modelStatus() で見る */
export function ensureModel() {
  if (BACKEND !== "ollama") throw Object.assign(new Error("このAIは Ollama ではないので、画面からはダウンロードできません"), { status: 409 });
  if (running) return { started: false };
  running = run().catch((e) => { Object.assign(state, { phase: "error", message: String(e?.message ?? e).slice(0, 240), status: "失敗" }); })
    .finally(() => { running = null; });
  return { started: true };
}

export const _state = state;
