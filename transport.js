// 先生⇔児童の通信層。画面側はこのインターフェースだけを使う。
//   createClass(name) -> code    (createTransport({ role:'teacher', hybrid:true }) なら、オンライン + Bluetooth の併用。relay/transport-hybrid.js)
//   getClass(code) -> {name} | null
//   publishMaterial(code, material, { id }?) -> { id, publishedAt }
//   watchMaterials(code, cb) -> unsubscribe
//   sendQuestion(code, {seat, text})
//   watchQuestions(code, cb) -> unsubscribe
//   setQuestionStatus(code, id, status)
// 先生のログイン(Google):
//   teacherState() -> { kind: 'none'|'google'|'legacy'|'other', name, uid }   onAuthChange(cb) -> unsubscribe
//   teacherLogin() -> { linked, switched }   teacherLogout()   listMyClasses() -> [{ code, name, grade, createdAt }]
// Firebase 版と、設定なしで試せるデモ版（BroadcastChannel + localStorage）の2実装がある。
// 後で Web Bluetooth 中継を足すときも、同じ形の実装を1つ増やせばよい。
import { firebaseConfig } from './config.js';
import { classifyUser, loginPlan, teacherLabel, authErrorMessage } from './teacher-auth.js';
import { questionFields } from './question-fields.js';

export const isDemo = !firebaseConfig || new URLSearchParams(location.search).has('demo');

// 読み間違えやすい I, O, 0, 1 は使わない
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newCode(n = 6) {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return [...a].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}
export function normalizeCode(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * @param {{role?: 'student'|'teacher'}} [opt]  児童は匿名ログインを自動で行う。先生は自動では行わない(Google ログインを待つ)
 */
export async function createTransport({ role = 'student', relay = false, hybrid = false } = {}) {
  // relay:Bluetooth の教室だけ(先生PCの中にデータを持つ。先生の画面を localhost:8787 で開いたとき)。ネットにつながらなくてもよい
  if (relay) return (await import('./relay/transport-local.js')).createLocalTeacherTransport();
  const online = isDemo ? demoTransport() : await firebaseTransport(role);
  // hybrid:先生はオンラインのまま、児童は Bluetooth でもつながれるようにする(先生PCの Bluetooth 教室と、同じクラスコードで併用)
  if (hybrid && role === 'teacher') {
    const [{ createLocalTeacherTransport }, { createHybridTeacherTransport }] = await Promise.all([import('./relay/transport-local.js'), import('./relay/transport-hybrid.js')]);
    return createHybridTeacherTransport({ online, local: await createLocalTeacherTransport() });
  }
  return online;
}

// ---------- デモ版：同じブラウザ内のタブ同士で同期 ----------
function demoTransport() {
  const PREFIX = 'kyozai-demo:';
  const ch = 'BroadcastChannel' in window ? new BroadcastChannel('kyozai-demo') : null;
  const load = (c) => {
    try { return JSON.parse(localStorage.getItem(PREFIX + c)); } catch { return null; }
  };
  const listeners = new Set();
  const notify = (c) => { for (const l of listeners) if (l.code === c) l.fn(load(c)); };
  const save = (c, d) => {
    localStorage.setItem(PREFIX + c, JSON.stringify(d));
    ch?.postMessage(c); // 他のタブへ
    notify(c);          // 自分のタブへ（BroadcastChannel は自分には届かない）
  };
  if (ch) ch.onmessage = (e) => notify(e.data);
  addEventListener('storage', (e) => { if (e.key?.startsWith(PREFIX)) notify(e.key.slice(PREFIX.length)); });

  const watch = (code, pick, cb) => {
    const l = { code, fn: (d) => cb(pick(d)) };
    listeners.add(l);
    l.fn(load(code));
    return () => listeners.delete(l);
  };
  const must = (code) => {
    const d = load(code);
    if (!d) throw new Error('クラスが見つかりません');
    return d;
  };

  return {
    mode: 'demo',
    async createClass(name, grade) {
      let code;
      do code = newCode(); while (load(code));
      save(code, { name, grade, materials: [], questions: [] });
      return code;
    },
    async getClass(code) {
      const d = load(code);
      return d ? { name: d.name, grade: d.grade ?? null } : null;
    },
    // デモ版にはログインがないので、AIサーバーは使えない
    async getIdToken() { return null; },
    // デモ版の先生:ログインはいらない(同じブラウザの中だけ)
    teacherState() { return { kind: 'google', name: 'デモ', uid: this.myUid(), demo: true }; },
    onAuthChange() { return () => {}; },
    async teacherLogin() { return { linked: false, switched: false }; },
    async teacherLogout() {},
    async listMyClasses() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(PREFIX)) continue;
        const d = load(k.slice(PREFIX.length));
        if (d) out.push({ code: k.slice(PREFIX.length), name: d.name, grade: d.grade ?? null, createdAt: 0 });
      }
      return out;
    },
    // opt.id:教材の id を決める(Bluetooth 教室にも同じ教材を配信するとき、同じ id にして、二重に出ないようにする)
    async publishMaterial(code, m, { id } = {}) {
      const d = must(code);
      const item = { ...m, id: id ?? uid(), publishedAt: Date.now() };
      d.materials.push(item);
      save(code, d);
      return { id: item.id, publishedAt: item.publishedAt };
    },
    watchMaterials(code, cb) {
      return watch(code, (d) => [...(d?.materials ?? [])].sort((a, b) => b.publishedAt - a.publishedAt), cb);
    },
    // デモ版の「自分」:このブラウザごとの番号
    myUid() {
      let id = null;
      try { id = localStorage.getItem('kyozai-demo-uid'); } catch { /* なくてもよい */ }
      if (!id) { id = 'demo-' + uid(); try { localStorage.setItem('kyozai-demo-uid', id); } catch { /* なくてもよい */ } }
      return id;
    },
    async sendQuestion(code, q) {
      const d = must(code);
      d.questions.push({ ...questionFields(q), uid: this.myUid(), id: uid(), status: 'new', createdAt: Date.now() });
      save(code, d);
    },
    watchQuestions(code, cb) {
      return watch(code, (d) => [...(d?.questions ?? [])].sort((a, b) => b.createdAt - a.createdAt), cb);
    },
    async setQuestionStatus(code, id, status) { return this.updateQuestion(code, id, { status }); },
    async updateQuestion(code, id, fields) {
      const d = must(code);
      const q = d.questions.find((x) => x.id === id);
      if (q) { Object.assign(q, fields); save(code, d); }
    },
    async sendReply(code, r) {
      const d = must(code);
      (d.replies ??= []).push({ ...r, id: uid(), createdAt: Date.now() });
      save(code, d);
    },
    watchMyReplies(code, cb, { seat } = {}) {
      const me = this.myUid();
      return watch(code, (d) => {
        // デモの児童は同じブラウザIDを使う。元の質問の出席番号で宛先を分ける。
        const seats = new Map((d?.questions ?? []).map(q => [q.id, q.seat]));
        return (d?.replies ?? [])
          .filter(r => r.uid === me && (seat === undefined || seats.get(r.questionId) === seat))
          .sort((a, b) => b.createdAt - a.createdAt);
      }, cb);
    },
  };
}

