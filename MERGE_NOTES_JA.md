# 教材compと通信compの統合

通信compの `hakkason-complete` を基に、教材compの新しい探究機能を一つの `public/` にまとめました。

| 対象 | 統合した内容 |
|---|---|
| 児童 | 予想・実験・比較・説明・次の問い。記録と下書きの保存、不足時の入力案内、研究計画、3Dでの自己評価 |
| 先生 | 実験の根拠と自己評価の確認、本人への返却、比較案の承認と再配信 |
| 通信 | FirebaseとBluetoothの併用。先生のモデル管理、児童の実験助手とことばの辞書 |
| 起動と保存 | Windows起動ファイル、デモ教室、オフライン保存。Firebase SDKの同梱、同じブラウザのデモで出席番号ごとに返事を表示 |

配布ZIPのルートに `start_windows.bat`、`start_local.py`、`public/`、`server/` を置いています。最初は [START_HERE_JA.md](START_HERE_JA.md) を参照してください。

## 確認した範囲

- Nodeのテスト228件、Firestoreエミュレーターのルール18件、既存のブラウザテスト17画面が成功しました。
- Chromiumで、児童Aの実験・自己評価から先生の返却と承認を経て、児童Bが改訂2を比較し、改訂3まで進むことを確認しました。音の教材と、オフラインでの再読み込み・学習の再開も確認しました。
- Firebaseの本番サイトとCloud Runへの反映、実機間のBluetooth接続、実際のGoogleログインとGemmaの推論は、利用先の環境で確認してください。

---

## 前の統合の記録

友達の `hakkason-complete.zip` に、私たちの最新の変更(コミット 474eaea まで)を合わせた版です。元の zip は変えていません。

### もとになった版(ベース)

友達の版は、私たちのコミット **4f1d0ae**(2026-11-07 21:33)から作られています。そのあとに、私たちが足した変更を、3方向でマージしました。

### 私たちが足したもの

1. **オンライン + Bluetooth の併用**:先生は、先生PCの `http://localhost:8787/teacher.html` を開くだけ(Google ログインのまま)。配信は Firestore と先生PCの Bluetooth 教室の両方へ(同じ教材 id)、質問は1つの一覧に(Bluetooth の児童の質問には印)、返事は宛先の児童の側へ。児童は同じリンクで、オンラインでも、ネットが不安定なら「Bluetooth でつなぐ」でも入れる。オンラインにつながらなければ、Bluetooth を勧める。
   (`public/js/relay/transport-hybrid.js`・`transport.js`・`transport-local.js`・`room-store.js`・`teacher.js`・`student.js`・`student.html`)
2. Bluetooth 教室の仕上げ(児童用リンクを公開の https にする、説明書 `docs/bluetooth-relay.md`)。
3. テスト:`tests/relay-hybrid.test.js`・`tests/relay-app.test.js`、実ブラウザ `ble-student`・`ble-fallback`・`relay-teacher`・`relay-hybrid`・`student-demo`。
4. 起動時の確認のタイマーが、成功したあとで「Bluetooth が使えない」に切りかえてしまう不具合の修正(併用の通信層)。

### どう合わせたか

| ファイル | 扱い |
|---|---|
| `README.md`・`public/js/relay/room-store.js`・`public/js/teacher.js`・`public/student.html` | 友達の変更はそのまま。**3方向マージ**で、私たちの変更だけを足した(衝突なし) |
| `public/js/student.js` | 友達の変更(URL の `seat` を出席番号に入れる、`seat` つきの保存キー)と、私たちの変更(Bluetooth の入口・オンラインからの切りかえ)が、同じ場所で重なった。**両方を残して**解いた。友達の `seat` の入れ方は、Bluetooth だけの入口にも使う |
| `tests/relay-core.test.js` | 友達が足したテスト(長い根拠データの組み立て)と、私たちが足したテスト(クラスコード・教材 id)が、同じ場所に足されていた。**両方を残した** |
| `CLAUDE.md`・`docs/bluetooth-relay.md`・`public/js/transport.js`・`public/js/relay/transport-local.js`・`server/relay/index.js`・`tests/browser/fake-transport.js`・`tools/browser-check.mjs` | 友達は**内容を変えていなかった**(改行が CRLF になっていただけ)ので、私たちの最新版に置きかえた |
| 新しく追加 | `public/js/relay/transport-hybrid.js`、`tests/relay-hybrid.test.js`、`tests/relay-app.test.js`、`tests/browser/ble-fallback.html`・`ble-student.html`・`relay-hybrid.html`・`relay-teacher.html`・`student-demo.html` |

友達が追加した 64 ファイル(探究の画面・音声・オフラインなど)と、友達が変えたファイルは、そのまま入っています。

### 確かめたこと(マージ後のフォルダで)

- Node のテスト 207 件:206 成功・0 失敗(1 件は Windows で試せない項目を飛ばした)。友達の `inquiry-flow`・`inquiry-server` も含む
- Firestore のルールのテスト 18 件:全部成功(Firestore エミュレーター)
- 実ブラウザ(ヘッドレス Chrome)のテスト 15 ページ:全部成功

確かめていないこと:友達の `demo.html` など、友達が足した画面の見た目・操作(友達の自動テストが通っただけ)。**本物の Chromebook・Android との Bluetooth 接続**、本物の Google ログイン、Cloud Run は、未確認。併用での「オンライン + Bluetooth の同時利用」は、ブラウザ上のまね(デモ版のオンライン + 本物の先生PC側のサーバー)で確かめたもので、本物の Firestore との組み合わせは未確認。
