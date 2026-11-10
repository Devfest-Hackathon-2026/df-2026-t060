// 工房・教材・児童の表示で共通に使う、配信できる実験の範囲。
export const LAB_SYSTEM_IDS = Object.freeze([
  'orbit', 'solar', 'projectile', 'pendulum', 'doublependulum', 'domino',
  'circuit', 'doppler', 'lens', 'sound', 'buoyancy',
]);
const known = new Set(LAB_SYSTEM_IDS);
export const isLabSystem = id => known.has(id);
export const isLabConfig = config => Boolean(config && isLabSystem(config.system) && !config.ext && !config.gen);