// ---------- Firebase 版：Firestore のリアルタイム同期 ----------
async function firebaseTransport(role) {
  // アプリと一緒に保存し、再読み込み時も Firestore の端末キャッシュを使えるようにする。
  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import('./vendor/firebase/firebase-app.js'),
    import('./vendor/firebase/firebase-auth.js'),
    import('./vendor/firebase/firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);

  // 児童:匿名ログイン(名前やメールは一切使わない)。先生:Google ログイン(画面の「Google でログイン」から。自動では行わない)
  const auth = authMod.getAuth(app);
  await auth.authStateReady();
  if (role !== 'teacher' && !auth.currentUser) await authMod.signInAnonymously(auth);

  // 端末内キャッシュ：一度届いた教材はオフラインでも開ける
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  const { doc, getDoc, getDocs, setDoc, collection, addDoc, updateDoc, onSnapshot, query, orderBy, where, serverTimestamp } = fs;

  const ms = (v) => v?.toMillis?.() ?? Date.now();
  const toList = (snap) => snap.docs.map((d) => {
    const x = d.data({ serverTimestamps: 'estimate' });
    return { ...x, id: d.id, publishedAt: ms(x.publishedAt), createdAt: ms(x.createdAt) };
  });
  const sub = (code, name) => collection(db, 'classes', code, name);

  return {
    mode: 'firebase',
    async createClass(name, grade) {
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const ref = doc(db, 'classes', code);
        if ((await getDoc(ref)).exists()) continue;
        if (classifyUser(auth.currentUser) !== 'google') throw new Error('先生は Google でログインしてください');
        const data = { name, teacherUid: auth.currentUser.uid, createdAt: serverTimestamp() };
        if (Number.isInteger(grade)) data.grade = grade;
        await setDoc(ref, data);
        return code;
      }
      throw new Error('クラスコードを作れませんでした。もう一度試してください');
    },
    async getClass(code) {
      const s = await getDoc(doc(db, 'classes', code));
      // mine:このログインの人が作ったクラスか(別の先生のクラスを開かないため)
      return s.exists() ? { name: s.data().name, grade: s.data().grade ?? null, mine: s.data().teacherUid === auth.currentUser?.uid } : null;
    },
    // ---- 先生のログイン(Google) ----
    teacherState() {
      const u = auth.currentUser;
      return { kind: classifyUser(u), name: teacherLabel(u), uid: u?.uid ?? null };
    },
    onAuthChange(cb) { return authMod.onAuthStateChanged(auth, () => cb(this.teacherState())); },
    /**
     * Google でログイン。匿名のアカウントがあれば Google をひもづける(uid が変わらない=前のクラスをそのまま引き継げる)。
     * その Google アカウントがすでに別の uid で使われていたら、そちらのアカウントでログインする(switched: true。前の匿名のクラスは引き継げない)。
     */
    async teacherLogin() {
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      let linked = false, switched = false;
      try {
        const plan = loginPlan(auth.currentUser);
        if (plan === 'link') { await authMod.linkWithPopup(auth.currentUser, provider); linked = true; }
        else if (plan === 'popup') await authMod.signInWithPopup(auth, provider);
      } catch (e) {
        if (e?.code === 'auth/credential-already-in-use' || e?.code === 'auth/email-already-in-use') {
          const cred = authMod.GoogleAuthProvider.credentialFromError(e);
          if (!cred) throw new Error(authErrorMessage(e));
          await authMod.signInWithCredential(auth, cred);
          switched = true;
        } else throw new Error(authErrorMessage(e));
      }
      await auth.currentUser.getIdToken(true); // identities(google.com)を、ルールとAIサーバーが見るトークンに反映する
      return { linked, switched };
    },
    async teacherLogout() { await authMod.signOut(auth); },
    // 自分が作ったクラスの一覧(別のブラウザ・別のパソコンでも、自分のクラスを見つけられる)
    async listMyClasses() {
      const u = auth.currentUser;
      if (classifyUser(u) !== 'google') return [];
      const s = await getDocs(query(collection(db, 'classes'), where('teacherUid', '==', u.uid)));
      return s.docs.map((d) => ({ code: d.id, name: d.data().name, grade: d.data().grade ?? null, createdAt: ms(d.data().createdAt) })).sort((a, b) => b.createdAt - a.createdAt);
    },
    // AIサーバーに「このクラスの先生です」と示すためのトークン
    async getIdToken() { return auth.currentUser?.getIdToken() ?? null; },
    // opt.id:教材の id を決める(Bluetooth 教室にも同じ教材を配信するとき、同じ id にして、二重に出ないようにする)
    async publishMaterial(code, m, { id } = {}) {
      if (id) { await setDoc(doc(db, 'classes', code, 'materials', id), { ...m, publishedAt: serverTimestamp() }); return { id, publishedAt: Date.now() }; }
      const ref = await addDoc(sub(code, 'materials'), { ...m, publishedAt: serverTimestamp() });
      return { id: ref.id, publishedAt: Date.now() };
    },
    watchMaterials(code, cb) {
      return onSnapshot(query(sub(code, 'materials'), orderBy('publishedAt', 'desc')),
        (s) => cb(toList(s)), (e) => console.error(e));
    },
    myUid() { return auth.currentUser?.uid ?? null; },
    async sendQuestion(code, q) {
      // await しない：オフラインでも端末に積んでおき、つながった時に自動で届く
      // uid は、先生がこの児童だけに返事をするために使う(名前は送らない)
      addDoc(sub(code, 'questions'), {
        ...questionFields(q), uid: auth.currentUser.uid, status: 'new', createdAt: serverTimestamp(),
      }).catch((e) => console.error(e));
    },
    watchQuestions(code, cb) {
      return onSnapshot(query(sub(code, 'questions'), orderBy('createdAt', 'desc')),
        (s) => cb(toList(s)), (e) => console.error(e));
    },
    async setQuestionStatus(code, id, status) {
      await updateDoc(doc(db, 'classes', code, 'questions', id), { status });
    },
    async updateQuestion(code, id, fields) {
      await updateDoc(doc(db, 'classes', code, 'questions', id), fields);
    },
    // 先生から1人の児童へ返事を送る
    async sendReply(code, r) {
      await addDoc(sub(code, 'replies'), { ...r, createdAt: serverTimestamp() });
    },
    // 自分あての返事(ルールで、自分の uid のものしか読めない)
    watchMyReplies(code, cb) {
      return onSnapshot(query(sub(code, 'replies'), where('uid', '==', auth.currentUser.uid)),
        (s) => cb(toList(s).sort((a, b) => b.createdAt - a.createdAt)), (e) => console.error(e));
    },
  };
}
