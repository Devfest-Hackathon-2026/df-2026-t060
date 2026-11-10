# Bluetooth 教室(Chromebook ⇔ 先生PC を、Bluetooth でつなぐ)

学校のネットが不安定・Wi-Fi の通信が止められている教室でも、**先生PCと児童の Chromebook を Bluetooth でつないで**、教材の配信・質問・返事ができます。
先生の画面は `http://localhost:8787/teacher.html?relay`、児童の画面は、先生の画面に出るリンク(`https://kyoiku-hakkason.web.app/student.html?code=…&ble`)です。

```
児童の Chromebook(Chrome)              先生PC(Windows)
  student.html                            ┌ 中継アプリ relay/TeacherRelay(.NET)
  public/js/relay/transport-ble.js  ──Bluetooth LE(GATT)──▶  ・Bluetooth の「待ち受け役」。バイトを運ぶだけ
                                          │      │ 127.0.0.1 の TCP(行区切りの JSON)
                                          │      ▼
                                          └ AIサーバー server/index.js + server/relay/
                                              ・chunk の組み立て・質問の確かめ・教室のデータ(クラス・教材・質問・返事)
先生の画面 teacher.html?relay ──HTTP + SSE(同じパソコンの中)──▶  同じ教室のデータ
```

Bluetooth の「待ち受け役(ペリフェラル)」になれるのは、ブラウザではなく、ネイティブのアプリだけです。そのため、先生PCに小さな中継アプリが要ります。
(ブラウザの Web Bluetooth は、「つなぎに行く側(セントラル)」にしかなれません。)

## 2つの使い方

| | **併用**(おすすめ):先生はオンライン、児童はオンラインでも Bluetooth でも | **Bluetooth だけ**:先生もオフライン |
|---|---|---|
| 先生の画面 | `http://localhost:8787/teacher.html`(ふつうの先生の画面。**Google ログイン**) | `http://localhost:8787/teacher.html?relay`(ログインなし) |
| 教室のデータ | Firestore(クラウド)+ 先生PCの Bluetooth 教室(同じクラスコードの写し) | 先生PCの中だけ |
| 児童のリンク | **同じリンク**(ふつうのオンラインのリンク)。児童は、まずオンラインでクラスに入り、そのあとクラスの画面の「Bluetooth」欄で「Bluetooth で先生のパソコンにつなぐ」を押す(つながると、緑の「つながっています」が出る) | `…&ble` つきのリンク(Bluetooth だけ) |
| ネットが切れたら | オンラインの児童は止まる。Bluetooth の児童は、そのまま使える | 影響なし |

### 併用のしくみ(オンライン + Bluetooth)

```
先生の画面(localhost:8787。Google ログイン)
  ├ 配信 → Firestore と、先生PCの Bluetooth 教室の両方へ(同じ教材 id。二重に出ない)
  ├ 質問 → オンラインの児童(Firestore)と Bluetooth の児童(先生PC)を、1つの一覧に合わせて表示(Bluetooth の児童の質問には「Bluetooth」の印)
  └ 返事 → 宛先の児童の側へ(Bluetooth の児童は uid が ble- で始まる)
児童 ─ ふつうはオンライン。まずオンラインで入り(クラスコード + 出席番号)、そのあとクラスの画面の「Bluetooth」欄でつなぐ。ネットにまったくつながらないときだけ、入る前に Bluetooth でつなぐ(オンラインに10秒つながらなければ、自動で勧める)。つながっているあいだ、質問は Bluetooth で送り、教材と先生の返事は両方から受けてまとめる
```

