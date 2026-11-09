// 先生のログイン(Google)の判断。DOM も Firebase も使わない(Node でテストできる)。
//   児童:匿名ログイン(名前・メールを使わない)  先生:Google ログイン(別のブラウザ・別のパソコンでも、自分のクラスを見つけられる)
//   前の作りでは、先生も匿名ログインだった(権限がブラウザに紐づく)。そのクラスは、Google を同じアカウントにひもづけて(link)引き継ぐ。

/** ログインしている人の種類:'none'(ログインなし)/'google'(Google ログイン済み)/'legacy'(匿名ログインのまま。前の作りの先生か児童)/'other' */
export function classifyUser(user) {
  if (!user) return 'none';
  if ((user.providerData ?? []).some((p) => p?.providerId === 'google.com')) return 'google';
  return user.isAnonymous ? 'legacy' : 'other';
}

/** ログインの進め方:匿名のアカウントがあれば、Google をひもづける(uid が変わらないので、前のクラスをそのまま引き継げる) */
export function loginPlan(user) {
  const kind = classifyUser(user);
  if (kind === 'google') return 'already';
  return kind === 'legacy' ? 'link' : 'popup';
}

/** Firebase のエラーコード → 先生に見せる文(コードのままは見せない) */
export function authErrorMessage(err) {
  const code = String(err?.code ?? '');
  const table = {
    'auth/popup-blocked': 'ログインの小さい画面(ポップアップ)がブラウザに止められました。アドレス欄の右にある「ポップアップをブロック」を許可して、もう一度押してください。',
    'auth/popup-closed-by-user': 'ログインの画面が閉じられました。もう一度「Google でログイン」を押してください。',
    'auth/cancelled-popup-request': 'ログインの画面が重なりました。もう一度「Google でログイン」を押してください。',
    'auth/network-request-failed': 'ネットワークにつながりません。つながってから、もう一度ためしてください。',
    'auth/operation-not-allowed': 'このアプリでは、まだ Google ログインが使えるようになっていません。Firebase コンソールの「Authentication → ログイン方法」で Google を有効にしてください。',
    'auth/unauthorized-domain': 'このページのアドレスは、Google ログインを許可されていません。Firebase コンソールの「Authentication → 設定 → 承認済みドメイン」に追加してください。',
    'auth/web-storage-unsupported': 'このブラウザでは、ログインの情報を保存できません(プライベートモードなど)。通常のウィンドウで開いてください。',
  };
  return table[code] ?? `ログインできませんでした(${code || String(err?.message ?? err).slice(0, 80)})`;
}

/**
 * このブラウザに覚えているクラスを、そのまま開いてよいか。
 * 自分のクラスの一覧(mine)にあるものだけ開く(別の先生がログインしていたら、開かない)。
 * 一覧が取れないとき(null)は、クラスの teacherUid が自分かどうかで決める(getClass の mine)。
 */
export function pickSavedClass(saved, mine, savedIsMine = false) {
  if (!saved?.code) return null;
  if (Array.isArray(mine)) return mine.some((c) => c.code === saved.code) ? saved : null;
  return savedIsMine ? saved : null;
}

/** 先生の表示名:名前があれば名前、なければメールの @ の前(メール全体は画面に出さない) */
export function teacherLabel(user) {
  if (!user) return '';
  return user.displayName || String(user.email ?? '').split('@')[0] || 'Google アカウント';
}
