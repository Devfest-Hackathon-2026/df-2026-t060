// 手元で試す:質問をまとめて、グループごとに教材の案を作り、結果を表示する。
//   node server/try-draft.js            (既定は gemma4:12b)
//   $env:LLM_MODEL="gemma4:e4b"; node server/try-draft.js
import { groupQuestions, draftMaterial, MODEL, GRADE_WORDS } from "./draft.js";

const GRADE = 5;
// 試し用の質問(自作)。小5理科「振り子の運動」の授業のあとを想定
const QUESTIONS = [
  "ふりこのおもりを重くすると、はやく動くの?",
  "おもりを2こにしたら、1往復の時間はみじかくなりますか",
  "ひもを長くするとどうなるの?",
  "ふれはばを大きくすると1往復の時間も長くなる?",
  "ひもをみじかくしたら、はやくゆれた。なんで?",
  "ブランコで立ってこぐのと、すわってこぐのでは、ゆれる速さはちがう?",
  "てこで、おもりを支点から遠くにつるすと、どうなるの?",
  "電磁石を強くするにはどうすればいいの?",
].map((text, i) => ({ id: `q${i + 1}`, text }));

console.log(`モデル: ${MODEL} / 学年: ${GRADE_WORDS[GRADE]} / 質問 ${QUESTIONS.length}件\n`);

const g = await groupQuestions(QUESTIONS, GRADE);
console.log(`① まとめ (${g.stats.sec}秒, ${g.stats.tokPerSec} tok/s)`);
for (const grp of g.groups) {
  console.log(`  ■ ${grp.label} … ${grp.questionIds.join(", ")}`);
  console.log(`    → ${grp.rephrased}`);
}
for (const w of g.warnings) console.log(`  ⚠ ${w}`);

const byId = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.text]));
for (const grp of g.groups) {
  const d = await draftMaterial({ rephrased: grp.rephrased, questions: grp.questionIds.map((id) => byId[id]) }, GRADE);
  console.log(`\n② 教材の案「${grp.label}」 (${d.stats.sec}秒 = 設定${d.stats.planSec}秒 + 文${d.stats.writeSec}秒)`);
  const m = d.material;
  console.log(`  シミュレーション: ${m.sim ? `${m.sim.type} 変えられる=[${m.sim.adjustable}] めあて=${m.sim.goal}` : "なし"}`);
  for (const f of d.facts) console.log(`    (結果) ${f}`);
  console.log(`  AIの答え(先生向け): ${d.answer}`);
  console.log(`  題: ${m.title}\n  導入: ${m.explanation}`);
  for (const [k, v] of Object.entries(m.lesson)) console.log(`  [${k}] ${v}`);
  for (const q of m.quiz) console.log(`  確認問題: ${q.q} → 正解「${q.choices[q.answer]}」 (${q.choices.join(" / ")})`);
  console.log(`  先生へのメモ: ${d.teacherNote}`);
  for (const n of d.notes ?? []) console.log(`  ℹ ${n}`);
  for (const w of d.warnings) console.log(`  ⚠ ${w}`);
}
