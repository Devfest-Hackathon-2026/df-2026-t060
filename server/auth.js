// AIサーバーを使ってよい先生かどうかの判断(Firebase の ID トークンの中身を見る。署名の確認は index.js の jose が先にやる)。
//   1. Google でログインしている(トークンの firebase.identities に google.com がある)。匿名ログイン(児童)は使えない
//   2. TEACHER_EMAILS / TEACHER_DOMAINS が決めてあるときは、そのメール・ドメインの人だけ(Cloud Run に置いたとき、
//      だれでも Google アカウントさえあればAIを使える、という状態にしないため)。どちらも決めていなければ制限しない(先生PCで動かすとき)。
//   TEACHER_EMAILS=a@example.com,b@example.com   TEACHER_DOMAINS=school.ed.jp,example.org

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const list = (v) => String(v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** @returns {{emails: string[], domains: string[]}} */
export function readAllowList(env = process.env) {
  return { emails: list(env.TEACHER_EMAILS), domains: list(env.TEACHER_DOMAINS).map((d) => d.replace(/^@/, '')) };
}

/**
 * @param {object} payload  検証ずみの ID トークンの中身
 * @param {{emails: string[], domains: string[]}} [allow]
 * @returns {{uid: string, email: string|null}}  使ってよいとき。だめなら AuthError
 */
export function checkTeacherClaims(payload, allow = readAllowList()) {
  const identities = payload?.firebase?.identities;
  if (!identities || !identities['google.com']) {
    throw new AuthError(401, '先生は Google でログインしてください(先生の画面を読みこみ直して、「Google でログイン」を押してください)');
  }
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  if (allow.emails.length || allow.domains.length) {
    // メールが確かめられていない(email_verified でない)ものは、制限に使わない
    const ok = email && payload.email_verified === true
      && (allow.emails.includes(email) || allow.domains.includes(email.split('@')[1]));
    if (!ok) throw new AuthError(403, 'このアカウントは、AIの利用を許可されていません(学校・管理者に、許可するメールアドレスの登録を頼んでください)');
  }
  return { uid: String(payload.sub), email };
}
