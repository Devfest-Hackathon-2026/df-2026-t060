// 偽の Web Bluetooth(navigator.bluetooth)。先生PCの中継(RelayPeripheral)に、GATT の形でつなぐ。
// Node のテストと、ブラウザのテストの両方で使う。本物の機器は使わない(本物の Bluetooth の動きとは、ちがうところがあるかもしれない)。
//   本物に近づけたところ:機器の選択(キャンセルもある)・GATT 接続の失敗・サービスと特性の名前の確認・通知は順番どおりに非同期で届く・
//                       書きこみは「応答あり」なら長い書きこみ、「応答なし」は MTU-3 までに制限・切断の知らせ(gattserverdisconnected)

const tick = () => new Promise((r) => setTimeout(r, 0));
const domError = (name, msg) => Object.assign(new Error(msg), { name });

/**
 * @param {{peripheral: object, uuids: {service: string, rx: string, tx: string}, notifyBytes?: number, mtu?: number, deviceName?: string}} o
 *   uuids:relay/protocol.js の SERVICE_UUID・RX_UUID・TX_UUID(Node とブラウザで、読みこみ方がちがうので、呼ぶ側からもらう)
 *   notifyBytes:1回の通知で送れる大きさ(中継アプリが知らせる値)  mtu:ATT の MTU(「応答なし」の書きこみの上限は mtu-3)
 */
export function createFakeBluetooth({ peripheral, uuids, notifyBytes = 185, mtu = 185 + 3, deviceName = 'KyozaiRelay-TEST' }) {
  const { service: SERVICE_UUID, rx: RX_UUID, tx: TX_UUID } = uuids;
  const ctl = { connectable: true, chooserCancels: false, writes: [], writeSizes: [], connects: 0, failWrites: 0 };
  let conn = null, device = null;

  const rx = Object.assign(new EventTarget(), {
    uuid: RX_UUID,
    async writeValueWithResponse(value) { // 長い書きこみ(MTU をこえても、OS がまとめて送る)
      if (!device?.gatt.connected) throw domError('NetworkError', 'GATT Server is disconnected');
      if (ctl.failWrites > 0) { ctl.failWrites--; throw domError('NetworkError', 'GATT operation failed'); }
      await tick();
      const bytes = new Uint8Array(value.buffer ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value);
      ctl.writes.push(bytes); ctl.writeSizes.push(bytes.length);
      conn?.write(bytes);
    },
    async writeValueWithoutResponse(value) {
      if (value.byteLength > mtu - 3) throw domError('NetworkError', `GATT operation failed(MTU ${mtu} をこえる書きこみ)`);
      return this.writeValueWithResponse(value);
    },
    async writeValue(value) { return this.writeValueWithResponse(value); },
  });
  const tx = Object.assign(new EventTarget(), {
    uuid: TX_UUID, value: null, notifying: false,
    async startNotifications() { this.notifying = true; return this; },
    async stopNotifications() { this.notifying = false; return this; },
  });
  const deliver = (chunk) => { // 通知:順番どおり、非同期に届く
    if (!tx.notifying) return;
    const copy = chunk.slice();
    queueMicrotask(() => { tx.value = new DataView(copy.buffer); tx.dispatchEvent(Object.assign(new Event('characteristicvaluechanged'), {})); });
  };
  const service = { uuid: SERVICE_UUID, async getCharacteristic(uuid) { if (uuid === RX_UUID) return rx; if (uuid === TX_UUID) return tx; throw domError('NotFoundError', 'No Characteristics matching UUID found'); } };

  const bluetooth = {
    async requestDevice(opts) {
      const wants = (opts?.filters ?? []).flatMap((f) => f.services ?? []);
      if (!wants.includes(SERVICE_UUID)) throw domError('NotFoundError', 'Device not found'); // 先生PCのサービスで絞らないと、見つからない、というまね
      if (ctl.chooserCancels) throw domError('NotFoundError', 'User cancelled the requestDevice() chooser.');
      device = Object.assign(new EventTarget(), { name: deviceName, id: 'fake-device' });
      device.gatt = {
        connected: false,
        async connect() {
          ctl.connects++;
          if (!ctl.connectable) throw domError('NetworkError', 'Connection attempt failed.');
          await tick();
          conn?.close();
          conn = peripheral.openConnection({ notifyBytes, send: deliver });
          this.connected = true;
          return { async getPrimaryService(uuid) { if (uuid !== SERVICE_UUID) throw domError('NotFoundError', 'No Services matching UUID found'); return service; } };
        },
        disconnect() { if (this.connected) { this.connected = false; conn?.close(); conn = null; device.dispatchEvent(new Event('gattserverdisconnected')); } },
      };
      return device;
    },
  };
  return {
    bluetooth, ctl,
    /** 電波がとだえた、というまね:切断の知らせが届く */
    drop() { device?.gatt.disconnect(); },
    get connected() { return !!device?.gatt.connected; },
  };
}
