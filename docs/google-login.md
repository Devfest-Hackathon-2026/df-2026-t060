# 先生のGoogleログイン

先生は Google アカウントでログインします(児童は、これまでどおり匿名ログイン。名前・メールは使いません)。
クラスが先生の Google アカウントにつくので、**別のブラウザ・別のパソコンでも、自分のクラスを開けます**。

## 仕組み

| 場所 | 決まり |
|---|---|
| Firestore のルール(`firestore.rules`) | クラスを作れる・管理できる(教材の配信・質問を読む・返事を書く)のは、トークンの `firebase.identities` に `google.com` がある人だけ。自分のクラスの一覧(`teacherUid == 自分`)も、その人だけ取れる |
| AIサーバー(`server/auth.js`) | 同じ条件に加えて、`TEACHER_EMAILS` / `TEACHER_DOMAINS` を決めておけば、そのメール・ドメインの人だけが使える |
| 先生の画面(`teacher.js`・`teacher-auth.js`) | ログインの画面 → 自分のクラスの一覧 → 開く。別の先生のクラスが、このブラウザに残っていても開かない |
| 児童の画面(`student.js`) | 変更なし(匿名ログイン) |

## 前のクラス(匿名で作ったもの)を引き継ぐ

前の作りでは、先生も匿名ログインでした(権限がブラウザについていました)。
**前に使っていたブラウザ**で先生の画面を開き、「Google でログイン」を押すと、匿名のアカウントに Google を**ひもづけます**(uid が変わらない)。
前のクラスは、そのまま使えます。

- ひもづけずに、別のブラウザや、すでに別のアカウントで使っている Google アカウントでログインすると、前のクラスは開けません(クラスの持ち主の uid がちがうため)。
- 引き継ぐ前に、前のクラスのクラスコードを控えておくと安心です。

## はじめにやること(あなた:Firebase の管理者)

1. **Google ログインを有効にする**:Firebase コンソール → Authentication → ログイン方法 → Google を有効にする(サポート用メールを選ぶ)。
2. **承認済みドメインを確認する**:Authentication → 設定 → 承認済みドメインに `kyoiku-hakkason.web.app`(と、試すなら `localhost`)があること。
3. **ルールを公開する**:`firebase.cmd deploy --only firestore:rules --non-interactive`
   (先に `npm test` でルールのテストが通ることを確かめる。)
4. **画面を公開する**:`firebase.cmd deploy --only hosting --non-interactive`

**順番が大事です**:ルールを先に公開すると、まだ Google でログインしていない(古い画面の)先生は、クラスを管理できなくなります。画面(hosting)とルールは、できるだけ続けて公開してください。
授業中は避けて、授業のない時間に切りかえるのがおすすめです。

## AIサーバーを使える先生を決める(Cloud Run に置くとき)

Cloud Run のAIサーバーは、URLを知っていて Google アカウントがあれば、だれでも呼べてしまいます(AIの費用がかかります)。
環境変数で、使える先生を決めてください。

```
TEACHER_EMAILS=hanako@school.ed.jp,taro@school.ed.jp
TEACHER_DOMAINS=school.ed.jp
```

どちらも決めなければ制限しません(先生PCの `localhost` で動かすときは、これでよい)。
メールは、Google が「確認ずみ」としたものだけを使います。

## 動作の確かめ

- `npm test`(ルール 17 件。Google ログイン・匿名・ひもづけ・一覧の取り方)
- `node --test tests/teacher-auth.test.js`(画面とAIサーバーの判断)
- `node tools/browser-check.mjs teacher-login`(実ブラウザで、ログイン画面 → クラスを開く → 失敗したとき)

**自動テストで確かめていないこと**:本物の Google のログイン画面(ポップアップ)を通ること。ここは、上の「はじめにやること」のあと、実際に一度ログインして確かめてください。
