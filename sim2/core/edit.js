// 要望で直すときの共通の流れ(画面とサーバーで同じ):
//   差分(JSON Patch)を当てる → 設定の形を確かめる → 絵をかかずに動かして物理を確かめる → 変更前後のちがい
// 先生が「適用」を押すまでは、もとの設定は変えない。
import { applyPatch, diff } from './patch.js';
import { runHeadless } from './engine.js';
import { validateConfig, getSystem } from '../systems/index.js';

/** 絵をかかずに動かして、見張りの結果を返す */
export function checkPhysics(config, seconds = 10) {
  const e = runHeadless(getSystem(config.system), config, seconds, { every: 50 });
  return { warnings: e.monitor.warnings, results: e.monitor.results, energyDrift: e.monitor.energyDrift };
}

/**
 * @param {object} config  いまの設定
 * @param {object[]} patch  JSON Patch
 * @returns {{ok: boolean, next?: object, errors: string[], physics?: object, changes: object[]}}
 */
export function proposeEdit(config, patch) {
  let next;
  try { next = applyPatch(config, patch); }
  catch (e) { return { ok: false, errors: [`差分を当てられません:${e.message}`], changes: [] }; }
  const errors = validateConfig(next);
  if (errors.length) return { ok: false, errors: errors.map((x) => `設定の形:${x}`), changes: diff(config, next) };
  const physics = checkPhysics(next);
  return { ok: physics.warnings.length === 0, next, errors: physics.warnings.map((w) => `物理の確かめ:${w}`), physics, changes: diff(config, next) };
}