- 先生は、**ふつうの先生の画面を、先生PCの `http://localhost:8787/teacher.html` から開く**だけです(クラスを開くと、同じクラスコードの Bluetooth 教室が、自動でできます。前に作ったクラスの教材も、写ります)。画面に「Bluetoothも使えます:つながっている児童の端末 n 台」と出ます。
- 先生PCの**中継アプリ**(下の手順 2)が動いていなくても、オンラインはこれまでどおり動きます。「オンラインだけで使っています。Bluetooth は使えません」と出て、**授業の途中で中継アプリを起動すると、15秒以内に自動でつながります**。
- 公開の画面(`https://kyoiku-hakkason.web.app/teacher.html`)から開いたときは、オンラインだけです(Bluetooth は、先生PCの中とつなぐので)。画面に、先生PCの画面を開くよう案内が出ます。
- 配信のとき、片方だけ失敗したら(ネットが切れた・中継アプリが止まっている)、成功した側には届き、画面に知らせます。
- **Bluetooth の児童の質問は、先生PCにだけ保存されます**(Firestore には入りません)。別のパソコンで先生の画面を開くと、その質問は見えません。

## ふつうの教室(Firebase)とのちがい(Bluetooth だけの場合)

| | Bluetooth 教室 | ふつうの教室(Firebase) |
|---|---|---|
| 教材の配信・質問・返事 | ○ | ○ |
| 教室のデータ | 先生PCの中(`server/data/relay-rooms.json`) | Firestore(クラウド) |
| 先生のログイン | いらない(先生PC自身) | Google ログイン |
| AI(教材の案づくり) | ○ 先生PCの Ollama(ネットがなくても動く) | ○ 先生PC か Cloud Run |
| 児童の端末が切れたとき | 質問は端末に積まれ、つながったら届く。届いた教材は見られる | 同じ |
| 同時にいくつの端末? | 先生PCの Bluetooth 次第(目安 数台〜十数台)。サーバーの上限は 60 台 | 制限なし |
| 速さ | 教材 1つ(数十KB)は数秒〜十数秒 | 速い |

## 使うもの

- **先生PC**:Windows 10(1903 以降)か Windows 11。**Bluetooth LE の「待ち受け役」に対応した Bluetooth**(Bluetooth 4.0 以降。対応していないパソコンもあります。その場合、中継アプリが理由を表示します)。
  Node.js 22 以上、.NET 10 SDK(中継アプリをビルド・実行するため)。Ollama(AIを使うなら)。
- **児童の端末**:Chromebook などの **Chrome / Edge**(Web Bluetooth が使えるもの)。Safari・Firefox・iPhone は、Web Bluetooth に対応していないので使えません。
- 児童の画面は **https のページ**(公開の Firebase Hosting)から開きます。Web Bluetooth は https(か localhost)でだけ動きます。

## 手順

### 先生PCで(授業の前に)

PowerShell を2つ開きます。

1. **AIサーバー**(教室のデータも、これが持ちます)

   ```powershell
   cd C:\dev\hakkason\server
   npm.cmd start
   ```
   `Bluetooth 教室:先生の画面は http://localhost:8787/teacher.html?relay` と出ればよい。(中継アプリとの口は、ふつう `127.0.0.1:8788`。)

2. **中継アプリ**(Bluetooth の待ち受け)

   ```powershell
   cd C:\dev\hakkason\relay\TeacherRelay
   dotnet run -c Release
   ```
   `Bluetooth の広告:Started` と `Node サーバーにつながりました` が出れば、待ち受けが始まっています。

   - 「Bluetooth のサービスを作れませんでした」と出たら、その下の説明のとおり:Bluetooth をオンにする、または、対応した Bluetooth(USB アダプターなど)を使う。
   - 先生のパソコンの Bluetooth の設定で、「ほかのデバイスから見つけられる」状態にしておく。

3. **先生の画面**を、ブラウザで開く(**併用**なら `http://localhost:8787/teacher.html`、Bluetooth だけなら `…/teacher.html?relay`):`http://localhost:8787/teacher.html?relay`
   (ログインはいりません。画面の上に「Bluetooth教室(先生PCの中)」と出ます。)
   「クラスをつくる」→ 学年を選ぶ → クラスコードが出ます。
   画面の「児童用ページ」のリンク(`https://kyoiku-hakkason.web.app/student.html?code=…&ble`)を、児童に伝えます。
   「Bluetooth:つながっている児童の端末 n 台」で、つながった数が見えます。

