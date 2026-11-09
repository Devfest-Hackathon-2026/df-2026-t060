# AIサーバーを Cloud Run で動かす(先生PCがなくても、教材の案づくりができる)

先生の画面の「質問のまとめ → 教材の案づくり」は、AI(Gemma 4 12B)が動くサーバーを呼びます。
ふつうは**先生のPC**(Ollama + `server/` の `npm start`)で動かしますが、Cloud Run に載せると、**GPU のないパソコン・Chromebook の先生**でも、同じ流れが使えます。

```
先生の画面(Firebase Hosting)  ──(Googleログインのトークン)──▶  Cloud Run
  質問をまとめる / 教材の案をつくる                              ├─ app コンテナ:server/index.js(ログインの確認・質問の整理・シミュレーションの確かめ)
                                                                 └─ ollama コンテナ:Gemma 4 12B(GPU: L4)  ※ 同じ場所(127.0.0.1:11434)でつなぐ
```

AIは、これまでと同じ決まりで動きます(JSON だけを出す・コードは閉じた場所でだけ動かす・先生が確かめて配信する)。変わるのは、動かす場所だけです。

## ここでできたこと / できていないこと

| | |
|---|---|
| ✔ サーバーの対応 | `/ready`(AIまで使えるか)・停止の合図・ログに質問の文を残さない・先生のログイン(Google)の確認と、使える先生の制限 |
| ✔ 実際に起動して確かめた | 偽の Google・偽の Ollama をつないで本物のサーバーを起動:ログイン・制限・CORS・`/ready`・ログ(`tests/server-cloudrun.test.js`) |
| ✔ 先生の画面 | 「AI」の表示から、つなぎ先(先生PC / Cloud Run)を選べる。Cloud Run が止まっているときは、起こして待つ(`tests/browser/teacher-ai.html`) |
| ✔ ファイルの用意 | Dockerfile 2つ・Cloud Build の設定・サービス定義・デプロイの script(表示だけの練習ができる) |
| ✔ コンテナと同じファイル構成で確かめた | 一時フォルダに、Dockerfile と同じものだけを入れて `npm ci --omit=dev` → 全部の部品が読みこめて、起動する |
| **✖ 確かめていない** | **コンテナのビルド(この PC に Docker がない)・Cloud Run へのデプロイ・GPU で Gemma が動くこと・起こすのにかかる時間・費用。** ここから先は、手順どおりにやって、結果を見てください |

## 費用・個人情報について(先に読む)

- **お金がかかります。** Cloud Build(ビルド)・Artifact Registry(イメージの保管。Gemma 入りで約 9GB)・Cloud Run(GPU は時間課金)。金額は、Google Cloud の最新の料金表で確かめてください。
  `minScale: 0`(使っていないときは 0 台)にしてあるので、**止まっている間は、GPU の時間の料金はかかりません**。授業の前に、先生の画面が自動で起こします(最初は数分かかります)。
- **児童の質問の文が、Google Cloud 上のAIに送られます。** 保存や学習には使わず、サーバーのログにも残しません(テストで確かめてあります)が、「児童の入力が外部のクラウドに出る」ことには変わりません。**学校・自治体のきまりと、保護者への説明を確かめてから**使ってください。先生PCで動かす場合は、児童の質問は先生の PC の外に出ません。
- **使える先生を必ず決めてください**(下の手順 3)。決めないと、Google アカウントがあればだれでもAIを使えて、費用がかかります。
- Gemma の利用条件(Gemma Terms of Use)に従ってください。

## 手順

準備(初回だけ):

1. Google Cloud のプロジェクトを決める(Firebase と同じ `kyoiku-hakkason` でよい)。**請求先アカウントを結びつける。**
2. `gcloud` を入れてログインする:`gcloud auth login`
3. **使える先生を決める**:メールアドレス(`TEACHER_EMAILS`)か、学校のドメイン(`TEACHER_DOMAINS`)。
4. 先生のログインを Google にしてある(`docs/google-login.md`)。

実行(リポジトリのいちばん上のフォルダで、PowerShell):

```powershell
# まず、何をするかを表示するだけ(実行しない)
.\deploy\cloudrun\deploy.ps1 -Project kyoiku-hakkason -Region <リージョン> -TeacherDomains school.example.ed.jp

# 内容を確かめたら、本当に実行する(費用がかかります)
.\deploy\cloudrun\deploy.ps1 -Project kyoiku-hakkason -Region <リージョン> -TeacherDomains school.example.ed.jp -Apply
```

- `<リージョン>`:Cloud Run の **GPU(L4)が使えるリージョン**を、Cloud Run のドキュメントで確かめて選ぶ。
- 実行すると、次の順に進みます:API を有効にする → イメージの置き場をつくる → AIサーバーをビルド → **Ollama(Gemma 入り)をビルド(時間がかかる)** → デプロイ → 呼び出しを許可 → サービスのアドレスを表示。
- ollama のビルドを飛ばして、あとでやり直すなら `-SkipOllamaBuild`。

