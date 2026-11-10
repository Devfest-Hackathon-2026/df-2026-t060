// 中継アプリ(relay/TeacherRelay/Program.cs。C#)と、JavaScript 側の取り決めが、食いちがわないことの見張り。
// C# のアプリは、ここでは動かせない(Windows の Bluetooth が要る)ので、決まりごと(UUID・メッセージの名前)だけを照らす。
//   node --test tests/relay-app.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERVICE_UUID, RX_UUID, TX_UUID } from "../public/js/relay/protocol.js";

const cs = readFileSync(new URL("../relay/TeacherRelay/Program.cs", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../server/relay/ble-bridge.js", import.meta.url), "utf8");

test("中継アプリ(C#)の UUID が、JavaScript(protocol.js)と同じ", () => {
  const get = (name) => new RegExp(`const string ${name} = "([0-9a-f-]+)"`).exec(cs)?.[1];
  assert.equal(get("ServiceUuid"), SERVICE_UUID);
  assert.equal(get("RxUuid"), RX_UUID);
  assert.equal(get("TxUuid"), TX_UUID);
});

test("中継アプリとサーバーの、メッセージの名前(hello・open・rx・close・tx)と項目(s・b・mtu)が、両方に出てくる", () => {
  // アプリ → サーバー:hello / open / rx / close  サーバー → アプリ:tx
  for (const t of ["hello", "open", "rx", "close"]) {
    assert.match(cs, new RegExp(`t = "${t}"`), `C# が ${t} を送る`);
    assert.match(bridge, new RegExp(`m\\.t === '${t}'`), `Node が ${t} を受ける`);
  }
  assert.match(cs, /GetProperty\("t"\)\.GetString\(\) != "tx"/, "C# が tx を受ける");
  assert.match(bridge, /t: 'tx'/, "Node が tx を送る");
  for (const k of ["s", "b"]) { assert.match(cs, new RegExp(`\\b${k} = `)); assert.match(cs, new RegExp(`GetProperty\\("${k}"\\)`)); }
  assert.match(cs, /mtu/); assert.match(bridge, /m\.mtu/);
  // 接続の名前は、Node が受けつける形(英数字・._:@-、100字まで)にしてある(SHA1 の 16 文字)
  assert.match(cs, /SHA1\.HashData/); assert.match(cs, /\[\.\.16\]/);
  // 中継アプリの標準の口は、サーバーの標準の口(8788)と同じ
  assert.match(cs, /Arg\("--port", "8788"\)/); assert.match(readFileSync(new URL("../server/index.js", import.meta.url), "utf8"), /RELAY_BLE_PORT \?\? "8788"/);
});
