// 先生の側のAI。AIは児童に直接答えない。出力はテンプレートのJSONだけで、コードは作らせない。
// 先生が確かめて配信・返信して、はじめて児童に届く。
//   ① groupQuestions  質問を「今日の授業」との関係で上・中・下に分け、上と中をまとめる
//   ② draftMaterial   まとめた質問(重複・大事なもの)に答え、授業の流れとシミュレーションつきの教材の案をつくる
//                     (questions が空なら「サンプル教材」をつくる)
//   ③ answerQuestion  1人の質問に答える(先生が直して、その児童だけに返す)
// ②③は3段階:A. シミュレーションを決める(AI)→ B. 動かして結果を計る(プログラム)→ C. 結果に合わせて書く(AI)
//
// Ollama の API(/api/chat)を使う。接続先とモデルは環境変数で切り替える。
//   LLM_BASE_URL  既定 http://127.0.0.1:11434(先生PCのOllama)。Cloud Run の Ollama にもそのまま向けられる
//   LLM_MODEL     既定 gemma4:12b(先生の側のAIは Gemma 4 12B だけで動かす)
import { LAB_PRESETS, labMaterial, makeLabPlan } from '../public/js/hybrid-lab.js';
import { simFactLines } from '../public/js/sim-facts.js';

export const BASE = process.env.LLM_BASE_URL ?? "http://127.0.0.1:11434";
export let MODEL = process.env.LLM_MODEL || "gemma4:12b";
/** 使うモデルを切りかえる(先生の画面から Gemma 4 E4B に落としたとき)。import した MODEL にも、すぐ反映される */
export function setModel(name) { if (typeof name === "string" && name) MODEL = name; }
export const GRADE_WORDS = ["", "小1", "小2", "小3", "小4", "小5", "小6", "中1", "中2", "中3"];
export const LEVELS = ["上", "中", "下"];

// AIを動かすもの:ollama(ふつう)か llamacpp(llama.cpp の llama-server。プログラムを書く速さが約1.6倍。
// server/start-llamacpp.ps1 で起動し、LLM_BACKEND=llamacpp LLM_BASE_URL=http://127.0.0.1:8090 にする)
export const BACKEND = process.env.LLM_BACKEND ?? "ollama";
// 文脈の大きさ(全部の呼び出しで共通。シミュレーションのプログラムを書くときの長い指示が入る大きさ)
const NUM_CTX = Number(process.env.LLM_NUM_CTX ?? 16384);

/**
 * AI(Ollama / llama.cpp)が、いま使えるか。サーバーの /ready と、Cloud Run の起動の確認(startup probe)に使う。
 * Ollama:/api/tags にモデルがあるか(Cloud Run では、モデルを読みこんだあとでないと、ここに出ない)
 * @returns {Promise<{ok: boolean, backend: string, model: string, reason?: string}>}
 */
export async function checkLlm({ timeoutMs = 3000 } = {}) {
  const out = { ok: false, backend: BACKEND, model: MODEL };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      if (BACKEND === "llamacpp") {
        const r = await fetch(`${BASE}/health`, { signal: ctrl.signal });
        return r.ok ? { ...out, ok: true } : { ...out, reason: `llama-server が ${r.status} を返した` };
      }
      const r = await fetch(`${BASE}/api/tags`, { signal: ctrl.signal });
      if (!r.ok) return { ...out, reason: `Ollama が ${r.status} を返した` };
      const names = ((await r.json()).models ?? []).map((m) => m.name ?? m.model ?? "");
      const has = names.some((n) => n === MODEL || n === `${MODEL}:latest` || n.startsWith(`${MODEL}:`));
      return has ? { ...out, ok: true } : { ...out, reason: `Ollama にモデル ${MODEL} がまだありません` };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ...out, reason: e?.name === "AbortError" ? "AIの応答がありません(起動中かもしれません)" : "AI(Ollama)につながりません" };
  }
}

