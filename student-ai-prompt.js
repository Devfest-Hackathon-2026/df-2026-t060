// 児童の端末のAI(Gemma 3 1B など)まわりの、AIに頼らない部分と、AIにわたす指示。
// ブラウザ(student-ai.js)と、手元のテスト(server/try-student-ai.js)で同じものを使う。
//
// 役割の分け方(gemma3:1b で試した結果から決めた。docs/student-ai.md)
// - 答えになる文を探すのは、プログラム(単語に区切って重なりを数える)。教材の文しか出さない。
// - AIは、探した文を「質問への答えらしい1文」に直すのと、説明を学年に合わせて言いかえるのに使う。
// - AIが書いた文は、プログラムで調べる。元の文にない言葉が出た/打ち消しが合わない/大事な言葉が消えた
//   ときは使わず、教材の文をそのまま見せる。
// - 確認問題の答えをたずねる質問には、AIを使わずに返す。
// - 児童がAIに聞いた内容は、どこにも送らない(端末の中だけで終わる)。

import { describeSim, normalizeSim, simLabel, simParams, simMeasures } from "./sim-catalog.js";
import { simFactLines, checkAgainstFacts } from "./sim-facts.js";

export const GRADE_WORDS = ["", "小1", "小2", "小3", "小4", "小5", "小6", "中1", "中2", "中3"];
export const NOT_IN_MATERIAL = "この教材には書いていないみたい。先生に聞いてみよう。";
export const THINK_YOURSELF = "確認問題は、自分で考えてみよう。説明を読みなおしたり、シミュレーションで確かめたりしてね。";

const gradeWord = (grade) => GRADE_WORDS[grade] || "小学生";

