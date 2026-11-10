// テスト用の通信層:本物のデモ版(同じブラウザの中だけで動く)に、先生のログイン(Google)のふりをする部分だけを足す。
// teacher.js の import './transport.js' を、import map で、これに差しかえる(tests/browser/teacher-login.html)。
const originalSearch = location.search;
history.replaceState(null, '', `${location.pathname}?demo`); // transport.js は、読みこむときの ?demo でデモ版かどうかを決める
// 注意:import map で /js/transport.js はこのファイルに差しかえてあるので、?real をつけて、本物を別のアドレスとして読みこむ
const real = await import('/js/transport.js?real');
// 児童の画面を、デモのURLではない形(?demo なし)で試したいとき:本物の通信層を読みこんだあとで、URLをもとにもどす
if (globalThis.__fakeKeepUrl) history.replaceState(null, '', location.pathname + originalSearch);

/** テストが外から決める状態 */
export const fake = { kind: 'none', mine: [], calls: [] };

export const isDemo = real.isDemo;
export const newCode = real.newCode;
export const normalizeCode = real.normalizeCode;

export async function createTransport(opt) {
  // fake.hang:オンラインにつながらない(通信層がいつまでも返らない)、というまね
  if (fake.hang) return new Promise(() => {});
  const t = await real.createTransport(opt);
  fake.calls.push(`createTransport:${opt?.role}`);
  return {
    ...t,
    mode: fake.mode ?? t.mode,
    async getIdToken() { return fake.mode === 'firebase' ? 'fake-token' : null; },
    teacherState: () => ({ kind: fake.kind, name: '山田 花子', uid: 'g-uid-1' }),
    onAuthChange: () => () => {},
    async teacherLogin() {
      const linked = fake.kind === 'legacy';
      fake.calls.push(linked ? 'login:link' : 'login:popup');
      if (fake.loginError) throw new Error(fake.loginError);
      fake.kind = 'google';
      return { linked, switched: false };
    },
    async teacherLogout() { fake.calls.push('logout'); fake.kind = 'none'; },
    async listMyClasses() { fake.calls.push('listMyClasses'); return fake.mine; },
  };
}
