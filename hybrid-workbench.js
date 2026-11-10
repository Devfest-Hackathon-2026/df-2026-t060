// 先生が手で動かし、確かめた条件だけを教材フォームへ渡す。
import { el } from './common.js';
import { LAB_FAMILIES, LAB_PRESETS, cosmicSpeeds, labMaterial, labPreset, makeLabPlan } from './hybrid-lab.js';
import { mountSimulation } from './sim2/ui/player.js';
import { createComparison } from './sim2/ui/inquiry-compare.js';
import { STUDIO } from './studio-metrics.js';
import { changesBetween } from './inquiry-data.js';

export function mountHybridWorkbench(host, { grade = '中2', requestAI, onUse } = {}) {
  let active = 'space', plan, player, ticket = 0, destroyed = false, proposedBy = '';
  let baseline = null, comparison = null;
  const families = el('div', { class: 'lab-families', 'aria-label': '実験の分野' });
  const list = el('div', { class: 'lab-list', 'aria-label': '実験の一覧' });
  const stage = el('div', { class: 'lab-stage' });
  const badge = el('p', { class: 'lab-kicker' });
  const title = el('h2', { class: 'lab-title' });
  const detail = el('p', { class: 'lab-detail' });
  const question = el('p', { class: 'lab-question' });
  const note = el('div', { class: 'lab-observe' });
  const result = el('p', { class: 'lab-message', role: 'status' });
  const compareStatus = el('p', {class:'lab-message',role:'status'});
  const compareHost = el('div', {class:'lab-compare-stage'});
  const recommended = el('button', {class:'lab-use',type:'button'}, 'おすすめの2条件を比べる');
  const keepA = el('button', {class:'lab-quiet',type:'button'}, '現在の条件をAに保存');
  const compareB = el('button', {class:'lab-quiet',type:'button',disabled:true}, '現在の条件Bと比べる');
  const comparisonBox = el('section',{class:'lab-comparison', 'aria-label':'同じ時刻の比較'},
    el('p',{class:'lab-kicker'},'COMPARE ｜ 条件を一つだけ変える'),
    el('p',{},'おすすめの2条件で始めるか、Aを保存してから、Bで変える条件を一つだけ選びます。'),
    el('div',{class:'lab-actions'},recommended,keepA,compareB),compareStatus,compareHost);
  const use = onUse ? el('button', { type: 'button', class: 'lab-use' }, 'この条件を教材の下書きにする') : null;
  const reset = el('button', { type: 'button', class: 'lab-quiet' }, '条件を初期値にもどす');
  const aiText = el('input', { type: 'text', maxlength: 500, placeholder: '例：水に浮く物体の、水に入る割合を比べたい' });
  const aiButton = el('button', { type: 'submit', class: 'lab-quiet' }, 'Gemmaに条件を相談');
  const aiForm = requestAI ? el('form', { class: 'lab-ai' },
    el('label', {}, '調べたいことから実験を選ぶ', aiText), aiButton) : null;
  const aiNote = el('p', { class: 'lab-message', role: 'status' });
  const root = el('div', { class: 'hybrid-lab' },
    el('div', { class: 'lab-intro' },
      el('p', { class: 'lab-kicker' }, 'FUSHIGI CLASSROOM'),
      el('h1', {}, '実験工房'),
      el('p', {}, '気になる現象を動かし、条件をひとつ変えて、結果を比べよう。')),
    families,
    el('div', { class: 'lab-layout' },
      el('aside', { class: 'lab-nav' },
        el('h2', {}, '実験をえらぶ'), list,
        aiForm, requestAI ? aiNote : null),
      el('section', { class: 'lab-content', 'aria-label': '実験プレビュー' },
        badge, title, detail, question, stage,
        el('div', { class: 'lab-actions' }, use, reset), result, comparisonBox, note)));
  host.replaceChildren(root);

  function paintMenu() {
    families.replaceChildren(...LAB_FAMILIES.map(f => {
      const button = el('button', { type: 'button', 'data-family': f.id, 'aria-pressed': String(active === f.id) },
        el('span', { class: 'lab-number', style: 'color:' + f.color }, f.num), f.name);
      button.addEventListener('click', () => {
        if (active === f.id) return;
        choose(LAB_PRESETS.find(p => p.family === f.id).id);
        families.querySelector('[data-family="' + f.id + '"]')?.focus();
      });
      return button;
    }));
    list.replaceChildren(...LAB_PRESETS.filter(p => p.family === active).map(p => {
      const button = el('button', { type: 'button', 'data-preset': p.id, 'aria-pressed': String(plan?.preset === p.id) }, p.title);
      button.addEventListener('click', () => {
        if (plan?.preset !== p.id) choose(p.id);
        list.querySelector('[data-preset="' + p.id + '"]')?.focus();
      });
      return button;
    }));
  }

  function reference() {
    const numbers = cosmicSpeeds();
    const labels = ['地表付近で円を回る', '地球の重力をふり切る', '太陽系から脱出する'];
    return el('div', { class: 'lab-reference' },
      el('h3', {}, '地表付近の参考値'),
      el('div', { class: 'lab-speed-grid' }, ...labels.map((label, i) =>
        el('div', {}, el('span', {}, '第' + (i + 1) + '宇宙速度'),
          el('b', {}, numbers[i].toFixed(2) + ' km/s'), el('small', {}, label)))),
      el('p', {}, '大気と地球の自転を省いた近似。第3は地球の公転と同じ向きに離れる場合です。上の実験は指定した高度での地球と衛星のモデルです。倍率の基準は、その高度で円を回る速さです。'));
  }

  function show(next, model = '') {
    // AIの条件でも、同じ登録済みモデルに入ることを確認する。
    const p = labPreset(next.preset);
    labMaterial(next);
    player?.destroy();comparison?.destroy();comparison=null;baseline=null;
    compareHost.replaceChildren();compareStatus.textContent='';compareB.disabled=true;
    plan = next; active = p.family; proposedBy = model;
    const f = LAB_FAMILIES.find(f => f.id === active);
    badge.textContent = f.name + ' ／ ' + (next.config.render === '3d' ? '3Dモデル' : 'モデル実験');
    title.textContent = p.title; detail.textContent = p.detail;
    question.textContent = 'この実験の問い：' + p.question;
    root.style.setProperty('--lab-accent', f.color);
    result.textContent = '';
    note.replaceChildren(
      p.id === 'escape' ? reference() : el('p', {}, '同じ条件から、変える値を一つ選びましょう。図と測定値を使って、説明できる違いを探します。'),
      next.reason ? el('p', { class: 'lab-reason' }, 'Gemmaの提案：' + next.reason) : null);
    player = mountSimulation(stage, next.config, { compact: true, theater: true });
    if (use) use.disabled = !player;
    paintMenu();
  }

  function runComparison(configs) {
    if (changesBetween(...configs).length !== 1) throw new Error('AとBで、変える条件を一つだけにしてください。');
    comparison?.destroy();
    comparison=createComparison(compareHost,configs,{onStart:()=>player.pause()});
    compareStatus.textContent='2条件を並べました。同時に再生するか、観察時刻まで進めてください。';
    compareHost.scrollIntoView({block:'nearest'});
  }
  recommended.onclick=()=>{
    try {
      const c=player.getConfig(), {target,pair}=STUDIO[c.system];
      runComparison(pair.map(value=>({...c,params:{...c.params,[target]:value}})));
    } catch(e){compareStatus.textContent=e.message;}
  };
  keepA.onclick=()=>{
    baseline=player.getConfig();compareB.disabled=false;
    compareStatus.textContent='条件Aを保存しました。上の操作で値を一つ変えてからBと比べてください。';
  };
  compareB.onclick=()=>{
    try {runComparison([baseline,player.getConfig()]);}
    catch(e){compareStatus.textContent=e.message;}
  };

  function choose(id) {
    ++ticket; aiButton.disabled = false; aiNote.textContent = '';
    show(makeLabPlan(id, { grade }));
  }
  reset.addEventListener('click', () => choose(plan.preset));
  aiForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const query = aiText.value.trim();
    if (!query) { aiNote.textContent = '調べたいことを書いてください。'; aiText.focus(); return; }
    const stamp = ++ticket;
    aiButton.disabled = true;
    aiNote.textContent = '先生PCのGemmaに、実験と条件を相談しています…';
    try {
      const out = await requestAI(query);
      if (destroyed || stamp !== ticket) return;
      if (out.unsupported) {
        aiNote.textContent = 'この実験工房のモデルでは確かめられません。問いを変えるか、一覧から選んでください。';
        return;
      }
      show(out.plan, out.model);
      aiNote.textContent = '提案を表示しました。動かして確かめてから教材にできます。';
    } catch (error) {
      if (!destroyed && stamp === ticket) aiNote.textContent = error.message || 'AIに接続できません。実験は手でえらべます。';
    } finally {
      if (!destroyed && stamp === ticket) aiButton.disabled = false;
    }
  });
  use?.addEventListener('click', () => {
    try {
      const material = labMaterial(plan, player.getConfig());
      onUse(material, { ...plan, model: proposedBy });
    } catch (error) { result.textContent = error.message || '下書きに入れられませんでした。'; }
  });
  choose('solar');
  return { destroy() { destroyed = true; ++ticket; player?.destroy(); comparison?.destroy(); root.remove(); } };
}
