// 先生の側のAIの流れを、手元でまとめて試す
//   ① 今日の授業との関係で上・中・下に分けて、上と中をまとめる
//   ③ 1人の質問に答える(個別の返事の案)
//   ② サンプル教材(シミュレーションの種類を先生が選ぶ)
//   node server/try-flow.js
import { groupQuestions, answerQuestion, draftMaterial, MODEL, GRADE_WORDS } from "./draft.js";

const GRADE = 5;
const LESSON = "小5 振り子の運動 ─ 振り子が1往復する時間は、何によって変わるか";
// 試し用の質問(自作)。授業と関係がうすいものもまぜる
const QUESTIONS = [
  "ふりこのおもりを重くすると、はやく動くの?",
  "おもりを2こにしたら、1往復の時間はみじかくなりますか",
  "ひもを長くするとどうなるの?",
  "ブランコで立ってこぐのと、すわってこぐのでは、ゆれる速さはちがう?",
  "時計のふりこは、なんでずっと同じリズムなの?",
  "きょうの給食なに?",
  "ゲームのキャラがジャンプするのはなんで?",
].map((text, i) => ({ id: `q${i + 1}`, text }));

console.log(`モデル: ${MODEL} / 学年: ${GRADE_WORDS[GRADE]}\n今日の授業: ${LESSON}\n`);

const g = await groupQuestions(QUESTIONS, GRADE, LESSON);
console.log(`① 関係の強さ (${g.stats.sec}秒)`);
for (const q of QUESTIONS) console.log(`  [${g.relevance[q.id]}] ${q.text}`);
console.log("  まとめ(上・中だけ):");
for (const grp of g.groups) console.log(`   ■[${grp.level}] ${grp.label} … ${grp.questionIds.join(", ")} → ${grp.rephrased}`);
for (const w of g.warnings) console.log(`  ⚠ ${w}`);

for (const text of ["ゲームのキャラがジャンプするのはなんで?", "時計のふりこは、なんでずっと同じリズムなの?"]) {
  const a = await answerQuestion({ question: text, lesson: LESSON }, GRADE);
  console.log(`\n③ 個別の答え「${text}」 (${a.stats.sec}秒)`);
  console.log(`  答え: ${a.answer}`);
  console.log(`  シミュレーション: ${a.sim ? `${a.sim.type} 変えられる=[${a.sim.adjustable}]` : "なし"}`);
  for (const f of a.facts) console.log(`    (結果) ${f}`);
  console.log(`  先生へのメモ: ${a.teacherNote}`);
  for (const n of a.notes) console.log(`  ℹ ${n}`);
  for (const w of a.warnings) console.log(`  ⚠ ${w}`);
}

const s = await draftMaterial({ rephrased: "ばねののびと、ばねを引く力の関係", questions: [] }, 7, { simType: "spring" });
console.log(`\n② サンプル教材(中1・ばね) (${s.stats.sec}秒)`);
console.log(`  題: ${s.material.title}`);
console.log(`  シミュレーション: ${s.material.sim ? `${s.material.sim.type} 値=${JSON.stringify(s.material.sim.values)} 変えられる=[${s.material.sim.adjustable}] めあて=${s.material.sim.goal}` : "なし"}`);
for (const f of s.facts) console.log(`    (結果) ${f}`);
for (const [k, v] of Object.entries(s.material.lesson)) console.log(`  [${k}] ${v}`);
for (const q of s.material.quiz) console.log(`  確認問題: ${q.q} → 正解「${q.choices[q.answer]}」`);
for (const n of s.notes) console.log(`  ℹ ${n}`);
for (const w of s.warnings) console.log(`  ⚠ ${w}`);