### 児童の Chromebook で

1. 先生が伝えたリンクを開く(クラスコードは入っています。**最初のページの読みこみには、ネットが要ります**。下の「できないこと」を見てください)。
2. 「**Bluetooth で先生のパソコンにつなぐ**」を押す → 出てきた一覧から**先生のパソコンを選ぶ**。
   (一覧に出る名前は、先生のパソコンの Bluetooth の名前です。)
3. 「つながりました」と出たら、出席番号を入れて「入る」。
4. 教材が届きます。質問・返事も、Bluetooth で届きます。切れたら自動でつなぎなおします(つなぎなおすまでの質問は、端末に残ります)。
   画面の右上は、「Bluetoothでつながっています」になります。

## 守っていること

- 中継アプリとサーバーの口(`127.0.0.1:8788`)は、**同じパソコンの中だけ**。
- 先生の画面の口(`/relay/…`)は、**先生PC自身の localhost の画面だけ**(接続元・Host・Origin を確かめる)。ほかのサイトのページが、先生PCの教室を触ることはできません。
- 児童の端末にできるのは、クラスコードの確認・教材を見る・自分あての返事を見る・質問を送る、**だけ**。教材の配信・質問を読む・先生の操作は、断ります(テスト済み)。
- 質問は、Firestore のルールと同じ条件(出席番号 1〜60、200字まで…)で確かめ、続けて送りすぎる端末は止めます(1.5秒に1つ・1端末 100 問まで)。
- 返事は、宛先の端末の番号(ランダムな長い文字列)を知っている端末にしか届きません。
- **サーバーのログに、質問の文は残しません**(テスト済み)。
- Cloud Run では、Bluetooth 教室は動きません(先生PCのものです)。

## 個人情報について

教室のデータ(クラス・教材・**児童の質問の文**)は、先生PCの `server/data/relay-rooms.json` に保存されます(再起動しても残るように)。
Git には入りません(`server/data/` は無視)。**授業が終わって、もう要らなくなったら、先生が、このファイルを消してください**(消すと、Bluetooth 教室のクラスが全部なくなります)。サーバーを止めてから消すこと。

## うまくいかないとき

| 症状 | 原因と直し方 |
|---|---|
| 児童の画面に「Bluetooth で先生のパソコンにつなぐ」が出ない | リンクに `ble` がついていない(先生の画面のリンクを使う)。または、前に入ったクラスが Bluetooth でない |
| 「この端末では Bluetooth でつなげません」 | Chrome / Edge ではない、または https でないページ。Chromebook の Chrome で、公開のアドレスを開く |
| 機器の一覧に、先生のパソコンが出ない | ①中継アプリが動いているか(`Bluetooth の広告:Started`)②先生のパソコンの Bluetooth がオンか③近づく(数メートル以内)④Chromebook の Bluetooth がオンか ⑤中継アプリを入れ直して、もう一度押す |
| 一覧に出るが、「つなげませんでした」 | Windows が、同時にたくさんの接続を受けつけていないかもしれない。中継アプリを再起動し、1台ずつつなぐ |
| つながるが、教材が届かない | 先生の画面の「Bluetooth:つながっている…台」が 0 でないか確かめる。サーバーと中継アプリの両方のウィンドウのメッセージを見る(`中継アプリがつながりました` が出ているか) |
| 教材の届くのが遅い | Bluetooth は、Wi-Fi より遅い。画像・大きな部品のある教材は、数十秒かかることがある。近づく、台数を減らす |
| 「Node サーバーにつながりません」(中継アプリ) | AIサーバー(`npm.cmd start`)が動いていない。または、口の番号がちがう(`--port 8788`) |
| 「先生のパソコンから返事がありません」 | 先生PCが忙しい、または電波が弱い。近づいて、もう一度 |

