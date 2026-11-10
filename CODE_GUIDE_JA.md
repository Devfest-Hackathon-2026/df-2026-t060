# どのコードが何をするか

完成物は、先生と生徒が同じ登録済み物理モデルとデータ形式を使うWebアプリです。元の先生側のプロジェクトに追加・修正しています。JavaScriptは画面と物理、PythonはこのPCでの簡単な起動、Nodeは友達PCの先生側AIと通信を担当します。

## 担当ごとの入口

| 変える内容 | 主なファイル | 作ったもの |
|---|---|---|
| 色・余白・配置・タブ・近くの案内 | public/css/inquiry.css | 明るい操作パネル、PCで実験とノートを並置、タブレットの1列表示。従来style.cssへ上書きする追加CSS |
| 予想・気づき・保存・削除・説明・次の問い | public/js/sim2/ui/experiment.js | 全単元共通の探究ノート。入力欄の近くで不足を案内。記録・説明の履歴を折りたたむ |
| 2件の同時比較・長時間観察・3Dで重ねる | public/js/sim2/ui/inquiry-compare.js | 同じ時計で2エンジンを進め、表示範囲を共通にする。観測と初期条件による推論を分け、比較表を出す |
| 記録の形式・単位・版・根拠の受け渡し | public/js/inquiry-data.js | captureRun / encodeContext / parseContext / checkedConfig。モデルの版、全初期条件、観察時間、根拠IDを保存 |
| 実験の再生とUI | public/js/sim2/ui/player.js | 操作するまで停止。条件変更で停止・リセット。再実験の条件をスライダーにも反映。画面を閉じたら計算と描画を終了 |
| 固定刻みの物理計算 | public/js/sim2/core/engine.js | dtは固定し、表示用のtimeScaleだけを分離。天体は実時間1秒あたりモデル600秒 |
| 誤差の検査 | public/js/sim2/core/monitor.js、systems/orbit/validator.js | 衝突後の力学的エネルギー減少を数値計算の誤差として警告しない。衝突前の検査は維持 |
| 天体の式・3Dの物体・矢印 | public/js/sim2/systems/orbit/model.js | 地球の万有引力による3D計算。未来の全軌道から倍率を決めず、観察中の位置に合わせる。衛星と矢印の表示上の拡大を明示 |
| 音・空気の縦波 | public/js/sim2/systems/sound/ | 音速343m/s、振動数、相対音圧振幅、空気の左右の動きと圧力変化。変位と圧力の位相関係を分ける |
| 工房と教材で使える実験 | public/js/lab-scope.js、hybrid-lab.js | 共通の11モデルを登録し、選択・取り込み・AI案を同じ範囲で検査 |
| 3Dの見た目と視点 | public/js/sim2/render/studio-views.js、studio-art.js、three3d.js、public/css/studio.css | モデルから舞台を組み立て、星、環、力の向き、光線や波面を表示 |
| 実験の観察項目とおすすめ比較 | public/js/studio-metrics.js、hybrid-workbench.js | 注目値・同じ時刻のA/B・条件の差の検査 |
| 板と球が接触する計算 | public/js/sim2/core/rigid-world.js、systems/hybrid-systems.js | 固定刻みで衝突と床の摩擦を計算し、倒れた枚数と時刻を記録 |
| 元の3Dの入口 | public/original-3d.html、public/js/original-3d-scenes.js | 元の太陽系・投射・衝突の3Dを別画面で動かす |
| 先生の根拠カード・比較案の編集 | public/js/inquiry-teacher.js | 観察と条件を読んで、手動案またはGemma案を編集。確認用の教材フォームに入れ、先生の配信操作を待つ |
| 先生画面への接続 | public/js/teacher.js | 根拠カード、教材パック、承認後の改訂番号・出所の保存。新しい質問が届いても編集中の根拠カードを保持 |
| 生徒画面への接続 | public/js/student.js、sims.js | 部屋・出席番号・教材・根の問いを探究ノートへ渡す。生徒側Gemmaの自動ダウンロードを停止 |
| クラスの発展の履歴 | public/js/inquiry-growth.js | 根の問いごとに改訂を並べ、生徒の問いと実験の出所をたどる。新しい教材カードは同じ根の最新版を出す |
| 教材を追加 | public/js/lesson-import.js、public/lessons/sound-intro.json | 本文・TXT・JSONと登録済みモデルを結び、先生が確認して配信。出典と利用条件も保存 |
| 根拠データを送る項目 | public/js/question-fields.js | 従来は落ちていたinquiryContextを保持する |
| Bluetoothの長い根拠データ | public/js/relay/protocol.js、transport-ble.js | 転送の途中で新しい断片が届いている間は期限を延長し、応答待ちを30秒にする |
| Bluetooth教室の受け付け | public/js/relay/room-store.js | 同じデータ項目をローカル中継でも許可。元の通信実装を使用 |
| Firebaseの受け付け | firestore.rules | 根拠JSON文字列を質問に付けられるルール。オンライン運用前に友達側で反映が必要 |
| Gemmaの比較案API | server/inquiry-plan.js、server/index.js | /api/inquiry-plan。実験記録をプロンプトに入れ、答え・問い・比較2条件・理由・見分け方を返す。条件の範囲を検査する |
| オフライン起動 | public/inquiry-offline-sw.js、offline-register.js、offline-files.json | 静的ファイルを保存。APIと認証は保存しない。Three.jsと原版3Dも保存 |
| このPCでの起動 | start_local.py、start_windows.bat | 追加ライブラリ不要のローカルHTTPサーバー。publicを配り、起動URLを表示 |
| 最初の試験用教材とクラス | public/demo.html、js/inquiry-demo.js | 本番Firebaseに触らず、同一ブラウザ内で先生・生徒A/Bを試す |

