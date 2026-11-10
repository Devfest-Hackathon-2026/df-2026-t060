// 先生の下書きと工房は同じ設定を使う。工房外の実行形式は受け付けない。
import { el } from './common.js';
import { LAB_PRESETS, makeLabPlan } from './hybrid-lab.js';
import { normalizeSim } from './sim-catalog.js';
import { renderSim } from './sims.js';

export function createSimEditor(host, preview, onChange, { grade } = {}) {
  const select = el('select', {'aria-label':'教材の実験'},
    el('option', {value:''}, '本文だけ'),
    ...LAB_PRESETS.map(p => el('option', {value:p.id}, p.title)));
  const goal = el('input', {type:'text', maxlength:120, placeholder:'例：速さを変えると、軌道はどうなる？'});
  let sim = null;
  let muted = false;
  function show(notify = true) {
    muted = true;
    select.value = LAB_PRESETS.find(p => p.system === sim?.config.system)?.id ?? '';
    goal.value = sim?.goal ?? '';
    goal.disabled = !sim;
    preview.replaceChildren();
    if (sim) {
      const scene = renderSim(sim, {preview:true, onChange(c) {
        sim = normalizeSim({...sim, config:c});
        onChange?.(sim);
      }});
      if (scene) preview.append(scene);
    }
    muted = false;
    if (notify) onChange?.(sim);
  }
  select.onchange = () => {
    if (muted) return;
    sim = select.value ? {type:'cfg', config:makeLabPlan(select.value, {grade}).config, goal:goal.value} : null;
    show();
  };
  goal.oninput = () => { if (sim) { sim.goal = goal.value; onChange?.(sim); } };
  host.replaceChildren(el('label',{},'実験工房の実験',select),el('label',{},'実験のめあて',goal),
    el('p',{class:'small'},'下のプレビューで変えた条件が、そのまま児童の教材に入ります。'));
  show(false);
  return {get:()=>sim ? structuredClone(sim):null,set(raw){sim=normalizeSim(raw);show();}};
}