## できないこと・まだ確かめていないこと

- **最初の児童の画面の読みこみには、ネットが要ります**(公開のページ `student.html` を開くため)。ページそのものを、ネットなしで開く仕組み(Service Worker など)は、まだありません。教室の Wi-Fi が「ネットにはつながるが、不安定・Firestore の通信が止められている」ような場合に向いています。
- **本物の Chromebook と、本物の Bluetooth では、まだ確かめていません。** 次のことは、自動テストで確かめてあります:
  - Web Bluetooth の使い方の手順(機器の選択 → GATT 接続 → サービス・特性 → 通知)を、偽の Bluetooth で。
  - 分割・組み立て・つなぎなおし・質問の積みおき・教材のキャッシュ。
  - 中継アプリのかわりの TCP の相手を使った、サーバー側の一連の動き。
  - 中継アプリが、このパソコンで起動して、Bluetooth の広告(待ち受け)を始め、Node サーバーにつながること。

  **確かめていない**のは、実際の Chromebook からの接続です(1台の Windows パソコンは、自分自身の広告にはつなげないため、ここでは試せませんでした)。通知の大きさ(MTU)・書きこみの方式・同時接続の数などは、機器によって動きがちがうかもしれません。**最初に、先生PC1台・Chromebook 1台で、ためしてください。**
- 先生の画面は、Bluetooth 教室では**先生PC自身でしか開けません**(`localhost`)。
- 児童の端末の一覧に出る名前は、Windows の Bluetooth の名前です(中継アプリで変えられません)。
- 児童の端末のブラウザを閉じると、前の接続は切れます。開きなおしたら、クラスの画面の「Bluetooth」欄で、もう一度つなぎます(Web Bluetooth は、ボタンを押したときでないと、機器を選べないため)。

## 取り決め(開発する人向け)

`public/js/relay/protocol.js` に、UUID と、メッセージを小さく分ける形式があります(中継アプリの C# も、同じ UUID にする。`tests/relay-app.test.js` が見張る)。

- GATT サービス:`6c2f0001-8a4e-4b1d-9d3a-7f5e2c1b0a90`
  - RX `…0002…`(Write / WriteWithoutResponse):児童 → 先生PC。chunk を「応答あり」で書く(180 バイトまで)
  - TX `…0003…`(Notify):先生PC → 児童。chunk を通知する(中継アプリが知らせる、1回の通知の大きさに合わせて分ける)
- chunk:`[メッセージ番号 u16][何番目か u16][フラグ u8(bit0:最後)][中身…]`(little endian、ヘッダ 5 バイト)。メッセージは UTF-8 の JSON 1つ(上限 256KB)
- メッセージ:児童 → `{id, op, …}`(`ping`・`getClass`・`watchMaterials`・`watchReplies`・`unwatch`・`sendQuestion`)/ 先生PC → `{id, ok, result|error}` と、`{push:'materials'|'replies', code, seq, part, parts, list}`(長い一覧は part/parts に分ける)
- 中継アプリ ⇔ サーバー(TCP、行区切りの JSON):`hello`・`open{s,mtu}`・`rx{s,b}`・`close{s}`(アプリ → サーバー)、`tx{s,b}`(サーバー → アプリ)。b は base64

## テスト

- `node --test tests/relay-core.test.js tests/relay-transport.test.js tests/relay-server.test.js tests/relay-app.test.js tests/relay-hybrid.test.js`
- `node tools/browser-check.mjs ble-student ble-fallback relay-teacher relay-hybrid student-demo`(実ブラウザ。児童の画面・オンラインから Bluetooth への切りかえ・先生の画面(Bluetooth だけ / 併用)・ふつうの経路)
- 中継アプリのビルド:`cd relay\TeacherRelay; dotnet build -c Release`
