# 3D工房の改訂

- 元の太陽系・投射・ドミノ／タワーの3Dを復元し、元のHTMLも保存しました。
- 配信する教材の実験、取り込み、AIの候補を実験工房の11モデルに統一しました。
- 工房の全実験に3Dと2Dを用意し、条件を一つ変えて同時刻の測定値を比較できます。
- 授業用太陽系は8惑星を計算し、板の連鎖は接触と摩擦を計算します。
- 音声入力と認識モデルを削除し、音の実験の再生は残しました。

詳しくは [工房の使い方](docs/EXPERIMENT_STUDIO_JA.md) を参照してください。
# 今回の変更一覧

元の先生側ソースに対して93ファイルを追加・変更しました。同梱モデルと自動生成ファイルも含みます。

| 状態 | ファイル |
|---|---|
| 追加 | AI_CONNECTION_JA.md |
| 追加 | CODE_GUIDE_JA.md |
| 追加 | LICENSES/Apache-2.0.txt |
| 追加 | LICENSES/VOICE_ASSET_HASHES.json |
| 追加 | LICENSES/VOICE_NOTICES.txt |
| 追加 | LICENSES/uuid-LICENSE.md |
| 変更 | LICENSES.md |
| 変更 | README.md |
| 追加 | START_HERE_JA.md |
| 追加 | VERIFICATION_JA.md |
| 変更 | firestore.rules |
| 追加 | inquiry.code-workspace |
| 追加 | public/css/inquiry.css |
| 追加 | public/demo.html |
| 追加 | public/icon.svg |
| 追加 | public/inquiry-offline-sw.js |
| 追加 | public/inquiry-voice.js |
| 追加 | public/js/inquiry-data.js |
| 追加 | public/js/inquiry-demo.js |
| 追加 | public/js/inquiry-growth.js |
| 追加 | public/js/inquiry-teacher.js |
| 追加 | public/js/lesson-import.js |
| 変更 | public/js/question-fields.js |
| 変更 | public/js/relay/protocol.js |
| 変更 | public/js/relay/room-store.js |
| 変更 | public/js/relay/transport-ble.js |
| 変更 | public/js/sim2/core/engine.js |
| 変更 | public/js/sim2/core/explain.js |
| 変更 | public/js/sim2/core/facts.js |
| 変更 | public/js/sim2/core/monitor.js |
| 変更 | public/js/sim2/render/canvas3d.js |
| 変更 | public/js/sim2/render/graphs.js |
| 変更 | public/js/sim2/render/three3d.js |
| 追加 | public/js/sim2/systems/circuit/examples.json.js |
| 追加 | public/js/sim2/systems/circuit/schema.json.js |
| 追加 | public/js/sim2/systems/heat/examples.json.js |
| 追加 | public/js/sim2/systems/heat/schema.json.js |
| 追加 | public/js/sim2/systems/incline/examples.json.js |
| 追加 | public/js/sim2/systems/incline/schema.json.js |
| 変更 | public/js/sim2/systems/index.js |
| 追加 | public/js/sim2/systems/lens/examples.json.js |
| 追加 | public/js/sim2/systems/lens/schema.json.js |
| 追加 | public/js/sim2/systems/orbit/examples.json.js |
| 変更 | public/js/sim2/systems/orbit/model.js |
| 追加 | public/js/sim2/systems/orbit/schema.json.js |
| 変更 | public/js/sim2/systems/orbit/validator.js |
| 追加 | public/js/sim2/systems/particle/examples.json.js |
| 追加 | public/js/sim2/systems/particle/schema.json.js |
| 追加 | public/js/sim2/systems/pendulum/examples.json.js |
| 追加 | public/js/sim2/systems/pendulum/schema.json.js |
| 追加 | public/js/sim2/systems/planetg/examples.json.js |
| 追加 | public/js/sim2/systems/planetg/schema.json.js |
| 追加 | public/js/sim2/systems/projectile/examples.json.js |
| 追加 | public/js/sim2/systems/projectile/schema.json.js |
| 追加 | public/js/sim2/systems/roller/examples.json.js |
| 追加 | public/js/sim2/systems/roller/schema.json.js |
| 追加 | public/js/sim2/systems/solar/examples.json.js |
| 追加 | public/js/sim2/systems/solar/schema.json.js |
| 追加 | public/js/sim2/systems/sound/examples.json |
| 追加 | public/js/sim2/systems/sound/examples.json.js |
| 追加 | public/js/sim2/systems/sound/model.js |
| 追加 | public/js/sim2/systems/sound/schema.json |
| 追加 | public/js/sim2/systems/sound/schema.json.js |
| 追加 | public/js/sim2/systems/sound/validator.js |
| 追加 | public/js/sim2/systems/wave/examples.json.js |
| 追加 | public/js/sim2/systems/wave/schema.json.js |
| 変更 | public/js/sim2/ui/experiment.js |
| 追加 | public/js/sim2/ui/inquiry-compare.js |
| 変更 | public/js/sim2/ui/player.js |
| 変更 | public/js/sims.js |
| 変更 | public/js/student.js |
| 変更 | public/js/teacher.js |
| 追加 | public/lessons/sound-intro.json |
| 追加 | public/manifest.webmanifest |
| 追加 | public/models/vosk-ja-0.22.tar.gz |
| 追加 | public/offline-files.json |
| 追加 | public/offline-register.js |
| 変更 | public/student.html |
| 変更 | public/teacher.html |
| 追加 | public/vendor/vosk.js |
| 変更 | server/index.js |
| 追加 | server/inquiry-plan.js |
| 追加 | start_local.py |
| 追加 | start_windows.bat |
| 変更 | tests/browser/planetg.html |
| 変更 | tests/browser/wave-heat.html |
| 追加 | tests/inquiry-flow.test.js |
| 追加 | tests/inquiry-server.test.js |
| 変更 | tests/relay-core.test.js |
| 変更 | tests/rules.test.js |
| 追加 | tools/build-json-modules.py |
| 追加 | tools/build-offline.mjs |
| 追加 | tools/inquiry-flow-browser.cjs |

## 2026-11-08 児童の実験助手:ことばの読みとりの精度
- 追加:`public/js/sim2/systems/student-words.json`(.json.js)… コードなしで編集できる辞書
- 変更:`core/assistant.js` … 向きのことば(大きく・近づけて など)の読みとり、単位だけで決まる数(30度で)、0 の条件を「速く」で動かす、条件の名前のあとのプリセットのことばを無視、説明のキーワード
- 直した:「いと」→「糸」の置きかえが「高いところ」「したいとき」の中でも起きていた
- 直した:`eval/run.mjs` が `CLASSIFY_MODEL` を読めずに止まっていた(`classifyModel()` に)
- 追加:`eval/student-holdout.jsonl`・`eval/student-blind.jsonl`・`tests/sim2-student-words.test.js`。`eval/run-student.mjs` は `STUDENT_SET` で別のセットを選べる
- 更新:`public/offline-files.json`(辞書と、抜けていた relay の2ファイルが入った)・Service Worker の版
- 元のファイルは `_backup_2026-11-08/`
