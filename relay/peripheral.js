// 先生PCの側の、Bluetooth 1接続ぶんの動き:届いた chunk を組み立てて窓口(RelayHub)に渡し、窓口の返事を chunk に分けて返す。
// 中継アプリ(relay/TeacherRelay)は、Bluetooth の chunk をそのまま運ぶだけ。組み立て・分割・窓口は、全部こちら(Node)でする。
//   const peripheral = new RelayPeripheral({ hub });
//   const conn = peripheral.openConnection({ notifyBytes: 185, send: (chunk) => app.notify(session, chunk) });
//   conn.write(chunk)   // 端末から chunk が届いた
//   conn.close()        // つながりが切れた
import { Framer, Reassembler, encodeMessage, decodeMessage, HEADER_BYTES, DEFAULT_NOTIFY_BYTES } from './protocol.js';

export class RelayPeripheral {
  /** @param {{hub: import('./hub.js').RelayHub, now?: () => number, onWarn?: (msg: string) => void}} o */
  constructor({ hub, now = Date.now, onWarn = () => {} }) { Object.assign(this, { hub, now, onWarn }); }

  /**
   * @param {{notifyBytes?: number, send: (chunk: Uint8Array) => void}} o  notifyBytes:1回の通知で送れる大きさ(中継アプリが知らせる)
   */
  openConnection({ notifyBytes = DEFAULT_NOTIFY_BYTES, send }) {
    const framer = new Framer();
    const reasm = new Reassembler({ now: this.now });
    const chunkMax = Math.max(HEADER_BYTES + 8, Number(notifyBytes) || DEFAULT_NOTIFY_BYTES);
    let closed = false;
    const session = this.hub.openSession((obj) => {
      if (closed) return;
      let chunks;
      try { chunks = framer.split(encodeMessage(obj), chunkMax); }
      catch (e) { this.onWarn(`送れないメッセージ:${e.message}`); return; } // 大きすぎるものは送らない(接続は続ける)
      for (const c of chunks) send(c);
    });
    return {
      write: (chunk) => {
        if (closed) return;
        const r = reasm.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
        if (r.dropped) { this.onWarn(`捨てた chunk:${r.dropped}`); return; }
        if (!r.message) return;
        let msg;
        try { msg = decodeMessage(r.message); } catch { this.onWarn('読めないメッセージ(JSON でない)'); return; }
        session.receive(msg);
      },
      close: () => { if (!closed) { closed = true; session.close(); } },
    };
  }
}
