// Firestoreのルールのテスト。`npm test` でエミュレーターを起動して実行します(Javaが必要)。
// データの形は README の「データの形(Firestore)」と同じ。
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

let env;
const CODE = "ABC234";

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-hakkason",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

// 先生は Google でログインしている人。トークンの firebase.identities に google.com が入る(本物の Google ログインと同じ形)
const GOOGLE = { email: "teacher@example.com", email_verified: true, firebase: { sign_in_provider: "google.com", identities: { "google.com": ["1001"], email: ["teacher@example.com"] } } };
const teacher = () => env.authenticatedContext("teacher", GOOGLE).firestore();
// 前の作りの先生(匿名ログイン)。Google にひもづけるまで、先生の権限はない
const anonTeacher = () => env.authenticatedContext("teacher").firestore();
// 匿名ログインに Google をひもづけた先生(linkWithPopup)。uid はそのまま、identities に google.com が入る
const linkedTeacher = () => env.authenticatedContext("teacher", { ...GOOGLE, firebase: { sign_in_provider: "anonymous", identities: { "google.com": ["1001"] } } }).firestore();
const otherTeacher = () => env.authenticatedContext("teacher-2", { ...GOOGLE, email: "t2@example.com", firebase: { sign_in_provider: "google.com", identities: { "google.com": ["2002"] } } }).firestore();
const student = () => env.authenticatedContext("student-a").firestore();
const other = () => env.authenticatedContext("student-b").firestore();
const guest = () => env.unauthenticatedContext().firestore();

const questions = (db, code = CODE) => collection(db, "classes", code, "questions");
const materials = (db) => collection(db, "classes", CODE, "materials");

async function makeClass() {
  await assertSucceeds(
    setDoc(doc(teacher(), "classes", CODE), {
      name: "5年1組",
      teacherUid: "teacher",
      createdAt: serverTimestamp(),
    })
  );
}

const question = (over = {}) => ({
  seat: 3,
  text: "ふりこのおもりを重くすると、はやくなるの?",
  status: "new",
  createdAt: serverTimestamp(),
  ...over,
});

test("先生はクラスを作れる。作ったクラスは、だれも上書きできない", async () => {
  await makeClass();
  await assertFails(
    setDoc(doc(student(), "classes", CODE), { name: "x", teacherUid: "student-a", createdAt: serverTimestamp() })
  );
  await assertFails(updateDoc(doc(teacher(), "classes", CODE), { name: "変更" }));
});

test("クラスに決められた項目以外は入れられない。ほかの人を先生にできない", async () => {
  await assertFails(
    setDoc(doc(teacher(), "classes", CODE), {
      name: "5年1組", teacherUid: "teacher", createdAt: serverTimestamp(), extra: 1,
    })
  );
  await assertFails(
    setDoc(doc(student(), "classes", CODE), { name: "5年1組", teacherUid: "teacher", createdAt: serverTimestamp() })
  );
});

test("クラスに学年(5〜9:小5〜中3)を入れられる。範囲の外や数でない学年は入れられない", async () => {
  const make = (code, grade) =>
    setDoc(doc(teacher(), "classes", code), { name: "5年1組", teacherUid: "teacher", createdAt: serverTimestamp(), grade });
  await assertSucceeds(make("GRADE5", 5));
  await assertSucceeds(make("GRADE9", 9));
  await assertFails(make("GRADE0", 0));
  await assertFails(make("GRADE4", 4));
  await assertFails(make("GRADEX", 10));
  await assertFails(make("GRADES", "5"));
});

test("クラスはコードで読めるが、一覧は取れない。ログインしていないと読めない", async () => {
  await makeClass();
  await assertSucceeds(getDoc(doc(student(), "classes", CODE)));
  await assertFails(getDocs(collection(student(), "classes")));
  await assertFails(getDoc(doc(guest(), "classes", CODE)));
});

test("児童が送った質問が、先生の画面にリアルタイムで届く", async () => {
  await makeClass();
  const arrived = new Promise((resolve, reject) => {
    const stop = onSnapshot(
      query(questions(teacher()), orderBy("createdAt", "desc")),
      (snap) => {
        if (snap.size > 0) {
          stop();
          resolve(snap.docs[0].data());
        }
      },
      reject
    );
  });
  await assertSucceeds(addDoc(questions(student()), question()));
  const q = await arrived;
  if (q.seat !== 3 || !q.text.includes("ふりこ")) throw new Error(`届いた内容がちがう: ${JSON.stringify(q)}`);
});

