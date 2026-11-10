// 用意した条件(プリセット)。AIには ID をえらばせるだけで、値はここから取る(AIに定数を思い出させない)。
// 値の出典はコメントに書く。
import { SURFACE_GRAVITY } from './constants.js';

// 天体の重力(NASA Planetary Fact Sheet の値。constants.js)
const planets = (prefix = '') => Object.entries(SURFACE_GRAVITY).map(([id, v]) => ({
  id, label: `${v.label}の上`, words: [v.label], apply: () => ({ g: v.g }), note: `重力加速度 ${v.g} m/s²(NASA の値)${prefix}`,
}));

export const PRESETS = {
  pendulum: [
    ...planets(),
    { id: 'no_air', label: '空気の抵抗なし', words: ['抵抗なし', '抵抗をなく', '空気なし'], apply: () => ({ b: 0 }), note: '空気の抵抗を0にする' },
  ],
  incline: [
    ...planets(),
    { id: 'no_friction', label: 'まさつなし', words: ['まさつなし', 'つるつる'], apply: () => ({ mu: 0 }), note: 'まさつを0にする' },
    { id: 'rough', label: 'まさつが大きい(例)', words: ['ざらざら'], apply: () => ({ mu: 0.3 }), note: '動まさつ係数を0.3にする(説明のための例の値)' },
  ],
  roller: [
    ...planets(),
    { id: 'no_friction', label: 'まさつなし', words: ['まさつなし'], apply: () => ({ b: 0 }), note: 'まさつ・空気の抵抗を0にする' },
    { id: 'valley', label: '谷が1つのコース', words: ['谷が1つ'], apply: () => ({ track: 'valley' }), note: 'コースを谷が1つの形にする' },
    { id: 'twin', label: '谷が2つのコース', words: ['谷が2つ'], apply: () => ({ track: 'twin' }), note: 'コースを谷が2つの形にする' },
  ],
  projectile: [
    ...planets(),
    { id: 'free_fall', label: '自由落下', words: ['自由落下', '落とす'], apply: () => ({ v0: 0, angle: 0 }), note: '投げる速さを0にして、落とすだけにする' },
  ],
  lens: [
    // 焦点距離 f に対して、物体をどこに置くか(値は f から計算する)
    { id: 'far', label: '2Fより遠く', words: ['遠く'], apply: (p) => ({ a: Math.min(80, 3 * p.f) }), note: '物体を 2F より遠く(3F)に置く' },
    { id: 'at2F', label: '2Fの位置', words: ['2F'], apply: (p) => ({ a: 2 * p.f }), note: '物体を 2F(焦点距離の2倍)に置く' },
    { id: 'between', label: 'Fと2Fの間', words: ['Fと2Fの間'], apply: (p) => ({ a: 1.5 * p.f }), note: '物体を F と 2F の間に置く' },
    { id: 'atF', label: '焦点の上', words: ['焦点の上'], apply: (p) => ({ a: p.f }), note: '物体を焦点に置く(像はできない)' },
    { id: 'inside', label: '焦点の内側', words: ['内側', '虫めがね'], apply: (p) => ({ a: Math.max(2, p.f / 2) }), note: '物体を焦点の内側に置く(虚像)' },
  ],
  circuit: [
    // 乾電池1本の電圧:公称 1.5 V(JIS C 8515「一次電池通則」のマンガン・アルカリ乾電池の公称電圧)
    { id: 'battery1', label: '乾電池1こ', words: ['乾電池1', '電池1'], apply: () => ({ V: 1.5 }), note: '電源を乾電池1こ(1.5 V)にする' },
    { id: 'battery2', label: '乾電池2こ(直列)', words: ['乾電池2', '電池2'], apply: () => ({ V: 3 }), note: '電源を乾電池2こ直列(3.0 V)にする' },
    { id: 'battery4', label: '乾電池4こ(直列)', words: ['乾電池4', '電池4'], apply: () => ({ V: 6 }), note: '電源を乾電池4こ直列(6.0 V)にする' },
    { id: 'series', label: '直列', words: ['直列'], apply: () => ({ layout: 'series2' }), note: '直列回路にする' },
    { id: 'parallel', label: '並列', words: ['並列'], apply: () => ({ layout: 'parallel2' }), note: '並列回路にする' },
  ],
};

export const presetsFor = (system) => PRESETS[system] ?? [];
