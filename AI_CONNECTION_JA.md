# 今夜、友達の先生側と接続する

**Gemmaを入れるのはこのPCではありません。** 友達のPCですでに動いているGemmaを、友達のNodeサーバーから呼びます。生徒の画面は「根拠つきの質問」を送るだけで、Gemmaを直接呼びません。

## 3つのモードを混ぜない

| 用途 | 先生画面 | 生徒画面 | 同期する範囲 |
|---|---|---|---|
| このPCで一連の操作確認 | 8001/teacher.html?demo | 8001/student.html?demo | 同じPC・同じブラウザのタブ同士。別PCとはつながらない |
| 友達PCのGemma＋Bluetooth教室 | 友達PCの localhost:8787/teacher.html?relay | 生徒側のHTTPSまたはlocalhostの student.html?ble&code=クラスコード | 既存のWindows中継アプリとBLEを通して同期 |
| 既存のオンラインFirebase教室 | 公開したteacher.html（Googleログイン） | 公開したstudent.html | Firebase経由。Gemmaは先生PCか、別途設定済みのサーバー |

`localhost` / `127.0.0.1` は、そのURLを開いているPC自身です。**このPCで localhost:8787 を開いても、友達のGemmaにつながるわけではありません。** AIの画面は友達PCで開く構成を基本にします。

## 友達のPCで行うこと

1. この改良版を別フォルダーへ展開し、元のコードと手元のモデル・環境設定を残す。
2. すでに動いていたOllamaまたはllama.cppを、従来どおり起動する。モデルは再ダウンロードしない。
3. プロジェクトの `server` で依存を準備し、起動する。Node 22以降を使う。

```powershell
cd server
npm ci
npm start
```

元のサーバーの既定モデル名は `gemma4:12b` です。友達が使っている名前が違えば、**友達の実際のモデル名**を `LLM_MODEL` に設定してから起動します。Ollamaなら `ollama list` で手元にある名前を確認できます。元から使っている `LLM_BASE_URL` / `LLM_BACKEND` の設定があれば引き継ぎます。サーバー起動だけでモデルのインストールは始まりません。

4. 友達PCのブラウザで **http://localhost:8787/teacher.html?relay** を開き、Bluetooth教室用のクラスを作る。`?demo` のクラスとは別物。
5. 元のWindows中継アプリを起動する。ソースは `relay/TeacherRelay`。WindowsとBluetooth LE待ち受け対応機器が必要。付属プロジェクトのターゲットは `.NET 10 / Windows 10.0.19041以降`。既にビルド済みのものがあればその起動方法を使い、必要なときだけ `dotnet run --project relay/TeacherRelay` をプロジェクト直下から実行する。
6. 生徒画面を開き、Bluetooth接続ボタンから友達PCの `KyozaiRelay` を選ぶ。先生が表示している新しいクラスコードで入る。

このPCを生徒端末にする確認なら、`python start_local.py` を動かし、`http://127.0.0.1:8001/student.html?ble&code=友達のクラスコード` を開けます。Chromebookの本番試験では、新版をHTTPSで一度読み込み、オフライン保存してから使います。USBでHTMLを置いてダブルクリックする方式にはしません。

7. 生徒が実験記録と問いを送ったら、友達の先生画面の根拠カードで「先生PCのGemmaに根拠から提案させる」を押す。
8. 答え・比較案・根拠IDが届く。先生が文章と条件を確認して、教材フォームに入れて配信する。生徒で受信し、比較と次の質問まで通す。

Gemmaが止まっていたり提案が読めない場合も、**「Gemmaなしで比較案を編集」**で同じ流れを続けられます。手動ひな型とGemma出力は画面で区別しています。接続確認をデモモードで行おうとすると、先生の認証がないためAI呼び出しは使えません。

## Firebase経由にする場合

コードには元のプロジェクト設定を残しています。改良版の `public` と、**質問に `inquiryContext` を許可した `firestore.rules`** の反映が必要です。この作業では外部へのデプロイは実行していません。友達が既存のFirebase運用手順で反映し、同じプロジェクトへ接続してください。

このルールを反映しないままだと、根拠つきの質問だけ拒否される場合があります。新ルールはエミュレーターで検証済みです。既存の先生ログインと権限の条件は維持しています。

## 今夜の確認項目

- 先生PCの `/health` はサーバー稼働、`/ready` はGemmaまで利用可能かを表す。
- 送った質問に、数値条件・観察時間・モデルの版・実験IDが残る。
- AIの比較2件は、1条件だけが違う。モデル範囲外の値は適用しない。
- 先生が承認して配信する前には、生徒へAI案を自動配信しない。
- 生徒Bの実験に、生徒Aの根拠IDが残る。クラスの改訂2・3を見返せる。
- 通信を切って実験とノートが動く。再接続後の未送信質問の扱いは、元のBLE送信待ち機能で実機確認する。

## 端末の範囲

Web Bluetoothは端末とブラウザに依存します。Chromeの公式案内はChromeOS・Android・Windows・Macを対象にしており、iPadで同じ接続ができるとは扱いません。`navigator.bluetooth` がない端末には、既存の接続画面が対応していない旨を出します。iPadでの実験画面の利用と、BLEでのクラス同期は別の確認です。iPadまで含む同期を必須にするなら、Firebaseのオンライン経路、または別途iPad向け中継を用意する必要があります。

本環境では、Chromebook/iPad/友達のBluetoothアダプターを実機で試していません。日本語の発話精度・機器間の接続・友達が使うGemmaの実モデルの品質は、今夜の試験で確認してください。

公式の対応・要件の資料： https://developer.chrome.com/docs/capabilities/bluetooth
