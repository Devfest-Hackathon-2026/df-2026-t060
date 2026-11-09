// 児童・先生・保存済み教材の入口。工房の条件だけを読む。
import { defaultConfig, getSystem, paramInfo, validateConfig } from './sim2/systems/index.js';

export function normalizeSim(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let config = raw.config;
  if (raw.type === 'pendulum') {
    // 旧版の単振り子は同じ物理モデルに移して開ける。
    config = defaultConfig('pendulum');
    const limits = paramInfo('pendulum');
    for (const [key, value] of Object.entries({
      L: raw.values?.length ?? raw.length, m: Number(raw.values?.mass) / 1000,
      theta0: raw.values?.amplitude,
    })) {
      if (!Number.isFinite(Number(value))) continue;
      const p = limits.find(p => p.key === key);
      if (p) config.params[key] = Math.min(p.max, Math.max(p.min, Number(value)));
    }
    config.render = '3d';
  } else if (raw.type !== 'cfg') return null;
  if (validateConfig(config).length) return null;
  return { type: 'cfg', config: structuredClone(config), goal: typeof raw.goal === 'string' ? raw.goal.trim().slice(0, 120) : '', showValues: raw.showValues !== false };
}

export const simLabel = raw => {
  const s = normalizeSim(raw);
  return s ? getSystem(s.config.system).label : '';
};
export const simMeasures = raw => {
  const s = normalizeSim(raw);
  return s ? getSystem(s.config.system).schema['x-measures'] : '';
};
export const simParams = raw => {
  const s = normalizeSim(raw);
  return s ? paramInfo(s.config.system).filter(p => s.config.controls.includes(p.key)) : [];
};
export function describeSim(raw) {
  const s = normalizeSim(raw);
  if (!s) return '';
  const names = simParams(s).map(p => p.label);
  return '「' + simLabel(s) + '」では、' + (names.length ? names.join('・') + 'を変えて、' : '') + simMeasures(s) + 'を調べられます。';
}