/** llama.cpp(OpenAI と同じ形の窓口)に、少しずつ受けとる形でたのむ */
async function chatLlamaCpp({ system, user, schema, temperature, maxTokens, started, ctx }) {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stream: true, temperature, ...(maxTokens ? { max_tokens: maxTokens } : {}),
      response_format: { type: "json_schema", json_schema: { name: "out", schema } },
      // 「考える文」は出させない(llama-server を --reasoning-budget 0 で起動している)
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      cache_prompt: true, timings_per_token: false,
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  let content = "", buf = "", finish = "", timings = {};
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      const part = JSON.parse(data);
      if (part.error) throw new Error(`LLM: ${part.error.message ?? part.error}`);
      content += part.choices?.[0]?.delta?.content ?? "";
      if (part.choices?.[0]?.finish_reason) finish = part.choices[0].finish_reason;
      if (part.timings) timings = part.timings;
    }
  }
  const stats = {
    sec: Math.round((performance.now() - started) / 100) / 10,
    tokens: timings.predicted_n, tokPerSec: timings.predicted_per_second ? Math.round(timings.predicted_per_second) : null, promptTokens: timings.prompt_n,
  };
  try {
    return { json: JSON.parse(content), stats };
  } catch {
    const why = finish === "length" ? `とちゅうで切れた(指示${timings.prompt_n}+答え${timings.predicted_n}トークン、上限${NUM_CTX})` : "JSONとして読めない";
    const err = new Error(`${why}: ${content.slice(0, 120)}`);
    err.stats = stats;
    throw err;
  }
}

export async function chat({ system, user, schema, temperature = 0.2, ctx = 8192, maxTokens, model = MODEL }) {
  const started = performance.now();
  if (BACKEND === "llamacpp") return chatLlamaCpp({ system, user, schema, temperature, maxTokens, started, ctx });
  // 少しずつ受けとる(stream)。まとめて受けとると、長い答えのとき、Node の fetch が
  // 「5分たっても返事の頭が来ない」として打ち切ってしまう(プログラムを書かせると5分をこえることがある)
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      think: false,
      format: schema,
      // keep_alive:モデルと、指示の書き出しの計算(KVキャッシュ)を残しておく
      keep_alive: "30m",
      // num_ctx はどの呼び出しでも同じにする。ちがうと Ollama がモデルを読みこみ直し、
      // 2つの問い合わせが重なると「Stopping...」のまま止まった
      options: { temperature, num_ctx: NUM_CTX, ...(maxTokens ? { num_predict: maxTokens } : {}) },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  let content = "", data = {}, buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const part = JSON.parse(line);
      if (part.error) throw new Error(`LLM: ${part.error}`);
      content += part.message?.content ?? "";
      if (part.done) data = part;
    }
  }
  data.message = { content };
  const stats = {
    sec: Math.round((performance.now() - started) / 100) / 10,
    tokens: data.eval_count,
    tokPerSec: data.eval_duration ? Math.round(data.eval_count / (data.eval_duration / 1e9)) : null,
    promptTokens: data.prompt_eval_count,
  };
  try {
    return { json: JSON.parse(data.message.content), stats };
  } catch {
    // とちゅうで切れたとき(done_reason: length)は、指示+答えが num_ctx をこえている
    const why = data.done_reason === "length" ? `とちゅうで切れた(指示${data.prompt_eval_count}+答え${data.eval_count}トークン、上限${NUM_CTX})` : "JSONとして読めない";
    const err = new Error(`${why}: ${content.slice(0, 120)}`);
    err.stats = stats;
    throw err;
  }
}

/** 字数をこえたら警告に足す、文字列を整える関数を作る */
function stringer(warnings) {
  return (v, max, name) => {
    const s = String(v ?? "").trim();
    if (s.length > max) warnings.push(`${name}が${max}字をこえています(${s.length}字)`);
    return s;
  };
}

const lessonLine = (lesson) => `今日の授業: ${lesson?.trim() || "(先生が書いていない。理科の授業として考える)"}`;

// ---------- ① 関係の強さで分けて、まとめる ----------

// levels は質問の順に1つずつ、質問の数とちょうど同じ数(つけ忘れが起きないように)
const groupSchema = (n) => ({
  type: "object",
  properties: {
    levels: { type: "array", items: { type: "string", enum: LEVELS }, minItems: n, maxItems: n },
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          questionIds: { type: "array", items: { type: "integer" } },
          rephrased: { type: "string" },
        },
        required: ["label", "questionIds", "rephrased"],
      },
    },
  },
  required: ["levels", "groups"],
});

