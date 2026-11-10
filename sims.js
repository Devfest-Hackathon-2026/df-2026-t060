// シミュレーションを画面に出す。物理は sim-physics.js、条件の一覧は sim-catalog.js。
//   renderSim(material.sim) → 画面に入れる要素(読めない sim なら null)
import { el } from './common.js';
import { normalizeSim, simLabel } from './sim-catalog.js';
import { mountSimulation } from './sim2/ui/player.js';
import { mountAssistant } from './sim2/ui/assistant.js';

/** 新しい作り(type: 'cfg'):設定から、確かめ済みのテンプレートで動かす */
function renderCfgSim(sim, { preview = false, onChange, assistant, inquiry } = {}) {
  const stage = el('div', {});
  const helper = assistant ? el('div', {}) : null;
  const root = el('div', { class: `simwrap cfg${preview ? ' preview' : ''}` },
    el('div', { class: 'simhead' }, el('span', { class: 'simunit' }, `${sim.config.curriculum.grade} ${sim.config.curriculum.unit}`), el('span', { class: 'simname' }, simLabel(sim))),
    sim.goal ? el('p', { class: 'simgoal' }, el('b', {}, 'めあて'), sim.goal) : null,
    stage, helper);
  let current = sim.config;
  let player = mountSimulation(stage, current, { inquiry, compact: preview, theater: true, onChange: (c) => { current = c; onChange?.(c); } });
  // 児童の実験助手:変えた設定で動かし直す
  if (assistant) {
    mountAssistant(helper, {
      base: sim.config,
      getConfig: () => player?.getConfig() ?? current,
      setConfig: (c) => { current = c; player?.destroy(); player = mountSimulation(stage, c, { inquiry, theater: true, onChange: (x) => { current = x; } }); },
      ai: assistant,
    });
  }
  return root;
}
export { renderCfgSim };

export function renderSim(raw, options = {}) {
  const sim = normalizeSim(raw);
  return sim ? renderCfgSim(sim, options) : null;
}
