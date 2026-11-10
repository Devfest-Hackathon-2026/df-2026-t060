import { normalizeSim } from './sim-catalog.js';
import { getSystem } from './sim2/systems/index.js';
import { runHeadless } from './sim2/core/engine.js';
import { STUDIO } from './studio-metrics.js';

const cache = new Map();
export function simFacts(raw) {
  const sim = normalizeSim(raw);
  if (!sim) return null;
  const key=JSON.stringify(sim.config);
  if(cache.has(key))return cache.get(key);
  const cfg = sim.config, sys = getSystem(cfg.system), profile = STUDIO[cfg.system];
  // サーバーの案・先生の下書きの数字は、画面に使う計算と同じ。
  // 端末で重くならないよう、長時間の軌道は工房の比較画面から確かめる。
  const t = cfg.system === 'solar' ? (cfg.params.set === 'outer' ? 13 : 2) : profile.time;
  const e = runHeadless(sys, cfg, t);
  const readings = sys.model.readouts(e.observe(), e.p);
  const lines = readings.filter(r => r.key !== 't' && (Number.isFinite(r.value) || r.text))
    .map(r => r.label + '：' + (r.text ?? (Number(r.value.toFixed(r.digits ?? 2)) + (r.unit ? ' ' + r.unit : ''))));
  const out={ now: 'モデル内で ' + Number(e.t.toPrecision(5)) + ' ' + profile.unit + ' まで進めた結果。', lines, rows: [] };
  if(cache.size>=32)cache.delete(cache.keys().next().value);
  cache.set(key,out);
  return out;
}
export function simFactLines(sim) { const r = simFacts(sim); return r ? [r.now, ...r.lines] : []; }
// AIへは根拠値を直接渡す。文中の向きを旧来の単語リストだけで決めない。
export function checkAgainstFacts() { return []; }
