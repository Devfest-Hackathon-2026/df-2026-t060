# 使っている外のコード・フォント・データとライセンス

配布時はライセンス本文も同梱します。児童用のGemmaは、保存済みならロードだけ行い、未保存のモデルは準備ボタンを押したときに取得します。

## コード

| 名前 | 使っているところ | ライセンス | 入れ方 |
|---|---|---|---|
| [WebLLM](https://github.com/mlc-ai/web-llm)(MLC AI) | 児童の端末のAI(`public/js/student-ai.js`) | Apache License 2.0 | 0.2.86 の変更版を同梱。`LICENSES/WEBLLM_NOTICES.md` と `WEBLLM-Apache-2.0.txt` |
| [Firebase JavaScript SDK](https://github.com/firebase/firebase-js-sdk)(Google) | 通信・ログイン(`public/js/transport.js`) | Apache License 2.0(`LICENSES/Apache-2.0.txt`) | npm のブラウザ向け 10.12.2 を `public/js/vendor/firebase/` に同梱。Auth と Firestore の App モジュール参照先を相対パスに変更 |
| [jose](https://github.com/panva/jose)(Filip Skokan) | AIサーバーのログイン確認(`server/index.js`) | MIT License | npm(6.2.12 に固定) |
| [Three.js](https://github.com/mrdoob/three.js)(mrdoob ほか) | 工房と授業の3D表示、原案の3D場面の復元 | MIT License | `public/js/vendor/three.module.js`(0.160.0)をそのまま同梱(ライセンスの文は `public/js/vendor/THREE-LICENSE.txt`)。3D 表示にしたときだけ読みこむ。外部CDNを使わない |
| [@firebase/rules-unit-testing](https://github.com/firebase/firebase-js-sdk) | Firestore のルールのテスト(開発だけ) | Apache License 2.0 | npm(開発用) |


## AIモデル

| 名前 | 使っているところ | 利用条件 |
|---|---|---|
| Gemma 4 12B(Google)、Ollama で実行 | 先生PCのAI(`server/`) | [Gemma Terms of Use](https://ai.google.dev/gemma/terms)(オープンソースのライセンスではない。禁止されている使い方の方針に従う) |
| Gemma 4 E2B / Gemma 3 1B(Google)、WebLLM で実行 | 児童の端末の任意AI | 同上。モデルの重みは同梱していない |

## フォント(端末に入っている場合に使用)

| 名前 | 使っているところ | ライセンス |
|---|---|---|
| BIZ UDPGothic(Morisawa) | 文字全体 | SIL Open Font License 1.1 |
| Space Mono(Colophon Foundry) | シミュレーションの数値 | SIL Open Font License 1.1 |

## データ(物理の値の出典)

| 値 | 出典 |
|---|---|
| 天体の表面の重力加速度(月 1.62、火星 3.71、木星 24.79 m/s² など) | NASA Goddard Space Flight Center「Planetary Fact Sheet」 https://nssdc.gsfc.nasa.gov/planetary/factsheet/ (米国政府の著作物) |
| 標準重力加速度 9.80665 m/s² | 国際度量衡総会(1901)/ BIPM「SI Brochure」第9版 |
| 教科書で使う重力加速度 9.8 m/s² | 中学校理科の教科書の値 |

値は `public/js/sim2/core/constants.js` にまとめ、出典をコメントに書いています。
