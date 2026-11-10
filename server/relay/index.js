// Bluetooth 教室(先生PCの中に教室のデータを持つ)の、サーバー側:
//   - 教室のデータ(RoomStore)を、ファイルに保存する(先生PCを再起動しても、クラス・教材・質問が残る)
//   - 児童の端末の窓口(RelayHub)・Bluetooth 1接続の動き(RelayPeripheral)
//   - 中継アプリとの口(ble-bridge.js。RELAY_BLE_PORT を決めたときだけ)
//   - 先生の画面が使う HTTP の口(/relay/…)。先生の画面と同じ場所(localhost)からだけ受けつける
// Cloud Run では動かさない(Bluetooth は先生PCのもの)。
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RoomStore } from '../../public/js/relay/room-store.js';
import { RelayHub } from '../../public/js/relay/hub.js';
import { RelayPeripheral } from '../../public/js/relay/peripheral.js';
import { startBridge } from './ble-bridge.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * 先生の画面からの呼び出しか(同じパソコン・同じ場所の画面だけ)。
 *   - 接続元が、このパソコン自身(ループバック)
 *   - Host が localhost / 127.0.0.1(DNS リバインディングで、悪い Web ページが localhost を呼ぶのを防ぐ)
 *   - Origin があるなら、このサーバー自身と同じ(ほかのサイトの画面からは使えない)
 */
export function isLocalTeacherRequest(req) {
  if (!LOOPBACK.has(req.socket?.remoteAddress ?? '')) return false;
  const host = String(req.headers.host ?? '');
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  if (!HOSTS.has(hostname)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  return true;
}

/**
 * @param {{dataDir: string, bridgePort?: number|null, log?: (m: string) => void, saveDelayMs?: number}} o
 */
export async function createRelay({ dataDir, bridgePort = null, log = () => {}, saveDelayMs = 500 }) {
  const file = resolve(dataDir, 'relay-rooms.json');
  let store = new RoomStore();
  try { store = RoomStore.fromJSON(JSON.parse(await readFile(file, 'utf8'))); log(`教室のデータを読みこみました(${store.classes.size}クラス)`); } catch { /* はじめて・読めなければ、まっさらから */ }

  // ---- 保存(まとめて書く。途中で電源が切れても、こわれないよう、いったん別のファイルに書いてから置きかえる) ----
  let timer = null, saving = Promise.resolve();
  const saveNow = () => {
    clearTimeout(timer); timer = null;
    saving = saving.then(async () => {
      await mkdir(dataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(store.toJSON()), 'utf8');
      await rename(tmp, file);
    }).catch((e) => log(`教室のデータを保存できませんでした:${e.message}`));
    return saving;
  };
  store.onChange(() => { if (!timer) timer = setTimeout(saveNow, saveDelayMs); });

  const hub = new RelayHub({ store });
  const peripheral = new RelayPeripheral({ hub, onWarn: log });
  let bridge = null;
  if (bridgePort !== null && bridgePort !== undefined) {
    bridge = await startBridge({ peripheral, port: bridgePort, log });
    log(`中継アプリとの口:127.0.0.1:${bridge.port}`);
  }

  // ---- 先生の画面が使う HTTP の口 ----
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const sse = new Map(); // クラスコード → Set(res)

  // 変わったことを、先生の画面(SSE)に知らせる
  const sendEvent = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  store.onChange((code, kind) => {
    for (const res of sse.get(code) ?? []) {
      if (kind === 'materials') sendEvent(res, 'materials', store.materials(code));
      if (kind === 'questions') sendEvent(res, 'questions', store.questions(code));
    }
  });
  hub.onSessionsChange((total, by) => {
    for (const [code, set] of sse) for (const res of set) sendEvent(res, 'students', { count: by[code] ?? 0, total });
  });

  /** @returns {Promise<boolean>} このリクエストを処理したか */
  async function handleHttp(req, res, url, { readJson, HttpError }) {
    if (!url.pathname.startsWith('/relay/')) return false;
    // 先生の画面と同じ場所(localhost)からだけ
    if (!isLocalTeacherRequest(req)) throw new HttpError(403, 'Bluetooth 教室の画面は、先生のパソコンの localhost からだけ使えます');
    const p = url.pathname.slice('/relay/'.length).split('/').filter(Boolean).map(decodeURIComponent);
    const m = req.method;
    const must = (code) => { const c = store.getClass(code); if (!c) throw new HttpError(404, 'クラスが見つかりません'); return c; };
    const guard = (fn) => { try { return fn(); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, e.message); } };

    if (m === 'GET' && p[0] === 'status') return json(res, 200, { enabled: true, students: hub.sessionCount, bridge: bridge?.status() ?? { listening: false }, classes: store.classes.size }), true;
    if (m === 'GET' && p[0] === 'classes' && p.length === 1) return json(res, 200, store.listClasses()), true;
    if (m === 'POST' && p[0] === 'classes' && p.length === 1) {
      const b = await readJson(req);
      return json(res, 200, { code: guard(() => store.createClass({ name: b.name, grade: Number.isInteger(b.grade) ? b.grade : undefined, code: b.code })) }), true;
    }
    if (p[0] === 'class' && p[1]) {
      const code = p[1];
      if (m === 'GET' && p.length === 2) return json(res, 200, { ...must(code), mine: true }), true;
      if (m === 'GET' && p[2] === 'stream') {
        must(code);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        const set = sse.get(code) ?? new Set(); sse.set(code, set); set.add(res);
        sendEvent(res, 'materials', store.materials(code)); sendEvent(res, 'questions', store.questions(code)); sendEvent(res, 'students', { count: hub.sessionCount, total: hub.sessionCount });
        const beat = setInterval(() => res.write(': keep-alive\n\n'), 20000);
        req.on('close', () => { clearInterval(beat); set.delete(res); });
        return true;
      }
      if (m === 'POST' && p[2] === 'materials') { must(code); const b = await readJson(req); return json(res, 200, guard(() => store.publishMaterial(code, b.material))), true; }
      if (m === 'POST' && p[2] === 'questions' && p[3]) { must(code); const b = await readJson(req); return json(res, 200, guard(() => store.updateQuestion(code, p[3], b.fields))), true; }
      if (m === 'POST' && p[2] === 'replies') { must(code); const b = await readJson(req); return json(res, 200, guard(() => store.addReply(code, b.reply))), true; }
    }
    throw new HttpError(404, 'ありません');
  }

  return {
    store, hub, peripheral, bridge, handleHttp,
    /** AIサーバーが、Bluetooth 教室のクラスの先生(先生PC自身)かを確かめる。クラスの学年を返す(なければ null) */
    localTeacher(req, code) { return isLocalTeacherRequest(req) && store.getClass(code) ? { uid: 'relay-local', grade: store.getClass(code).grade ?? 5 } : null; },
    saveNow,
    async close() { await saveNow(); await bridge?.close(); },
  };
}
