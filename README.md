# hakkason — クラスで育つ教材

ハッカソンの製作。先生が配信した教材が児童の端末にリアルタイムで届き、児童の「先生に聞く」が先生画面に届く通信部分です。
対象は**小学校高学年(小5・小6)から中学生(中1〜中3)**。学年ごとの単元は表示に使うが、関係のある内容の先取りは制限しない。

## サイトのURL(生徒役の方へ)

- **児童の画面:https://kyoiku-hakkason.web.app/student.html**
  1. 上のURLをブラウザ(Chrome・Edge・Safari)で開く
  2. 先生(開発者)から聞いた「クラスのコード」と、自分の座席の番号を入れて入る
  3. 先生が配信した教材(シミュレーション)が出る。条件のスライダーを動かして、予想 → 実験 → 結果をためす
  4. わからないことは「先生に聞く」から送る(AIが答え、先生にも届く)
- 先生の画面(`teacher.html`)は、先生のPCのAIサーバー(`localhost:8787`)から開くので、生徒役の方は使わない。
- 教材は、先生が配信したときだけ届く。何も出ないときは、先生に配信してもらってから、ページを開き直す。
- 質問の文は、サーバーのログに残さない。個人の名前や学校名は書かないでください(テスト用です)。

## 新しい作り(sim2):AIは設定だけ、計算と絵は確かめ済みのテンプレート

`public/js/sim2/`。AI(Gemma)はプログラムを書かず、**設定(config)か、その差分(JSON Patch)だけ**を出す。

| 層 | 中身 |
|---|---|
| config | `{ system, curriculum: { grade, unit }, params, render, controls }`。JSON Schema で確かめてから使う(`core/schema.js`) |
| engine | 状態 y と dy/dt(系)と、積分器(速度ベルレ・RK4・後退オイラー・解析解)を分ける。決まった刻み Δt で進め、絵とは切りはなす(`core/engine.js`) |
| renderer | 2D(Canvas)。暗い表示・Space Mono・エネルギーの棒グラフ・実スケール/誇張表示。端末の速さで画質を自動調整 |
| validator | エネルギーの保存・理論値とのずれを毎フレーム見張り、こえたら警告(`core/monitor.js`、系ごとの `validator.js`) |

- 系(`systems/`):単振り子(小5・中3)・斜面と記録タイマー(中3)・ジェットコースター(中3)・凸レンズの像(中1)・直流回路(中2)。足し方は `ADD_SYSTEM.md`。
- 先生の画面:「要望から作る」「要望で直す」→ まずAIなしで読む(`core/intent.js`)→ 読めないときだけ Gemma → 形と物理を確かめ → 変更前後をならべ、「適用」で反映。版の履歴・元に戻す・保存・JSON の書き出し/読みこみ。
- 児童:小学生はふりがな・数式なし、「予想 → 実験 → 結果」(表と CSV)。大きいボタン・スライダー。
- サーバー:`/api/classify` `/api/generate` `/api/edit` `/api/editlog`。適用した「要望 → 差分」は `server/data/edits.jsonl` にため、`node tools/export-lora.mjs` で学習用の形に書き出せる(学習はまだしない)。
- 評価:`node eval/run.mjs [--ai]`(要望100件。正答率・形が合う割合・物理の確かめ・応答時間。`eval/history/` に残る)。
- ライセンス:`LICENSES.md`。

### 児童の「実験助手」(端末の小さいAI)
- 児童がことばで条件を変える(「ひもをながくして」「月でやったら?」「重さでかわるかくらべたい」「なんで?」)。
- 端末のAI(Gemma 4 E2B)は、変更の内容の JSON(set・preset・compare・explain・reset・unknown)だけを出す。
  2倍などの計算・範囲(「3mまでだよ」)・プリセットの値(NASA の重力・乾電池 1.5 V)・説明の文(確かめ済み)は、すべてアプリが行う(`core/assistant.js` `core/presets.js` `core/explain.js`)。
- まずAIなし(ことばの照らし合わせ)で読み、読めないときだけAIにたのむ。モデルが読みこめない端末では、ことばとスライダーだけで使える。
- 指示(システムプロンプト)は系・学年ごとに自動で作る(500 トークン以内)。評価:`node eval/run-student.mjs local|hybrid <モデル>`(児童らしい要望50件)。