## 今回の核となるデータ

実験1件には `id / version / config / elapsed / steps / dt / prediction / observation / measures / observed / sourceIds / trace` を持たせます。天体の `inference` は、初期エネルギーなど式からの推論であり、`observed` と別です。

`inquiryContext` はJSON文字列1項目です。`schema / rootId / materialId / revision / question / runs / reflection` を持ちます。転送時に軌跡を間引き、最大6件・40000文字かつ48KiB以内に制限します。これは記録IDと物理条件を変える圧縮ではありません。

教材の `inquiry` には `rootId / revision / sources / sourceQuestionIds / sourceQuestions / parentMaterialIds / comparison` を保存します。生徒Aの実験IDを生徒Bの実験の `sourceIds` に入れるので、「同じテーマの質問が並んでいる」だけでなく、根拠の引き継ぎが分かります。

## AIを接続すると何が増えるか

Gemmaを使わなくても、実験・記録・比較・説明・質問の共有・先生の手動承認は動きます。Gemmaをつなぐと、質問だけでなく実際の条件・観察時間・測定値・生徒の説明を読み、答えの案と次の比較案を提案します。測定値をAIに作らせません。

返る比較案には `answer / question / target / configs[2] / rationale / distinguish / sourceRecordIds / source` があります。Gemmaは指定された数値条件の2値と文章だけを返し、アプリが登録済みの設定へ組み立てます。範囲外や同じ2条件は拒否します。AIの文章の正しさ・教育的な妥当性まで自動保証する仕組みではなく、先生が確認する前提です。

## 教材とモデルを増やす

既存モデルで扱える教材は、本文と初期条件を追加するだけです。先生画面の教材取り込みで、同梱の `public/lessons/sound-intro.json` を試せます。PDFなら本文を貼り付けます。任意のPDFの式や図から未知の物理モデルを自動で完成させる機能は、この版にはありません。

モデル自体を追加する場合は `ADD_SYSTEM.md` の手順に従います。モデルの範囲外の質問は、無理に既存モデルで答えを出さず、先生が扱う範囲を決めます。

スキーマ等の元JSONを直したら、次を順に実行します。配布済みのファイルは生成済みなので、初回の実行は不要です。

```bash
python tools/build-json-modules.py
node tools/build-offline.mjs
```

通常のJSモジュールも同梱し、ブラウザのJSON import属性構文への依存をなくしています。オフライン配布内容を変更してリリースするときは、Service WorkerのVERSIONも更新してください。

## 表現上の大事な区別

- 音の設定値は相対的な振幅。端末のスピーカーの実測dBではありません。
- 天体の球と矢印は見やすく拡大。矢印の長さから力や速さの大小は読みません。
- 説明の「結果・根拠・理由・まだ分からないこと」の印は、記述の有無です。理解の正しさの点数やクラス内の順位ではありません。
- クラスでの発展は、授業中の探究と説明の改善を指します。科学界で未知の法則を発見したと自動判定するものではありません。
