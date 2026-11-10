// 児童の通信層:オンライン(Firebase)で入ったあとに、Bluetooth を「あとから足す」。
//   ① 児童はまずオンラインでクラスに入る(クラスコード + 出席番号)
//   ② クラスの画面で「Bluetooth でつなぐ」を押すと、先生のパソコンにも Bluetooth でつながる
//   ・教材:オンラインと Bluetooth の両方から受けて、同じ id のものは1つにまとめる
//   ・先生からの返事:両方から受けてまとめる(Bluetooth の返事は、Bluetooth 用の番号あて)
//   ・質問:Bluetooth がつながっているあいだは Bluetooth で送る(教室のネットに頼らない)。つながっていなければ、オンラインで送る
// Bluetooth を足さなければ(使えない端末・デモ)、オンラインの通信層とまったく同じに動く。
export function createStudentDualTransport(online) {
  let ble = null;
  const mats = new Map(); // code → Set<{cb, on:[], bl:[]}>
  const reps = new Map();
  const unsubs = new Map(); // watcher → { online, ble }

  const byIdDesc = (key) => (list) => {
    const seen = new Map();
    for (const x of list) if (x?.id != null && !seen.has(x.id)) seen.set(x.id, x);
    return [...seen.values()].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
  };
  const mergeMat = byIdDesc('publishedAt'), mergeRep = byIdDesc('createdAt');

  function wire(kind, w, code) {
    const subscribe = kind === 'mat' ? 'watchMaterials' : 'watchMyReplies';
    const merge = kind === 'mat' ? mergeMat : mergeRep;
    const emit = () => w.cb(merge([...w.on, ...w.bl]));
    const u = unsubs.get(w) ?? {};
    if (!u.online) { u.online = online[subscribe](code, (l) => { w.on = l ?? []; emit(); }); unsubs.set(w, u); }
    if (ble && !u.ble) { u.ble = ble[subscribe](code, (l) => { w.bl = l ?? []; emit(); }); }
  }
  function add(map, kind, code, cb) {
    const w = { cb, code, on: [], bl: [] };
    const set = map.get(code) ?? new Set(); map.set(code, set); set.add(w);
    wire(kind, w, code);
    return () => { set.delete(w); const u = unsubs.get(w); u?.online?.(); u?.ble?.(); unsubs.delete(w); };
  }

  const dual = Object.create(online);
  Object.assign(dual, {
    // Bluetooth の接続(createBleTransport の結果)を足す。見ているものは、Bluetooth からも受けはじめる
    attachBle(b) {
      detach();
      ble = b;
      for (const [code, set] of mats) for (const w of set) wire('mat', w, code);
      for (const [code, set] of reps) for (const w of set) wire('rep', w, code);
    },
    detachBle: () => detach(),
    watchMaterials: (code, cb) => add(mats, 'mat', code, cb),
    watchMyReplies: (code, cb) => add(reps, 'rep', code, cb),
    async sendQuestion(code, q) {
      // Bluetooth がつながっているあいだは Bluetooth(ネットが不安定でも届く)。ほかは、オンライン
      if (ble && ble.status().connected) return ble.sendQuestion(code, q);
      return online.sendQuestion(code, q);
    },
  });

  // (Object.assign だと getter がその場で評価されてしまうので、defineProperty で足す)
  Object.defineProperty(dual, 'ble', { get: () => (ble ? { status: () => ble.status(), onStatus: (cb) => ble.onStatus(cb), myUid: () => ble.myUid(), getClass: (c) => ble.getClass(c) } : null) });

  function detach() {
    if (!ble) return;
    for (const w of unsubs.keys()) { const u = unsubs.get(w); u.ble?.(); delete u.ble; w.bl = []; }
    try { ble.close(); } catch { /* 閉じられなくてもよい */ }
    ble = null;
  }
  return dual;
}