### 部品(先生用・テンプレートでできないとき)
- Gemma 12B が書くのは「部品」の関数だけ:力の式 `force(state, t, params)`、時系列の分析 `analyze(series)`、実験データの分析 `analyzeCsv(rows)`(`server/ext/`)。
- 閉じた場所で動かす:サーバーは Node の権限モデル(ファイル・ネット・プロセス禁止)+ vm(Math と引数だけ、eval 禁止)、1秒・64MB まで。児童の端末は、通信を禁止した枠(iframe)の中の Web Worker で、1秒で止める(`core/ext-runtime.js`)。
- テスト(形・有限の数・単位・保存量・力と位置エネルギーの坂・答えがわかっているデータ)→ だめなら理由を返して直させる(最大3回)→ それでもだめならテンプレートの代わりの案。
- テストを通ったものは「承認待ち」。先生が要約・テスト・コード・試しの表示を見て承認したものだけ、教材(`config.ext`)と本棚(`systems/<系>/extensions/`)に入る。評価:`node eval/run-ext.mjs`(20件)。

### AIを速く:llama.cpp(試したが、ふつうは Ollama を使う)
- `server/start-llamacpp.ps1` で llama.cpp を起動し、`LLM_BACKEND=llamacpp LLM_BASE_URL=http://127.0.0.1:8090` で切りかえられる。
- 短い答え(分類・差分)は速い(評価セットの平均 1.06 → 0.48 秒、型を選んだサンプル 74 → 43 秒)。
- しかし長い JSON(シミュレーションのプログラム)は、出力の形をしばる処理が重く、Ollama の半分の速さ(5 対 10 トークン毎秒)。
  「AIが新しく作る」サンプルが 14 分かかったので、**ふつうは Ollama**(切りかえない)にする。
- 下書き用モデルでの高速化は、gemma3:1b とは語彙の方式がちがって使えず、くり返し予想(ngram)は効かなかった。
- Ollama と llama.cpp は、GPU のメモリが足りず同時には使えない。
## シミュレーション(力学)

| 種類 | 単元 | 児童が変えられる条件(先生が選ぶ) | 調べること |
|---|---|---|---|
| 振り子 | 小5 振り子の運動 | ひもの長さ・おもりの重さ・ふれはば | 1往復する時間 |
| てこ | 小6 てこのはたらき | 左右のおもりの数と位置 | つり合うか |
| ばね | 中1 力のはたらき | つるす質量・ばねのかたさ | 力とのび(グラフに記録) |
| 斜面を下る台車 | 中3 運動の規則性 | 斜面の角度・台車の質量 | 0.1秒ごとのきょり・速さ |

- 先生は「教材をつくって配信」で、種類・児童が変えられる条件・はじめの値・めあて・数値を見せるかを決め、その場で動かして確かめられる。AIの案も同じ形で入る。
- 表示する数値は公式から出さず、動きを計算(振り子は RK4)して計る。正しさは `tests/sims.test.js` で教科書の式・理論値とくらべる。
- 条件の一覧は `public/js/sim-catalog.js`(画面と AIサーバーで共通)、物理は `sim-physics.js`、画面は `sims.js`、先生の編集欄は `sim-editor.js`。
- 4種類で確かめられない質問(重力・落下・音など)は、先生の側の Gemma 4 12B が **JavaScript でシミュレーションを作る**(`type: 'custom'`)。
  - 決まった4つの関数(init / step / draw / readouts)だけを書かせ、`checkSimCode` で使ってはいけないもの(fetch・eval・localStorage など)を断る。
  - `sim-custom.js` の `<iframe sandbox="allow-scripts">` と CSP(`default-src 'none'`)の中だけで動かす。ページ本体・ログイン情報・保存データ・ネットにはさわれない(わざと試して、すべて止まることを確かめた)。
  - 結果をプログラムで計って確かめられないので、先生が動かしてプログラムを読んで確かめてから配信する。試し方:`node server/try-custom-sim.js`
