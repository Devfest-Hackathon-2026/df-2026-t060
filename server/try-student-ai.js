// 児童の端末のAIの答え方を、手元のOllamaで試す(ブラウザと同じ処理・同じ指示文を使う)。
//   node server/try-student-ai.js                 (既定は gemma4:12b)
//   $env:STUDENT_MODEL="qwen2.5:0.5b"; node server/try-student-ai.js
import {
  findSentences, asksQuizAnswer, THINK_YOURSELF, NOT_IN_MATERIAL,
  phrasePrompt, checkFaithful, simplifyPrompt, readSimplify, tidy,
} from "../public/js/student-ai-prompt.js";

const BASE = process.env.LLM_BASE_URL ?? "http://127.0.0.1:11434";
// gemma3:1b は消したので、試すときは STUDENT_MODEL に Ollama のモデルの名前を入れる
const MODEL = process.env.STUDENT_MODEL ?? "gemma4:12b";

// 試し用の教材(先生が配信した形)。中身は自作
const MATERIAL = {
  title: "ひもの長さで変わる時間",
  explanation:
    "ふりこのひもが長いと、1往復する時間が長くなります。ひもが短いと、1往復する時間は短くなります。おもりの重さやふれはばを変えても、1往復する時間はほとんど変わりません。",
  sim: { type: "pendulum", length: 1.0 },
  quiz: [{ q: "1往復する時間を長くするには、どうすればよい?", choices: ["おもりを重くする", "ひもを長くする", "ふれはばを大きくする"], answer: 1 }],
};
// want: 見つけた文のどれかに、ここの言葉が全部入っていれば合格(教材の文でも、シミュレーションで計った結果の文でもよい)
//       [] は「教材にない」(何も見つけないのが正しい)、"quiz" は確認問題の答えを聞いている
const ASKS = [
  { q: "ひもを短くするとどうなるの?", want: ["ひも", "短"] },
  { q: "おもりを重くしたら、1往復ははやくなる?", want: ["おもり", "変わ"] },
  { q: "ふれはばを大きくすると?", want: ["ふれはば"] },
  { q: "ひもを長くしたら?", want: ["ひも", "長くな"] },
  { q: "どうやって確かめればいいの?", want: ["シミュレーション"] },
  { q: "おもりを2こにしたら?", want: ["おもり", "変わ"] },
  { q: "ひもの長さを変えるとどうなる?", want: ["ひも", "長"] },
  { q: "確認問題の答えはどれ?", want: "quiz" },
  { q: "電磁石を強くするにはどうするの?", want: [] },
  { q: "月に持っていったら、ふりこはどうなる?", want: [] },
  { q: "きょうの給食なに?", want: [] },
];

async function generate(prompt) {
  const started = performance.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, stream: false, options: { temperature: 0, num_predict: 200 }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { text: tidy(data.message.content), ms: Math.round(performance.now() - started) };
}

console.log(`モデル: ${MODEL}\n`);
let found = 0, aiUsed = 0, aiTried = 0;
for (const c of ASKS) {
  if (asksQuizAnswer(c.q)) {
    found += c.want === "quiz";
    console.log(`${c.want === "quiz" ? "○" : "×"} 「${c.q}」\n    (AIを使わない) ${THINK_YOURSELF}`);
    continue;
  }
  const hits = findSentences(MATERIAL, c.q);
  const ok = Array.isArray(c.want) && (c.want.length === 0 ? hits.length === 0 : hits.some((h) => c.want.every((w) => h.includes(w))));
  found += ok;
  console.log(`${ok ? "○" : "×"} 「${c.q}」 見つけた文 ${hits.length}つ`);
  if (!hits.length) { console.log(`    → ${NOT_IN_MATERIAL}`); continue; }
  for (const h of hits) console.log(`    教材: ${h}`);
  if (hits.length === 1) {
    aiTried++;
    const { text, ms } = await generate(phrasePrompt(c.q, hits[0], 5));
    const chk = checkFaithful(text, hits[0], c.q);
    aiUsed += chk.ok;
    console.log(`    AI:   ${text.replace(/\n/g, " ")} (${ms}ms) → ${chk.ok ? "使う" : `使わない: ${chk.reason}`}`);
  }
}
console.log(`\n答えの文を探す: ${found}/${ASKS.length} が期待どおり / AIの言いかえを使えた: ${aiUsed}/${aiTried}\n`);

for (const grade of [3, 5]) {
  const { text, ms } = await generate(simplifyPrompt(MATERIAL, grade));
  const r = readSimplify(text, MATERIAL);
  console.log(`■ やさしく言いかえ(小${grade}) ${ms}ms`);
  for (const row of r.rows) console.log(`    ${row.ok ? "使う  " : "もとの文"} ${row.ok ? row.ai : `${row.src}  (AI: ${row.ai || "なし"} / ${row.reason})`}`);
}
