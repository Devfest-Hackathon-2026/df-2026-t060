// 先生の画面用の通信層(Bluetooth 教室)。教室のデータは、先生PCの中(server/relay)にある。ネットにつながらなくても使える。
// 先生の画面を、先生PCの http://localhost:8787/teacher.html?relay で開いたときに使う。transport.js と同じ形。
//   児童の Chromebook は、Bluetooth(transport-ble.js)で、同じ教室のデータにつながる。
//   先生PC自身の画面は、この HTTP(同じパソコンの中)と SSE(変わったことの知らせ)で、同じデータを見る。
export async function createLocalTeacherTransport({ base = globalThis.location?.origin, fetchFn = globalThis.fetch?.bind(globalThis), EventSourceCtor = globalThis.EventSource } = {}) {
  const api = async (method, path, body) => {
    const res = await fetchFn(`${base}/relay${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `先生PCのサーバーのエラー(${res.status})`), { status: res.status });
    return data;
  };

  // クラスごとに、知らせの流れ(SSE)を1本だけ持つ。見ている画面がなくなったら閉じる
  const streams = new Map(); // code → { es, subs: { materials:Set, questions:Set, students:Set }, last: {} }
  function open(code) {
    let s = streams.get(code);
    if (s) return s;
    const es = new EventSourceCtor(`${base}/relay/class/${encodeURIComponent(code)}/stream`);
    s = { es, subs: { materials: new Set(), questions: new Set(), students: new Set() }, last: {} };
    for (const kind of ['materials', 'questions', 'students']) {
      es.addEventListener(kind, (ev) => {
        let data; try { data = JSON.parse(ev.data); } catch { return; }
        s.last[kind] = data;
        for (const cb of s.subs[kind]) { try { cb(data); } catch (e) { console.error(e); } }
      });
    }
    streams.set(code, s);
    return s;
  }
  function subscribe(code, kind, cb) {
    const s = open(code);
    s.subs[kind].add(cb);
    if (kind in s.last) cb(s.last[kind]); // すでに届いている分は、すぐ渡す
    return () => {
      s.subs[kind].delete(cb);
      if (!s.subs.materials.size && !s.subs.questions.size && !s.subs.students.size) { s.es.close(); streams.delete(code); }
    };
  }

  return {
    mode: 'relay',
    // opt.code:コードを決めて作る(オンラインのクラスと同じコードの教室にする。もうあれば、そのまま)
    async createClass(name, grade, { code } = {}) { return (await api('POST', '/classes', { name, grade: Number.isInteger(grade) ? grade : undefined, code })).code; },
    async getClass(code) {
      try { const c = await api('GET', `/class/${encodeURIComponent(code)}`); return { name: c.name, grade: c.grade ?? null, mine: true }; }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    // AIサーバーは、先生PC自身の画面からの呼び出しを、ログインなしで受けつける(server/index.js)
    async getIdToken() { return null; },
    // opt.id・opt.publishedAt:オンラインと同じ教材 id・配信時刻で入れる(同じ id は二重に入らない)
    async publishMaterial(code, m, { id, publishedAt } = {}) {
      const r = await api('POST', `/class/${encodeURIComponent(code)}/materials`, { material: { ...m, ...(id ? { id } : {}), ...(Number.isFinite(publishedAt) ? { publishedAt } : {}) } });
      return { id: r.id, publishedAt: r.publishedAt };
    },
    watchMaterials(code, cb) { return subscribe(code, 'materials', cb); },
    watchQuestions(code, cb) { return subscribe(code, 'questions', cb); },
    /** Bluetooth でつながっている児童の端末の数({count}) */
    watchStudents(code, cb) { return subscribe(code, 'students', cb); },
    myUid() { return 'relay-local'; },
    async setQuestionStatus(code, id, status) { await api('POST', `/class/${encodeURIComponent(code)}/questions/${encodeURIComponent(id)}`, { fields: { status } }); },
    async updateQuestion(code, id, fields) { await api('POST', `/class/${encodeURIComponent(code)}/questions/${encodeURIComponent(id)}`, { fields }); },
    async sendReply(code, r) { await api('POST', `/class/${encodeURIComponent(code)}/replies`, { reply: r }); },
    watchMyReplies() { return () => {}; },
    async sendQuestion() { throw new Error('先生の画面からは、質問は送れません'); },
    // 先生のログイン:この先生PC自身なので、ログインはいらない
    teacherState() { return { kind: 'google', name: '先生PC', uid: 'relay-local', demo: true }; },
    onAuthChange() { return () => {}; },
    async teacherLogin() { return { linked: false, switched: false }; },
    async teacherLogout() {},
    async listMyClasses() { return (await api('GET', '/classes')).map((c) => ({ code: c.code, name: c.name, grade: c.grade ?? null, createdAt: c.createdAt })); },
    status: () => api('GET', '/status'),
    close() { for (const s of streams.values()) s.es.close(); streams.clear(); },
  };
}
