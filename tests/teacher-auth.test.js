// 先生のログイン(Google)の判断のテスト:画面側(public/js/teacher-auth.js)とAIサーバー側(server/auth.js)。
//   node --test tests/teacher-auth.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyUser, loginPlan, authErrorMessage, pickSavedClass, teacherLabel } from "../public/js/teacher-auth.js";
import { checkTeacherClaims, readAllowList, AuthError } from "../server/auth.js";

const google = { isAnonymous: false, providerData: [{ providerId: "google.com" }], displayName: "山田 花子", email: "hanako@school.ed.jp" };
const linked = { isAnonymous: false, providerData: [{ providerId: "google.com" }], email: "t@example.com" }; // 匿名に Google をひもづけたあと
const anon = { isAnonymous: true, providerData: [] };

test("ログインの種類:Google・匿名(前の作りの先生か児童)・ログインなし", () => {
  assert.equal(classifyUser(null), "none");
  assert.equal(classifyUser(google), "google");
  assert.equal(classifyUser(linked), "google");
  assert.equal(classifyUser(anon), "legacy");
  assert.equal(classifyUser({ isAnonymous: false, providerData: [{ providerId: "password" }] }), "other");
});

test("ログインの進め方:匿名なら Google をひもづける(uid が変わらず、前のクラスを引き継げる)・ログインなしならポップアップ・済みなら何もしない", () => {
  assert.equal(loginPlan(anon), "link");
  assert.equal(loginPlan(null), "popup");
  assert.equal(loginPlan(google), "already");
  assert.equal(loginPlan({ isAnonymous: false, providerData: [] }), "popup");
});

test("エラーの文:先生にわかることばで、直し方もそえる。知らないコードでも例外にならない", () => {
  assert.match(authErrorMessage({ code: "auth/popup-blocked" }), /ポップアップ/);
  assert.match(authErrorMessage({ code: "auth/operation-not-allowed" }), /Authentication/);
  assert.match(authErrorMessage({ code: "auth/unauthorized-domain" }), /承認済みドメイン/);
  assert.match(authErrorMessage({ code: "auth/something-new" }), /auth\/something-new/);
  assert.match(authErrorMessage(new Error("boom")), /boom/);
  assert.match(authErrorMessage(null), /ログインできませんでした/);
});

test("覚えているクラスを開くのは、自分のクラスのときだけ(別の先生がログインしていたら開かない)", () => {
  const saved = { code: "ABC234", name: "5年1組", grade: 5 };
  assert.equal(pickSavedClass(saved, [{ code: "ABC234" }, { code: "ZZZ999" }]), saved);
  assert.equal(pickSavedClass(saved, [{ code: "ZZZ999" }]), null);
  assert.equal(pickSavedClass(saved, []), null);
  assert.equal(pickSavedClass(saved, null, true), saved, "一覧が取れないときは、クラスの持ち主で決める");
  assert.equal(pickSavedClass(saved, null, false), null);
  assert.equal(pickSavedClass(null, [{ code: "ABC234" }]), null);
});

test("先生の表示名:名前、なければメールの @ の前。メール全体は出さない", () => {
  assert.equal(teacherLabel(google), "山田 花子");
  assert.equal(teacherLabel(linked), "t");
  assert.equal(teacherLabel({}), "Google アカウント");
  assert.equal(teacherLabel(null), "");
});

// ---------- AIサーバー側 ----------
const token = (over = {}) => ({ sub: "uid-1", email: "Hanako@School.ed.jp", email_verified: true, firebase: { sign_in_provider: "google.com", identities: { "google.com": ["1"], email: ["hanako@school.ed.jp"] } }, ...over });
const NONE = { emails: [], domains: [] };
const expectError = (fn, status, re) => assert.throws(fn, (e) => e instanceof AuthError && e.status === status && re.test(e.message));

test("AIサーバー:Google ログインの先生は使える。匿名ログイン(児童)は使えない", () => {
  assert.deepEqual(checkTeacherClaims(token(), NONE), { uid: "uid-1", email: "hanako@school.ed.jp" });
  expectError(() => checkTeacherClaims({ sub: "kid", firebase: { sign_in_provider: "anonymous", identities: {} } }, NONE), 401, /Google でログイン/);
  expectError(() => checkTeacherClaims({ sub: "kid" }, NONE), 401, /Google でログイン/);
  // 匿名に Google をひもづけたあと(sign_in_provider は anonymous のままでも、identities に google.com がある)
  assert.equal(checkTeacherClaims(token({ firebase: { sign_in_provider: "anonymous", identities: { "google.com": ["1"] } } }), NONE).uid, "uid-1");
});

test("AIサーバー:許可するメール・ドメインを決めると、その人だけ使える(大文字小文字・@つきの書き方・確かめていないメールに注意)", () => {
  const env = { TEACHER_EMAILS: " Hanako@School.ed.jp , x@example.com ", TEACHER_DOMAINS: "@city.ed.jp" };
  const allow = readAllowList(env);
  assert.deepEqual(allow, { emails: ["hanako@school.ed.jp", "x@example.com"], domains: ["city.ed.jp"] });
  assert.equal(checkTeacherClaims(token(), allow).email, "hanako@school.ed.jp");                       // メールで許可
  assert.equal(checkTeacherClaims(token({ email: "taro@city.ed.jp" }), allow).uid, "uid-1");            // ドメインで許可
  expectError(() => checkTeacherClaims(token({ email: "evil@gmail.com" }), allow), 403, /許可されていません/);
  expectError(() => checkTeacherClaims(token({ email: "taro@city.ed.jp.evil.com" }), allow), 403, /許可されていません/); // ドメインのなりすまし
  expectError(() => checkTeacherClaims(token({ email_verified: false }), allow), 403, /許可されていません/);
  expectError(() => checkTeacherClaims({ ...token(), email: undefined }, allow), 403, /許可されていません/);
  // 何も決めていなければ制限しない(先生PCで動かすとき)
  assert.deepEqual(readAllowList({}), { emails: [], domains: [] });
  assert.equal(checkTeacherClaims(token({ email: "anyone@gmail.com" }), readAllowList({})).uid, "uid-1");
});