test("児童は質問を読めない(自分のも、ほかの児童のも)", async () => {
  await makeClass();
  await addDoc(questions(student()), question());
  await assertFails(getDocs(questions(student())));
  await assertFails(getDocs(questions(other())));
});

test("おかしな質問は送れない", async () => {
  await makeClass();
  const db = student();
  await assertFails(addDoc(questions(db), question({ seat: 0 })));
  await assertFails(addDoc(questions(db), question({ seat: 61 })));
  await assertFails(addDoc(questions(db), question({ seat: "3" })));
  await assertFails(addDoc(questions(db), question({ text: "" })));
  await assertFails(addDoc(questions(db), question({ text: "あ".repeat(201) })));
  await assertFails(addDoc(questions(db), question({ status: "done" })));
  await assertFails(addDoc(questions(db), question({ name: "やまだ" }))); // 名前は扱わない
  await assertFails(addDoc(questions(guest()), question()));
});

test("ないクラスには質問を送れない", async () => {
  await assertFails(addDoc(questions(student(), "NOPE99"), question()));
});

test("質問の状態を変えられるのは先生だけ", async () => {
  await makeClass();
  const ref = await addDoc(questions(student()), question());
  await assertFails(updateDoc(doc(student(), ref.path), { status: "done" }));
  await assertSucceeds(updateDoc(doc(teacher(), ref.path), { status: "done" }));
});

test("質問に、自分の uid・AIに聞いたか・教材の題をつけられる。ほかの人の uid はつけられない", async () => {
  await makeClass();
  await assertSucceeds(addDoc(questions(student()), question({ uid: "student-a", aiTried: true, materialTitle: "振り子の1往復" })));
  await assertFails(addDoc(questions(student()), question({ uid: "student-b" })));
  await assertFails(addDoc(questions(student()), question({ aiTried: "yes" })));
  await assertFails(addDoc(questions(student()), question({ materialTitle: "あ".repeat(61) })));
  // AIが具体化する前の、もとの言い方
  await assertSucceeds(addDoc(questions(student()), question({ uid: "student-a", original: "それって重いとどうなるの?" })));
  await assertFails(addDoc(questions(student()), question({ original: "あ".repeat(201) })));
  await assertFails(addDoc(questions(student()), question({ original: 3 })));
});

test("先生の返事は、宛先の児童と先生だけが読める。児童は返事を書けない", async () => {
  await makeClass();
  const replies = (db) => collection(db, "classes", CODE, "replies");
  const reply = { uid: "student-a", question: "おもりを重くすると?", answer: "1往復する時間は変わらないよ。", createdAt: serverTimestamp() };
  await assertSucceeds(addDoc(replies(teacher()), reply));
  await assertFails(addDoc(replies(student()), { ...reply, uid: "student-a" }));
  await assertSucceeds(getDocs(query(replies(student()), where("uid", "==", "student-a"))));
  await assertFails(getDocs(query(replies(other()), where("uid", "==", "student-a"))));
  await assertFails(getDocs(replies(other())));
  await assertSucceeds(getDocs(replies(teacher())));
});

test("先生は、質問に関係の強さ(上・中・下)をつけられる。児童はつけられない", async () => {
  await makeClass();
  const ref = await addDoc(questions(student()), question({ uid: "student-a" }));
  await assertSucceeds(updateDoc(doc(teacher(), ref.path), { relevance: "上" }));
  await assertFails(updateDoc(doc(student(), ref.path), { relevance: "上" }));
});

test("教材を配信できるのは先生だけ。児童は読める", async () => {
  await makeClass();
  const m = { title: "ふりこの長さと周期", explanation: "…", sim: { type: "pendulum" }, quiz: [] };
  await assertFails(addDoc(materials(student()), m));
  await assertSucceeds(addDoc(materials(teacher()), { ...m, publishedAt: serverTimestamp() }));
  await assertSucceeds(getDocs(materials(student())));
  await assertFails(getDocs(materials(guest())));
});