- **部品とお手本で組み立てる**(AIが一から書くと、絵が小さい・重力の向きが逆、などのまちがいが多かったため)
  - 部品 `K`(`public/js/sim-kit.js`):球・円・線・矢印・四角・ばね・地面・目もり・軌跡・文字と、落下(空気のていこう)・はね返り・引力(何個でも)・衝突・1周の数え方。
    `K.view` で本当の大きさ(m・AU)の範囲を決めると、画面いっぱいに自動で合わせる。枠の中で、AIのプログラムより先に読みこむ。
  - お手本(`server/sim-library/`):公転・ななめ投げ・衝突・はね返り・パラシュート・連星。どれも計った値が公式と2%以内(`tests/sim-kit.test.js`)。
    質問に似たものを2つ選んでAIに見せ、似ている部分は流用させる。先生の画面で「計算を確かめたら全部○」だったものは、自動でお手本に加わる(`learned/`、リポジトリには入れない)。
  - サーバーで確かめてから返す(`server/sim-check.js`):条件を変えて最後まで動かし、計った値と公式をくらべる。×・終わらない・エラーは、理由をつけてAIに書き直させる(3回まで)。
    AIのプログラムは別プロセスの Node で、権限モデル(`--permission`)でファイル・ネット・プロセス起動を禁止し、文字列からのプログラム作成も禁止して動かす(`tests/sim-check.test.js`)。
  - 試し方:`node server/try-kit-sim.js 出力.json "質問"`
- **myPhysicsLab**(Erik Neumann、Apache License 2.0)のシミュレーションも使える(`type: 'mpl'`):ふりこ・ばねとおもり・ニュートンのゆりかご・ジェットコースター。
  - `node tools/build-mpl.mjs C:\dev\myphysicslab`(ソースは `git clone https://github.com/myphysicslab/myphysicslab`)で、使うファイルだけを TypeScript から JavaScript に直して `public/mpl/` に置く(道具の追加インストールなし。Node の型を消す機能を使う)。
  - 英語の操作パネルはかくし、日本語のスライダーから条件の名前と数だけを送る(`mpl/view.js`)。myPhysicsLab は URL の `?` のあとをスクリプトとして実行するので、設定は `#` のあとでわたす。
  - 一覧と日本語の名前・範囲は `public/js/mpl-catalog.js`。先生の編集欄・AIの案の両方から選べる。

## 構成

| ファイル | 役割 |
|---|---|
| `public/teacher.html` / `js/teacher.js` | 先生画面：クラス作成、教材配信、質問の受信、AIで質問をまとめて教材の案をつくる |
| `public/student.html` / `js/student.js` | 児童画面：クラス参加、教材の受信と表示、質問送信、「わからないときは」 |
| `public/js/student-ai-prompt.js` | 児童のAIまわり：教材から答えの文を探す(AIなし)、AIへの指示、AIの文の検査 |
| `public/js/student-ai.js` | 児童の端末の中で動くAI(WebLLM。Gemma 4 E2B) |
| `public/js/transport.js` | 通信層（Firebase 版 / デモ版） |
| `public/js/common.js` | 共通部品 |
| `public/js/sim-*.js` / `sims.js` | シミュレーション(条件の一覧・物理・画面・先生の編集欄) |
| `tests/sims.test.js` | シミュレーションの物理のテスト(`node --test tests/sims.test.js`) |
| `server/` | 先生の側のAIサーバー(質問のまとめ・教材の案。Ollama 経由) |
| `firestore.rules` | Firestore のセキュリティルール |
| `docs/student-ai.md` | 児童の端末のAIで試したことと、決めたこと |

### 先生の側のAIを動かす(先生PC)

```bash
ollama pull gemma4:12b        # 先生の側のAI(約8GB)。先生の側は Gemma 4 12B だけで動かす
cd server
npm install
npm start                     # http://localhost:8787
```

**先生PCでは `http://localhost:8787/teacher.html` を開く**(AIサーバーが先生の画面も配る)。
`https://kyoiku-hakkason.web.app/teacher.html` から先生PCのAIサーバー(localhost)を呼ぶと、Edge/Chrome の「ローカル ネットワーク アクセス」の許可が要り、許可しないと「AIサーバーにつながりません」になる。
localhost で開くと、ブラウザが別のサイトとして扱うので、クラスは localhost の画面で作り直す。