### Gemma のモデルの入れ方(ここで詰まりやすい)

`deploy/cloudrun/Dockerfile.ollama` は、はじめ `ollama pull gemma4:12b` でモデルを取りこみます。
先生PCの `gemma4:12b` が、**自分で GGUF を取りこんだもの**のとき(`ollama show gemma4:12b` の parent_model がファイル名になっている)は、公開ライブラリにその名前がないかもしれません。
そのときは、`Dockerfile.ollama` の (B) のとおり、GGUF と Modelfile(`Modelfile.example`)を `deploy/cloudrun/` に置いて取りこんでください。

## 先生の画面でつなぐ

1. 手順の最後に出た `https://kyozai-ai-xxxxx.〜.run.app` を控える。
2. 先生の画面(Firebase Hosting の `teacher.html`)に Google でログインし、上の **「AI:…」の表示をクリック** → 「Cloud Run」を選び、アドレスを入れて「つなぎ先を調べる」→「この場所を使う」。
3. このブラウザに覚えます。次からは、そのまま Cloud Run を使います。表示が「AI:gemma4:12b(Cloud Run)」になれば、使えます。
4. 止まっていたときは、「AI:起こしています(1分20秒…)」と出ます。**最初は数分かかる**ので、授業の前に先生の画面を開いておくと、授業中に待たずにすみます。
   教材の案づくりを押したときに止まっていても、自動で起こして、使えるようになるまで待ちます(最長 6 分)。

先生PCにもどすときは、同じ画面で「先生PC」を選んでください。

## うまくいかないとき

| 表示・症状 | 原因と直し方 |
|---|---|
| 「AI:準備中(Cloud Run)」のまま | モデルを読みこんでいる最中(`/ready` が 503)。数分待つ。10 分たっても進まなければ、Cloud Run のログで ollama コンテナを見る(モデルが入っていない・GPU が割り当てられていない、など) |
| 「このアカウントは、AIの利用を許可されていません」(403) | `TEACHER_EMAILS` / `TEACHER_DOMAINS` に、その先生が入っていない。`deploy.ps1` を `-TeacherEmails` つきでやり直す |
| 「先生は Google でログインしてください」(401) | 先生の画面で、Google ログインをしていない(前の匿名ログインのまま)。`docs/google-login.md` |
| 「AIがいそがしいので、少し待って」(429) | 同時に3つより多く頼んだ。AIは1つずつ処理する |
| 教材の案づくりが途中で切れる | 長い生成は 5〜10 分かかる。Cloud Run のタイムアウト(`timeoutSeconds: 3600`)と、ブラウザの接続は、これで足りる想定。切れるなら、`tests/server-cloudrun.test.js` の結果と Cloud Run のログを見る |

## データの保存について

AIが作ったシミュレーションの保存・「先生が適用した要望と差分」の記録・承認待ちの部品は、サーバーのファイルに保存します。
Cloud Run は、止まるとファイルが消えます。残したいときは、Cloud Storage のバケットをマウント(Cloud Run の「ボリューム」)して、次の環境変数を向けてください:

| 環境変数 | 保存するもの |
|---|---|
| `GEN_LIBRARY_DIR` | AIが作った系(確かめ済みのシミュレーション) |
| `SIM2_DATA_DIR` | 要望 → 差分の記録(学習用。児童の質問の文は含まない) |
| `EXT_PENDING_DIR` / `EXT_PUBLIC_DIR` | 承認待ち・承認ずみの部品 |
| `SIM_LIBRARY_DIR` | 先生が確かめたシミュレーションのお手本 |

何もしなければ、保存されないだけで、動きには影響しません(止まるたびに、まっさらから始まります)。

## このサーバーが守っていること

- 呼び出しは、**Google ログインした先生**のトークンだけ(署名・発行元・期限・プロジェクトを確かめる)。児童(匿名ログイン)は使えない。
- さらに、**そのクラスの先生**だけ(クラスを読んで、`teacherUid` が自分か確かめる)。
- `TEACHER_EMAILS` / `TEACHER_DOMAINS` を決めると、その先生だけ。
- ブラウザからの呼び出しは、公開の画面(`ALLOWED_ORIGINS`)からだけ許す。
- サーバーに**秘密の鍵は置かない**(Firebase のトークンは公開の鍵で確かめる)。
- ログには、件数・かかった時間だけ。**児童の質問の文は残さない**(500 エラーのときも、AIの返事の一部を残さない。`LOG_VERBOSE=1` のときだけ詳しく出る。Cloud Run では設定しない)。
