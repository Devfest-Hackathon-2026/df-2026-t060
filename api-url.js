// 先生の側のAIサーバーの場所を決める(ブラウザの部品を使わない。Node でテストできる)。
//   先生のトークンと児童の質問を送る先なので、手元(localhost)と Cloud Run(*.run.app)だけを許す。
//   どこかのサイトが、先生に「このアドレスを使って」と言って、トークンや質問を盗めないようにするため。
export const LOCAL_API = 'http://localhost:8787';

/** 使ってよいアドレスなら、そのオリジン(https://〜.run.app か http://localhost:ポート)を返す。だめなら null */
export function validateApiUrl(value) {
  try {
    const u = new URL(String(value ?? '').trim());
    const local = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    // *.run.app は、1つ以上の名前+.run.app(「evil-run.app」や「run.app.evil.com」はだめ)。ユーザー名・パスワードつきもだめ
    const cloudRun = u.protocol === 'https:' && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.run\.app$/.test(u.hostname) && !u.username && !u.password;
    return local || cloudRun ? u.origin : null;
  } catch {
    return null;
  }
}

/** つなぎ先の種類:'local'(先生PC)か 'cloud'(Cloud Run) */
export const apiKind = (url) => (String(url).includes('.run.app') ? 'cloud' : 'local');
export const apiKindLabel = (url) => (apiKind(url) === 'cloud' ? 'Cloud Run' : '先生PC');

/**
 * どこを使うか:画面のアドレスの ?api=(試すとき用。保存しない)→ 先生が選んで保存したもの → 先生PC
 * @param {{param?: string|null, stored?: string|null}} from
 */
export function chooseApiUrl({ param = null, stored = null } = {}) {
  return validateApiUrl(param) ?? validateApiUrl(stored) ?? LOCAL_API;
}

/**
 * Cloud Run は、使っていないときは止まっていて、最初の呼び出しで起動する(AIのモデルを読みこむので、数分かかる)。
 * 準備ができるまで /ready を見て待つ。
 * @param {{check: () => Promise<{ok: boolean, reason?: string}>, sleep?: (ms: number) => Promise<void>, intervalMs?: number, maxMs?: number, onWait?: (info: {elapsedMs: number, reason?: string}) => void, now?: () => number}} o
 * @returns {Promise<{ok: boolean, waitedMs: number, reason?: string}>}
 */
export async function waitUntilReady({ check, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), intervalMs = 5000, maxMs = 6 * 60 * 1000, onWait, now = Date.now }) {
  const t0 = now();
  let last = { ok: false, reason: 'まだ確かめていません' };
  for (;;) {
    last = await check().catch(() => ({ ok: false, reason: 'つながりません(起動中かもしれません)' }));
    const elapsedMs = now() - t0;
    if (last.ok) return { ok: true, waitedMs: elapsedMs };
    if (elapsedMs >= maxMs) return { ok: false, waitedMs: elapsedMs, reason: last.reason };
    onWait?.({ elapsedMs, reason: last.reason });
    await sleep(intervalMs);
  }
}

/** 待っている時間を「1分20秒」のように */
export function waitText(ms) {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}秒` : `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}