/** 文に分ける(。!?で区切る) */
export function splitSentences(text) {
  return (String(text ?? "").match(/[^。!?!?\n]+[。!?!?]?/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

// 問いかけの文(「〜でしょうか。」「〜かな?」)は、答えにならないので使わない
const isQuestion = (s) => /(か|かな|の)$|[?？]$/.test(s.replace(/[。!！]+$/, ""));

/**
 * 教材から、答えに使ってよい文と、その優先度(bonus)を作る。
 * 「わかったこと」「結果」と、シミュレーションで計った結果を優先する。
 */
function answerCandidates(m) {
  const L = m.lesson ?? {};
  const out = new Map();
  const add = (text, bonus) => {
    for (const s of Array.isArray(text) ? text : splitSentences(text)) {
      if (!s || isQuestion(s) || out.has(s)) continue;
      out.set(s, bonus);
    }
  };
  add(L.summary, 0.5);
  add(L.result, 0.4);
  add(simFactLines(m.sim).slice(1), 0.3); // 数値はシミュレーションで計ったもの
  add(m.explanation, 0);
  add(L.check, 0);
  const simLine = describeSim(m.sim);
  if (simLine) add([simLine], 0);
  const goal = normalizeSim(m.sim)?.goal;
  if (goal) add([`めあて:${goal}`], 0);
  return [...out].map(([s, bonus]) => ({ s, bonus }));
}

/** 教材から、答えに使ってよい文の一覧を作る */
export function materialSentences(m) {
  return answerCandidates(m).map((c) => c.s);
}

/** 確認問題の答えをたずねているか(AIを使わずに判定) */
export function asksQuizAnswer(question) {
  return /(確認問題|クイズ|問題).*(答え|こたえ|正解|せいかい)|(答え|こたえ|正解|せいかい)は(どれ|なに|何|なん)/.test(question);
}

// ---------- 答えになる文を探す(AIを使わない) ----------

// 言い方のちがいをそろえる。語の頭がこれなら、右の形にする
const STEMS = [
  ["重", "重"], ["軽", "軽"], ["長", "長"], ["短", "短"], ["大き", "大"], ["小さ", "小"],
  ["ふりこ", "ふりこ"], ["振り子", "ふりこ"], ["ふれはば", "ふれはば"], ["振れ幅", "ふれはば"], ["振幅", "ふれはば"],
  ["おもり", "おもり"], ["ひも", "ひも"], ["糸", "ひも"],
  ["調べ", "調べ"], ["確か", "調べ"], ["シミュレーション", "調べ"], ["実験", "調べ"],
  ["変え", "変"], ["変わ", "変"],
  ["てこ", "てこ"], ["支点", "支点"], ["つり合", "つり合"], ["かたむ", "かたむ"], ["傾", "かたむ"],
  ["ばね", "ばね"], ["のび", "のび"], ["伸", "のび"], ["かた", "かた"], ["硬", "かた"],
  ["斜面", "斜面"], ["坂", "斜面"], ["台車", "台車"], ["速", "速"], ["はや", "速"], ["角度", "角度"],
  ["質量", "重"], ["力", "力"],
];
// 先に見つけておく、区切りでこわれやすい語(ひらがなの用語など)
const TERMS = ["ふりこ", "ふれはば", "おもり", "ひも", "てこ", "ばね", "のび", "つり合"];
// どの文にも出て、答えを決める役に立たない語
const COMMON = new Set(["1", "往復", "時間", "する", "なる", "変", "こと", "もの", "とき"]);

let segmenter = null;
function words(s) {
  segmenter ??= new Intl.Segmenter("ja", { granularity: "word" });
  const out = new Set();
  for (const t of TERMS) if (s.includes(t)) out.add(t);
  for (const { segment, isWordLike } of segmenter.segment(s)) {
    if (!isWordLike) continue;
    let w = segment;
    for (const [head, to] of STEMS) if (w.startsWith(head)) { w = to; break; }
    if (/^[ぁ-ん]{1,2}$/.test(w)) continue; // 助詞など
    if (COMMON.has(w)) continue;
    out.add(w);
  }
  return out;
}

// 重なる言葉がいちばん多い文を選び、同じなら優先度(まとめ・結果・計った結果)の高い順に2つまで
function pickBest(scored) {
  const best = Math.max(0, ...scored.map((x) => x.n));
  if (!best) return [];
  return scored.filter((x) => x.n === best).sort((a, b) => b.bonus - a.bonus).slice(0, 2);
}

/** 質問の答えになる文を、教材の中から探す。見つからなければ空 */
export function findSentences(material, question) {
  const q = words(question);
  const scored = answerCandidates(material).map(({ s, bonus }) => {
    const sw = words(s);
    return { s, bonus, n: [...q].filter((w) => sw.has(w)).length };
  });
  return pickBest(scored).map((x) => x.s);
}

/**
 * 届いた教材すべての中から、質問の答えになる文を探す(AIを使わない)。
 * @returns {{sentence: string, material: object}[]}  見つからなければ空
 */
export function findInMaterials(materials, question) {
  const q = words(question);
  if (!q.size) return [];
  const seen = new Set();
  const scored = [];
  for (const m of materials) {
    for (const { s, bonus } of answerCandidates(m)) {
      if (seen.has(s)) continue;
      seen.add(s);
      const sw = words(s);
      const n = [...q].filter((w) => sw.has(w)).length;
      if (n) scored.push({ s, bonus, n, material: m });
    }
  }
  return pickBest(scored).map((x) => ({ sentence: x.s, material: x.material }));
}

// ---------- AIが書いた文を調べる ----------

const RUNS = /[一-龯々]+|[ァ-ヶー]{2,}/g; // 漢字のかたまり、カタカナのことば
const runs = (s) => new Set((String(s).match(RUNS) ?? []));
const negative = (s) => /ない|ません|ず[、。]|なく/.test(s);

/**
 * AIの文が、もとの文の意味からはずれていないかを調べる。
 * @param {string} ai   AIが書いた文
 * @param {string} src  もとの文
 * @param {string} [extra]  使ってよい言葉(質問の文など)
 * @param {{coverage?: number}} [opt]  もとの文の漢字のことばを、どれだけ残すべきか(0〜1)
 */
export function checkFaithful(ai, src, extra = "", { coverage = 0.6 } = {}) {
  const a = String(ai ?? "").trim();
  if (!a) return { ok: false, reason: "空" };
  const allowed = new Set([...runs(src), ...runs(extra)]);
  const added = [...runs(a)].filter((r) => ![...allowed].some((x) => x.includes(r) || r.includes(x)));
  if (added.length) return { ok: false, reason: `もとの文にない言葉: ${added.join("、")}` };
  if (negative(a) !== negative(src)) return { ok: false, reason: "打ち消し(〜ない)が合わない" };
  const srcRuns = [...runs(src)];
  if (srcRuns.length) {
    const kept = srcRuns.filter((r) => a.includes(r)).length / srcRuns.length;
    if (kept < coverage) return { ok: false, reason: `大事な言葉が消えた(${Math.round(kept * 100)}%)` };
  }
  return { ok: true, reason: "" };
}

// ---------- Gemma 4 E2B:あいまいな質問を具体化する ----------

// 何を指すかがあいまいな言葉
const DEICTIC = new Set(["それ", "これ", "あれ", "どれ", "その", "この", "あの", "そこ", "ここ", "あそこ", "こう", "そう", "ああ", "こんな", "そんな", "あんな", "やつ", "こっち", "そっち", "あっち"]);

/** 「それ」「これ」など、何を指すかがあいまいな言葉があるか(AIを使わずに見る) */
export function isVague(question) {
  const q = String(question ?? "").trim();
  if (q.replace(/[?？!！。、\s]/g, "").length <= 6) return true; // 「ふりこ?」のような短すぎる質問
  // 「ふり"この"ひも」を取りちがえないように、教材の用語を先に消してから、単語に区切って見る
  let masked = q;
  for (const term of [...TERMS, "振り子", "ふれ幅", "ブランコ"]) masked = masked.split(term).join("■");
  segmenter ??= new Intl.Segmenter("ja", { granularity: "word" });
  for (const { segment } of segmenter.segment(masked)) if (DEICTIC.has(segment)) return true;
  return /^(それ|これ|あれ|その|この|あの)/.test(masked);
}

/** 教材の中身を、AIにわたす短い説明にする */
function materialBrief(m) {
  const L = m.lesson ?? {};
  const sim = normalizeSim(m.sim);
  const lines = [`題: ${m.title}`];
  if (m.explanation) lines.push(`説明: ${m.explanation}`);
  if (L.question) lines.push(`授業の問い: ${L.question}`);
  if (sim) {
    const measures = simMeasures(sim);
    lines.push(`シミュレーション: ${simLabel(sim)}(変えられる条件: ${simParams(sim).map((p) => p.label.replace(/\(.*\)/, "")).join("、")}。調べられること: ${measures})`);
  }
  return lines.join("\n");
}

export const CONCRETIZE_SCHEMA = {
  type: "object",
  properties: { options: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 } },
  required: ["options"],
};

export const CONCRETIZE_SYSTEM = `あなたは小学校・中学校の子どもの勉強を手伝う係です。子どもの質問には「それ」「これ」など、何を指しているかわからない言葉がよくあります。
いま習っている【教材】についての質問だと考えて、子どもが聞きたいことを、具体的な質問に書きかえてください。
きまり:
- 「それ」「これ」などを、教材に出てくる言葉(条件の名前など)に置きかえる。
- 何を指すか1つに決められないときは、考えられる質問を2つか3つ出す。決められるときは1つ。
- 1つの質問は40字以内。子どもの言葉づかいのまま、やさしく書く。
- options に質問を入れて、JSONで答える。`;

export function concretizePrompt(material, question) {
  return `【教材】\n${materialBrief(material)}\n\n【子どもの質問】${question}`;
}

// ---------- Gemma 4 E2B:具体化した問いに、シミュレーションの結果に合わせて答える ----------

/** 質問に使うシミュレーション:教材のもの。なければ質問の言葉から選ぶ(AIを使わない) */
export function simForQuestion(material) {
  return normalizeSim(material?.sim);
}

export const answerSchema = (sim) => ({
  type: "object",
  properties: {
    answer: { type: "string" },
    change: { type: "array", items: { type: "string", enum: sim && simParams(sim).length ? simParams(sim).map((p) => p.key) : ["none"] } },
    check: { type: "string" },
  },
  required: ["answer", "change", "check"],
});

export const answerSystem = (grade) => `あなたは${GRADE_WORDS[grade] || "小学生"}の子どもの勉強を手伝う係です。
子どもの【質問】に、【教材】と【シミュレーションの結果】だけを使って答えます。
きまり:
- answer は、やさしいことばで2文以内。【シミュレーションの結果】は実際に計った正しい結果なので、必ずこれと合うように書く。
- 【教材】と【シミュレーションの結果】にないことは書かない。答えられないときは answer を「この教材だけでは答えられないよ。先生に聞いてみよう。」にする。
- 確認問題の答えは言わない。
- change は、子どもがシミュレーションで変えてみるとよい条件の名前(key)。質問に関係する条件だけ。
- check は、シミュレーションで何をどう変えて、何を見ればよいか(40字以内)。
- JSONで答える。`;

export function answerPrompt(material, question, sim) {
  const facts = sim ? simFactLines(sim) : [];
  const params = sim ? simParams(sim).map((p) => `${p.key}=${p.label.replace(/\(.*\)/, "")}`).join("、") || "なし" : "なし";
  return `【教材】\n${materialBrief(material)}\n${[...splitSentences(material.lesson?.summary), ...splitSentences(material.lesson?.result)].map((s) => `わかったこと: ${s}`).join("\n")}
【シミュレーションの結果】
${facts.length ? facts.map((f) => `- ${f}`).join("\n") : "(シミュレーションなし)"}
【条件の名前】${params}
【質問】${question}`;
}

export const CANT_ANSWER = "この教材だけでは答えられないよ。先生に聞いてみよう。";

/**
 * AIの答えを調べて、子どもに見せる形にする。
 * - シミュレーションの結果と食いちがう答えは使わず、計った結果の文を見せる
 * @returns {{answer: string|null, sim: object|null, check: string, problems: string[], cant: boolean}}
 */
export function readAnswer(json, sim) {
  const answer = tidy(json?.answer ?? "").slice(0, 160);
  const cant = !answer || answer.includes("答えられない");
  const problems = sim && !cant ? checkAgainstFacts(sim, [answer]) : [];
  let showSim = null;
  if (sim) {
    const keys = simParams(sim).map((p) => p.key);
    const change = (json?.change ?? []).filter((k) => keys.includes(k));
    showSim = normalizeSim({ ...sim, adjustable: change.length ? change : sim.adjustable, goal: String(json?.check ?? "").slice(0, 60) || sim.goal });
  }
  return { answer: cant || problems.length ? null : answer, sim: showSim, check: String(json?.check ?? "").slice(0, 60), problems, cant };
}

// ---------- AIにわたす指示 ----------

/** 探した文を、質問への答えらしい1文に直させる */
export function phrasePrompt(question, sentence, grade) {
  return `${gradeWord(grade)}の子どもの質問に、【答えの文】だけを使って、やさしいことば1文で答えてください。【答えの文】にないことは書かないでください。答えの1文だけを書いてください。
質問: ${question}
【答えの文】${sentence}`;
}

/** 説明を、学年に合わせて1文ずつ言いかえさせる */
export function simplifyPrompt(material, grade) {
  const sentences = splitSentences(material.explanation);
  return `次の文を、${gradeWord(grade)}の子どもが読んでわかるように、1文ずつ、やさしいことばに言いかえてください。
きまり:
- 文の数は変えない(${sentences.length}文)。「1.」の文は「1.」に言いかえる。
- 意味を変えない。新しいことを足さない。
- 「1.」「2.」のように番号をつけて、言いかえた文だけを書く。

${sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
}

/** AIの文から、よけいな記号を取る */
export function tidy(text) {
  return String(text ?? "")
    .replace(/<end_of_turn>|<start_of_turn>(model|user)?/g, "")
    .replace(/\*\*/g, "")
    .trim();
}

/** 言いかえの結果を1文ずつ調べる。だめな文は、もとの文のままにする */
export function readSimplify(text, material) {
  const original = splitSentences(material.explanation);
  const byNo = new Map();
  for (const line of tidy(text).split("\n")) {
    const m = line.match(/^\s*(\d+)\s*[.．。):)、]\s*(.+)$/);
    if (m) byNo.set(Number(m[1]), m[2].trim());
  }
  const rows = original.map((src, i) => {
    const ai = byNo.get(i + 1) ?? "";
    // 言いかえでは漢字をひらがなにすることがあるので、言葉が残っているかは見ない
    const c = checkFaithful(ai, src, "", { coverage: 0 });
    return { src, ai, ok: c.ok, reason: c.reason, shown: c.ok ? ai : src };
  });
  return { rows, usedAI: rows.some((r) => r.ok), text: rows.map((r) => r.shown).join("") };
}