// ---------- 先生のログイン(Google) ----------

test("先生になれるのは Google ログインの人だけ。匿名ログインではクラスを作れない", async () => {
  await assertFails(setDoc(doc(anonTeacher(), "classes", CODE), { name: "5年1組", teacherUid: "teacher", createdAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(teacher(), "classes", CODE), { name: "5年1組", teacherUid: "teacher", createdAt: serverTimestamp() }));
  // 自分以外の uid の先生としては作れない
  await assertFails(setDoc(doc(otherTeacher(), "classes", "OTHER2"), { name: "x", teacherUid: "teacher", createdAt: serverTimestamp() }));
});

test("匿名で作った前のクラスは、Google をひもづけた(同じ uid の)先生なら、そのまま管理できる。ひもづけていない匿名の先生は、もう管理できない", async () => {
  // 前の作りで、匿名の先生が作ったクラス(ルールを通さずに用意する)
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "classes", CODE), { name: "5年1組", teacherUid: "teacher", createdAt: serverTimestamp() });
  });
  const m = { title: "ふりこ", explanation: "x", sim: null, quiz: [] };
  await assertSucceeds(addDoc(materials(linkedTeacher()), { ...m, publishedAt: serverTimestamp() }));
  await assertSucceeds(getDocs(questions(linkedTeacher())));
  await assertFails(addDoc(materials(anonTeacher()), { ...m, publishedAt: serverTimestamp() }));
  await assertFails(getDocs(questions(anonTeacher())));
  // 別の Google の先生は、他人のクラスを管理できない
  await assertFails(addDoc(materials(otherTeacher()), { ...m, publishedAt: serverTimestamp() }));
  await assertFails(getDocs(questions(otherTeacher())));
});

test("先生は、自分のクラスの一覧だけ取れる(別のブラウザでも見つけられる)。ほかの人のクラス・児童・匿名の先生は取れない", async () => {
  await makeClass();
  await assertSucceeds(setDoc(doc(otherTeacher(), "classes", "OTHER2"), { name: "6年1組", teacherUid: "teacher-2", createdAt: serverTimestamp() }));
  const mine = (db, uid) => getDocs(query(collection(db, "classes"), where("teacherUid", "==", uid)));
  const own = await assertSucceeds(mine(teacher(), "teacher"));
  assert.deepEqual(own.docs.map((d) => d.id), [CODE]);
  const theirs = await assertSucceeds(mine(otherTeacher(), "teacher-2"));
  assert.deepEqual(theirs.docs.map((d) => d.id), ["OTHER2"]);
  await assertFails(mine(teacher(), "teacher-2"));            // ほかの先生のクラスを指定しても取れない
  await assertFails(getDocs(collection(teacher(), "classes"))); // 全部の一覧も取れない
  await assertFails(mine(student(), "teacher"));              // 児童は取れない
  await assertFails(mine(anonTeacher(), "teacher"));          // 匿名の先生も取れない
  await assertFails(mine(guest(), "teacher"));
});

test("児童(匿名)は、いままでどおり、クラスコードで教材を読み・質問を送れる。先生の権限は増えない", async () => {
  await makeClass();
  await assertSucceeds(addDoc(materials(teacher()), { title: "t", explanation: "e", sim: null, quiz: [], publishedAt: serverTimestamp() }));
  await assertSucceeds(getDocs(materials(student())));
  await assertSucceeds(addDoc(questions(student()), question({ uid: "student-a" })));
  await assertFails(getDocs(questions(student())));
  await assertFails(addDoc(materials(student()), { title: "t", explanation: "e", sim: null, quiz: [], publishedAt: serverTimestamp() }));
});

test('実験の根拠JSONを質問に添付できる。大きすぎる値・文字列でない値は拒否する', async () => {
  await makeClass();
  await assertSucceeds(addDoc(questions(student()), question({ uid:'student-a', inquiryContext:'{"schema":1,"rootId":"r","runs":[]}' })));
  await assertSucceeds(addDoc(questions(student()), question({ inquiryContext:'a'.repeat(40000) })));
  await assertFails(addDoc(questions(student()), question({ inquiryContext:'a'.repeat(40001) })));
  await assertFails(addDoc(questions(student()), question({ inquiryContext:{ runs:[] } })));
});