const GROUP_SYSTEM = `あなたは小学校・中学校の先生の授業準備を手伝うアシスタントです。
児童から届いた質問を、今日の授業との関係の強さで「上・中・下」に分け、上と中の質問を、同じことを聞いているもの同士でまとめます。
きまり:
- 上:今日の授業の内容そのものについての質問。
- 中:今日の授業に関係があり、理解を深めたり、発展させたりする質問。
- 下:今日の授業と関係がうすい質問(ほかの教科のこと、生活のこと、ふざけた質問など)。
- levels には、質問の番号の順に、1つずつ「上」「中」「下」を入れる(質問の数と同じ数にする)。
- groups には、上と中の質問だけを入れる。下の質問は、どのグループにも入れない。
- 1つの質問は、1つのグループにだけ入れる。似た質問がなければ、1つだけのグループにする。
- label は短い見出し(15字以内)。
- rephrased は、グループの質問を、先生が授業で取り上げやすい1つの問いに言いかえたもの(60字以内)。
- 出力はJSONだけ。`;

/**
 * @param {{id: string, text: string}[]} questions
 * @param {number} grade
 * @param {string} [lesson]  今日の授業(単元・めあて)
 * @returns {Promise<{relevance: Record<string, '上'|'中'|'下'>, groups: {label: string, rephrased: string, questionIds: string[], level: string}[], warnings: string[], stats: object}>}
 */
export async function groupQuestions(questions, grade, lesson = "") {
  const numbered = questions.map((q, i) => `${i + 1}. ${q.text}`).join("\n");
  const { json, stats } = await chat({
    system: GROUP_SYSTEM,
    user: `学年: ${GRADE_WORDS[grade]}\n${lessonLine(lesson)}\n質問:\n${numbered}`,
    schema: groupSchema(questions.length),
  });

  const warnings = [];
  // 関係の強さ。それでも出なかった質問は「中」にする(先生が見落とさないように)
  const levelOf = new Map();
  questions.forEach((q, i) => {
    const lv = json.levels?.[i];
    if (LEVELS.includes(lv)) levelOf.set(i + 1, lv);
    else { levelOf.set(i + 1, "中"); warnings.push(`「${q.text.slice(0, 20)}」の関係の強さが出なかったので「中」にしました`); }
  });

  // まとめ:番号のまちがい・重なり・入れ忘れを直す。下の質問は外す
  const used = new Set();
  const groups = [];
  for (const g of json.groups ?? []) {
    const nums = [];
    for (const n of g.questionIds ?? []) {
      if (!Number.isInteger(n) || n < 1 || n > questions.length) continue;
      if (used.has(n) || levelOf.get(n) === "下") continue;
      used.add(n);
      nums.push(n);
    }
    if (nums.length) groups.push({ label: String(g.label).slice(0, 20), rephrased: String(g.rephrased).slice(0, 80), nums });
  }
  questions.forEach((q, i) => {
    if (!used.has(i + 1) && levelOf.get(i + 1) !== "下") groups.push({ label: q.text.slice(0, 15), rephrased: q.text, nums: [i + 1] });
  });

  // ちがう内容の質問が、同じまとまりに入っていないか(シミュレーションの話題でくらべる)
  const topics = (text) => LAB_PRESETS.filter((p) => [p.title, p.system].some(w => text.includes(w))).map(p => p.id);
  for (const g of groups) {
    if (g.nums.length < 2) continue;
    const ts = g.nums.map((n) => topics(questions[n - 1].text));
    const withTopic = ts.filter((t) => t.length), without = ts.filter((t) => !t.length);
    const disjoint = withTopic.some((a) => withTopic.some((b) => !a.some((x) => b.includes(x))));
    if (disjoint || (withTopic.length && without.length)) {
      warnings.push(`「${g.label}」に、ちがう内容の質問が入っているかもしれません。必要なら質問ごとに案をつくってください`);
    }
  }

  const relevance = Object.fromEntries(questions.map((q, i) => [q.id, levelOf.get(i + 1)]));
  // 大事なまとまり(上をふくむもの・人数が多いもの)を先に
  const rank = (g) => (g.nums.some((n) => levelOf.get(n) === "上") ? 0 : 1) * 100 - g.nums.length;
  const out = groups.sort((a, b) => rank(a) - rank(b)).map((g) => ({
    label: g.label, rephrased: g.rephrased,
    questionIds: g.nums.map((n) => questions[n - 1].id),
    level: g.nums.some((n) => levelOf.get(n) === "上") ? "上" : "中",
  }));
  return { relevance, groups: out, warnings, stats };
}


