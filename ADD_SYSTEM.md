# 工房のモデルを変更する

この提出版の配信対象は、`public/js/lab-scope.js` にある11モデルです。同じモデルを使う教材なら、本文と初期条件を追加するだけで作れます。

モデルそのものを広げるときは、計算と見た目を分けて実装します。

1. `public/js/sim2/systems/` に、条件の範囲、計算、観察値、例を用意する。
2. `systems/index.js` と `lab-scope.js` に登録し、`hybrid-lab.js` に工房のプリセットを置く。
3. `studio-views.js` で測定値と同じ状態から3Dの形を作り、`studio-metrics.js` に注目値と比較条件を設定する。
4. 保存済み教材を壊さないように条件の互換性を確認する。計算を変えるときは旧設定の記録を再現できるようにする。
5. 理論値との比較、A/Bの一条件比較、先生の配信、児童の追試、オフラインの読み込みを検証する。

`python tools/build-json-modules.py`（元のJSONを編集した場合）と `node tools/build-offline.mjs` で配布用のファイルを更新します。キャッシュ名は `public/inquiry-offline-sw.js` で更新します。Gemmaの出力は登録済みのモデルと条件に限ります。
