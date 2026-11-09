import { defaultConfig } from './sim2/systems/index.js';
// ?demoを固定して、本番Firebaseのクラスに書き込まない。
const url = new URL(location.href);
if (!url.searchParams.has('demo')) {
  url.searchParams.set('demo', '');
  history.replaceState(null, '', url);
}
const { createTransport: getTransport } = await import('./transport.js');
const t = await getTransport({ role: 'teacher' });
const msg = document.getElementById('message');
const create = document.getElementById('create');
create.onclick = async () => {
  create.disabled = true;
  try {
    if (t.mode !== 'demo') throw new Error('URLの末尾に ?demo を付けて再読込してください');
    const code = await t.createClass('問いが育つ実験クラス', 9);
    for (const [system, title, question] of [
      ['orbit', '速さを変えると、地球のまわりの動きはどう変わる？', 'ぶつかる・回る・遠ざかるの違いは、何が決める？'],
      ['sound', '音と空気のふるえ', 'ふるえの大きさと、1秒にふるえる回数は、それぞれ音の何を変える？']]) {
      const config = defaultConfig(system, { grade: system === 'sound' ? '中1' : '中3', unit: system === 'sound' ? '光と音' : '運動とエネルギー（発展）' });
      if (system === 'orbit') { config.params.alt = 400; config.params.ratio = 1; config.params.incl = 0; config.controls = ['ratio', 'alt', 'incl']; config.render = '3d'; config.speed = 1; }
      const rootId = crypto.randomUUID();
      await t.publishMaterial(code, { title, explanation: system === 'orbit' ? '同じ場所・同じ向きから発射し、最初の速さだけを変えよう。図の球と矢印は見やすい大きさです。' : '黄色い点は同じ空気の部分。左右の動きと、右に進む波を比べよう。音はボタンで短く再生できます。',
        sim: { type:'cfg', config, goal: question }, lesson:{ question, predict:'動かす前に予想を書こう', check:'1つの条件を変え、ほかの条件をそろえて比べよう', result:'', summary:'' },
        quiz:[], inquiry:{ rootId, revision:1, sources:[], sourceQuestionIds:[], sourceQuestions:[] } });
    }
    msg.textContent = `クラスコード ${code}。下の各画面を新しいタブで開けます。`;
    const screens = [
      [`teacher.html?demo&code=${code}`, '先生', '問いの確認・教材の配信'],
      [`student.html?demo&code=${code}&seat=1`, '児童 A', '実験・根拠つきの問い'],
      [`student.html?demo&code=${code}&seat=2`, '児童 B', '改訂版で比較実験'],
    ];
    document.getElementById('links').replaceChildren(...screens.map(([href, label, detail]) => {
      const link = Object.assign(document.createElement('a'), { href, target: '_blank', rel: 'noopener' });
      const name = Object.assign(document.createElement('strong'), { textContent: label });
      const action = Object.assign(document.createElement('span'), { textContent: detail });
      link.append(name, action);
      return link;
    }));
  } catch (e) { msg.textContent = e.message; }
  finally { create.disabled = false; }
};
create.disabled = false;