// Gemmaが作るのは説明文と、工房のモデルの選択だけ。任意コードは受け付けない。
async function selectPlan(text, grade, simType) {
  if (simType) return makeLabPlan(simType, {grade:GRADE_WORDS[grade]});
  const { proposeLab } = await import('./lab-plan.js');
  const out = await proposeLab(text.slice(0,500), grade);
  return out.plan ?? null;
}
const line = (x, n, fallback = '') => typeof x === 'string' ? (x.trim().slice(0,n) || fallback) : fallback;
const elapsed = t => ({sec: Number(((performance.now()-t)/1000).toFixed(1))});
const fields = {title:60, explanation:800, predict:120, check:160, result:160, summary:160, teacherNote:160, answer:200};
const writing = {type:'object', additionalProperties:false, required:['title','explanation','predict','check','result','summary','teacherNote','answer'],
  properties:Object.fromEntries(Object.entries(fields).map(([k,n]) => [k,{type:'string',maxLength:n}]))};

export async function draftMaterial(group, grade, {simType, lesson}={}) {
  const at = performance.now(), warnings = [];
  const title = line(group.rephrased,60,'実験の問い');
  const plan = await selectPlan([group.rephrased, ...group.questions, lesson].filter(Boolean).join(' / '),grade,simType);
  const base = plan ? labMaterial(plan) : null;
  const facts = simFactLines(base?.sim);
  let out = {};
  try {
    ({json:out} = await chat({
      system:'理科の先生が確認して配る下書きを日本語で作る。対象学年のことばにする。測定値を創作せず、参考値はモデルで計った時刻と区別する。1条件だけを変える比べ方を説明する。モデルがない場合は本文教材の案を作る。',
      user:JSON.stringify({grade:GRADE_WORDS[grade],question:group.rephrased,studentQuestions:group.questions,lesson,experiment:base?.title,observations:facts}),
      schema:writing, maxTokens:1100,
    }));
  } catch (e) {
    if (!base) throw e;
    warnings.push('説明文の案を作れなかったので、工房の標準教材を入れました。');
  }
  if (!plan) warnings.push('この問いに合う工房の実験が見つからなかったため、本文だけの案です。');
  const l = base?.lesson ?? {};
  const material = {title:line(out?.title,60,title), explanation:line(out?.explanation,800,base?.explanation),
    sim:base?.sim ?? null, quiz:[], lesson:{question:line(group.rephrased,80,l.question),
      predict:line(out?.predict,120,l.predict),check:line(out?.check,160,l.check),
      result:line(out?.result,160,l.result),summary:line(out?.summary,160,l.summary)}};
  return {material, answer:line(out?.answer,200), teacherNote:line(out?.teacherNote,160), warnings, notes:[], stats:elapsed(at), facts};
}

const answerSchema = {type:'object', additionalProperties:false, required:['answer','teacherNote'],
  properties:{answer:{type:'string',maxLength:200},teacherNote:{type:'string',maxLength:160}}};
export async function answerQuestion({question,lesson,materialTitle}, grade) {
  const at = performance.now();
  const plan = await selectPlan([question, materialTitle, lesson].filter(Boolean).join(' / '),grade);
  const sim = plan ? labMaterial(plan).sim : null;
  const facts = simFactLines(sim);
  const {json} = await chat({
    system:'児童の理科の質問への、先生が確認する返答を日本語で作る。200字以内。与えられたモデルの測定値を根拠にし、モデルだけでは確かめられないことは区別する。',
    user:JSON.stringify({grade:GRADE_WORDS[grade], question, lesson, materialTitle, modelObservations:facts}),
    schema:answerSchema,maxTokens:500,
  });
  return {answer:line(json?.answer,200,'先生と一緒に確かめよう。'),teacherNote:line(json?.teacherNote,160),sim,facts,warnings:[],notes:[],stats:elapsed(at)};
}
