# 統合の内訳

| 入力 | 提出版での反映 |
|---|---|
| `hackathon-complete.zip` | 先生・児童画面、5段階の探究、3D振り返り、モデル管理、通信、オフラインの土台 |
| `TeacherRelay-HybridSim-AutoSave.zip` | 実験工房の入口、教材への条件の引き継ぎ、自動保存の考え方を実際の先生画面へ結合。Windowsの中継は土台の `relay/TeacherRelay` を維持 |
| `gemma412Bシミュレーション.docx` | 宇宙・力学・電気・波／光／音・流体の実験一覧。浮力、ドップラー効果、二重振り子、倒れる板を共通エンジンに追加。先生のGemma APIから登録済みの実験を提案 |

原案の追加ZIPとWordは `docs/source/` に収録しています。Wordから取り出したHTMLは `docs/original/` に置き、太陽系・投射・衝突の場面を工房でオフライン起動できるように復元しました。授業用の太陽系は8惑星を計算します。板の連鎖は、床と板が接触する剛体の計算を使います。旧版の記録を開く場合は、その記録の支点モデルを再現します。

## 主なコード

| ファイル | 担当 |
|---|---|
| `public/js/hybrid-lab.js`・`hybrid-workbench.js` | 実験の一覧、範囲の検査、プレビューと教材化 |
| `public/js/sim2/systems/hybrid-systems.js` | 追加4モデルの式・描画・測定 |
| `server/lab-plan.js`・`server/inquiry-plan.js` | 工房の実験選択と、記録を使う比較案の生成 |
| `public/js/auto-save.js`・`teacher.js` | クラスごとの教材下書き、確認、配信 |
| `public/js/sim2/ui/inquiry-compare.js` | 同時比較、6時間と10日への早送り、計算した軌道の2D／3D表示 |
| `public/js/relay/transport-ble.js`・`server/relay/`・`relay/TeacherRelay/` | ブラウザのBLEとWindows中継、端末保存、質問と教材の配信 |

## 手元の確認

ブラウザで「児童Aの観測 → 先生の確認 → 児童Bの再実験 → 次の問い → 改訂3」を通しました。別の検証では、実サーバーのHTTP・SSEと中継のTCPを使い、GATT機器とGemma応答だけ模擬して「実験工房 → 保存・復元 → 配信 → 根拠の受信 → 先生の承認 → 児童Bの3D」まで確認しています。ここには無線の到達距離、実機固有の端末対応、実際のGemmaの生成品質は含みません。

工房の11実験と原版3Dの確認は `tools/studio-browser.cjs`、数値と配信範囲の確認は `tests/studio.test.js` と `tests/hybrid-lab.test.js`。クラスの検証は `tools/inquiry-flow-browser.cjs`（デモ）と `tools/final-integration-browser.cjs`（先生サーバー、模擬GATTとGemma）です。ブラウザテストにはPlaywrightとChromiumが必要です。

## 先生PCと児童端末での最終確認

Gemmaが入っている先生PCで `start_classroom.bat` を開き、別端末でBluetooth接続します。サンプルの問い1件を送り、先生がGemmaの案を編集して配信し、児童側で改訂教材を開きます。次にインターネットを切り、受信済み教材を開けることと、Bluetoothの再接続で未送信の問いが届くことを確認します。iPadでの無線接続は未検証です。
