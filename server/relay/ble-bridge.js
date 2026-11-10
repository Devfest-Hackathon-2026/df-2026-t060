// 中継アプリ(relay/TeacherRelay。Windows の Bluetooth の「待ち受け役」)と、このサーバーをつなぐ口。
// 中継アプリは、Bluetooth で受けた chunk を、そのままここへ運ぶだけ。組み立て・窓口・分割は、RelayPeripheral がする。
// 同じパソコンの中(127.0.0.1)の TCP だけ。1行が1つの JSON(NDJSON):
//   アプリ → ここ  {"t":"hello","app":"TeacherRelay","name":"KyozaiRelay-AB12"}   (なくてもよい)
//                  {"t":"open","s":"<接続の名前>","mtu":185}    端末が1台つながった。mtu = 1回の通知で送れる大きさ
//                  {"t":"rx","s":"<接続の名前>","b":"<base64>"}  端末から chunk が届いた
//                  {"t":"close","s":"<接続の名前>"}              端末が切れた
//   ここ → アプリ  {"t":"tx","s":"<接続の名前>","b":"<base64>"}  端末へ chunk を通知する
import net from 'node:net';
import { toBase64, fromBase64 } from '../../public/js/relay/protocol.js';

const MAX_LINE = 64 * 1024;       // 1行の上限(それをこえたら切る)
const MAX_SESSIONS = 60;          // 同時につなげる端末の数
const NAME = /^[\w.:@-]{1,100}$/;

/**
 * @param {{peripheral: import('../../public/js/relay/peripheral.js').RelayPeripheral, port: number, host?: string, log?: (msg: string) => void}} o
 * @returns {Promise<{port: number, status: () => object, close: () => Promise<void>}>}
 */
export function startBridge({ peripheral, port, host = '127.0.0.1', log = () => {} }) {
  let app = null; // いまつながっている中継アプリ { socket, sessions: Map, name }
  const server = net.createServer((socket) => {
    // 新しい中継アプリがつながったら、前のものは切る(アプリを入れなおしたとき)
    if (app) { app.drop('新しい中継アプリがつながったので、前のものを切ります'); }
    const sessions = new Map(); // 接続の名前 → conn
    const me = { socket, sessions, name: '', drop: (why) => { log(why); socket.destroy(); } };
    app = me;
    socket.setEncoding('utf8');
    let buf = '';
    const write = (obj) => { if (!socket.destroyed) socket.write(JSON.stringify(obj) + '\n'); };

    socket.on('data', (data) => {
      buf += data;
      if (buf.length > MAX_LINE * 2 && !buf.includes('\n')) { me.drop('1行が長すぎる(中継アプリとの通信を切ります)'); return; }
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        if (line.length > MAX_LINE) { me.drop('1行が長すぎる(中継アプリとの通信を切ります)'); return; }
        let m; try { m = JSON.parse(line); } catch { continue; } // 読めない行は捨てる
        handle(m);
      }
    });
    function handle(m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') { me.name = String(m.name ?? '').slice(0, 60); log(`中継アプリがつながりました${me.name ? `(${me.name})` : ''}`); return; }
      if (typeof m.s !== 'string' || !NAME.test(m.s)) return;
      if (m.t === 'open') {
        if (sessions.has(m.s)) sessions.get(m.s).close();
        if (sessions.size >= MAX_SESSIONS) { write({ t: 'refuse', s: m.s, why: 'full' }); return; }
        const mtu = Number.isInteger(m.mtu) && m.mtu >= 20 && m.mtu <= 512 ? m.mtu : undefined;
        sessions.set(m.s, peripheral.openConnection({ notifyBytes: mtu, send: (chunk) => write({ t: 'tx', s: m.s, b: toBase64(chunk) }) }));
      } else if (m.t === 'rx') {
        const conn = sessions.get(m.s);
        if (!conn || typeof m.b !== 'string' || m.b.length > 2048) return;
        conn.write(fromBase64(m.b));
      } else if (m.t === 'close') {
        sessions.get(m.s)?.close(); sessions.delete(m.s);
      }
    }
    socket.on('close', () => {
      for (const c of sessions.values()) c.close();
      sessions.clear();
      if (app === me) { app = null; log('中継アプリが切れました'); }
    });
    socket.on('error', () => {}); // 切れたときの error は、close で片づける
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        status: () => ({ listening: true, appConnected: !!app, appName: app?.name ?? '', connections: app?.sessions.size ?? 0 }),
        close: () => new Promise((ok) => { app?.socket.destroy(); server.close(() => ok()); }),
      });
    });
  });
}