先生画面の「届いた質問」で、チェックした質問を「AIでまとめる」→「この問いで教材の案をつくる」。案は配信の入力欄に入るので、直してから配信する。配信すると、もとの質問は「対応済み」になる。
モデルを変えるときは `LLM_MODEL`、Ollama の場所を変えるときは `LLM_BASE_URL`(環境変数)。

### データの形（Firestore）

```
classes/{クラスコード}            { name, teacherUid(Google ログインの uid), createdAt, grade?(5〜9:小5〜中3) }
  materials/{id}                 { title, explanation, sim, quiz[], publishedAt }
  questions/{id}                 { seat, text, status: "new"|"done", createdAt }
```

- 児童は匿名ログイン＋出席番号のみ。名前・メールは扱わない
- 先生は Google ログイン(`docs/google-login.md`)。クラスは先生の Google アカウントにつくので、別のブラウザでも開ける
- 一度届いた教材は端末にキャッシュされ、オフラインでも開ける
- オフライン中の質問は端末に積まれ、つながった時に自動で送られる
- 画面は `transport.js` のインターフェースだけを使うので、Web Bluetooth 中継版を後から同じ形で追加できる

## まず試す（デモモード・設定不要）

```bash
cd public
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000/teacher.html` を開いてクラスを作り、表示された「児童用ページ」を別タブで開く。同じブラウザのタブ同士でつながります。

## Firebase につなぐ

1. Firebase コンソールでプロジェクトを作成
2. 「Authentication」で **匿名** ログインを有効化
3. 「Firestore Database」を作成
4. ウェブアプリを追加し、表示された設定を `public/js/config.js` の `firebaseConfig` に貼る
5. デプロイ

```bash
npm i -g firebase-tools
firebase login
firebase use --add            # 作ったプロジェクトを選ぶ
firebase deploy --only hosting,firestore:rules
```

## ルールのテスト

`firestore.rules` を変えたら、デプロイする前に実行します。Firestore エミュレーターを使うので、Java 21 以上が必要です。

```bash
npm install
npm test
```

確かめていること:質問は先生にだけリアルタイムで届く/児童は質問を読めない/おかしな質問(出席番号の範囲外、201字以上、名前つきなど)は送れない/ないクラスには送れない/クラスの一覧は取れない/教材を配信できるのは先生だけ。

## 今後

- ~~先生のログインを匿名から Google ログインに変える~~ → 実装した(`docs/google-login.md`。Firebase コンソールで Google を有効にして、ルールと画面を公開すると使える)
- ~~質問のまとめ → Cloud Run 上の Gemma で教材案を作る流れとつなぐ~~ → つなぐところまで実装した(`docs/cloudrun.md`。**コンテナのビルド・Cloud Run へのデプロイ・GPU で Gemma が動くことは、まだ確かめていない**)
- ~~Web Bluetooth（Chromebook ⇔ 先生PC）の中継版 transport~~ → 実装した(`docs/bluetooth-relay.md`・`public/js/relay/`・`server/relay/`・`relay/TeacherRelay/`)。**本物の Chromebook とは、まだ確かめていない**


## AIのモデルを先生の画面からダウンロードする(先生PC)

先生の画面の上の「AI:…」を押す → 「AIのモデル(先生PC)」で、ボタンを押すと Ollama にダウンロードさせます(`server/models.js`)。

- **Gemma 4 12B がダウンロードずみなら、何もしません。**
- なければ 12B をダウンロード。**できなければ Gemma 4 E4B** をダウンロードして、そちらで動かします(E4B がすでにあれば、ダウンロードしません)。
- 起動のとき、12B がなく E4B があれば、E4B で動かします(`LLM_MODEL` を決めていれば、それを守ります)。
- ダウンロードを始められるのは、そのクラスの先生だけ(Google ログイン、または先生PCのBluetooth教室)。Cloud Run では使いません(Ollama 側にモデルを入れます)。
- 状態は `GET /api/models`、ダウンロードは `POST /api/models/ensure`。テストは `tests/server-models.test.js`。
