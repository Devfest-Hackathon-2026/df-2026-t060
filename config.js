// Firebase プロジェクト kyoiku-hakkason の Web 設定（ブラウザに公開される前提の値）。
// null にすると「デモモード」（同じブラウザのタブ同士だけでつながる）で動く。
export const firebaseConfig = {
  apiKey: "AIzaSyB6iaX2RvjIHRWirGpYO0T0QK3k3WJ6BQ4",
  authDomain: "kyoiku-hakkason.firebaseapp.com",
  projectId: "kyoiku-hakkason",
  storageBucket: "kyoiku-hakkason.firebasestorage.app",
  messagingSenderId: "232562266440",
  appId: "1:232562266440:web:9644270d67ed2eca26a37d",
};

// 先生の側のAIサーバー(server/index.js)の場所。
//   - 先生PCで動かす(npm start)→ http://localhost:8787(ふつう)
//   - Cloud Run に載せた → その https://〜.run.app(先生の画面の「AI」の表示から選んで、このブラウザに保存する)
//   - 先生画面のURLに ?api=https://... を付けると、その場所を使う(試すとき用。保存しない)
// 先生のトークンと児童の質問を送るので、手元(localhost)と Cloud Run(*.run.app)だけを許す(api-url.js)。
import { chooseApiUrl, validateApiUrl } from './api-url.js';

const API_KEY = 'kyozai-api';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

/** いま使うAIサーバーの場所 */
export function getApiUrl() {
  return chooseApiUrl({ param: new URLSearchParams(location.search).get('api'), stored: read(API_KEY) });
}

/** 先生が選んだ場所を、このブラウザに保存する(null なら、先生PCにもどす)。使えないアドレスなら false */
export function setApiUrl(value) {
  try {
    if (value === null) { localStorage.removeItem(API_KEY); return true; }
    const ok = validateApiUrl(value);
    if (!ok) return false;
    localStorage.setItem(API_KEY, ok);
    return true;
  } catch {
    return false;
  }
}
