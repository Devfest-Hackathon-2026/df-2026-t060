// 系(system)の一覧。systems/<name>/ に schema.json・model.js・validator.js・examples.json を置き、
// ここに1行足すと使えるようになる(くわしくは ADD_SYSTEM.md)。
// 設定(config)の共通の形もここで作る:
//   { system, curriculum: { grade, unit }, params, render, controls, solver?, speed?, view? }
import { validate } from '../core/schema.js';
import { isLabConfig } from '../../lab-scope.js';
import { GRADES } from '../core/constants.js';

import pendulumSchema from './pendulum/schema.json.js';
import pendulumExamples from './pendulum/examples.json.js';
import * as pendulumModel from './pendulum/model.js';
import * as pendulumValidator from './pendulum/validator.js';



import lensSchema from './lens/schema.json.js';
import lensExamples from './lens/examples.json.js';
import * as lensModel from './lens/model.js';
import * as lensValidator from './lens/validator.js';

import circuitSchema from './circuit/schema.json.js';
import circuitExamples from './circuit/examples.json.js';
import * as circuitModel from './circuit/model.js';
import * as circuitValidator from './circuit/validator.js';


import projectileSchema from './projectile/schema.json.js';
import projectileExamples from './projectile/examples.json.js';
import * as projectileModel from './projectile/model.js';
import * as projectileValidator from './projectile/validator.js';

import orbitSchema from './orbit/schema.json.js';
import orbitExamples from './orbit/examples.json.js';
import * as orbitModel from './orbit/model.js';
import * as orbitValidator from './orbit/validator.js';

import solarSchema from './solar/schema.json.js';
import solarExamples from './solar/examples.json.js';
import * as solarModel from './solar/model.js';
import * as solarValidator from './solar/validator.js';




import soundSchema from './sound/schema.json.js';
import soundExamples from './sound/examples.json.js';
import * as soundModel from './sound/model.js';
import * as soundValidator from './sound/validator.js';
import { HYBRID_SYSTEMS } from './hybrid-systems.js';

const def = (name, schema, model, validator, examples) => ({ name, schema, model, validator, examples, label: schema['x-label'] });

export const SYSTEMS = Object.freeze({
  sound: def('sound', soundSchema, soundModel, soundValidator, soundExamples),
  pendulum: def('pendulum', pendulumSchema, pendulumModel, pendulumValidator, pendulumExamples),
  lens: def('lens', lensSchema, lensModel, lensValidator, lensExamples),
  circuit: def('circuit', circuitSchema, circuitModel, circuitValidator, circuitExamples),
  projectile: def('projectile', projectileSchema, projectileModel, projectileValidator, projectileExamples),
  orbit: def('orbit', orbitSchema, orbitModel, orbitValidator, orbitExamples),
  solar: def('solar', solarSchema, solarModel, solarValidator, solarExamples),
  ...HYBRID_SYSTEMS,
});

export const SYSTEM_NAMES = Object.keys(SYSTEMS);

export function getSystem(name) {
  const s = Object.hasOwn(SYSTEMS, name) ? SYSTEMS[name] : null;
  if (!s) throw new Error(`系がない:${name}`);
  return s;
}

/** その系の設定の形(JSON Schema)。AIの出力の形をしばるのにも使う */
export function configSchema(name) {
  const s = getSystem(name);
  const keys = Object.keys(s.schema.params.properties);
  return {
    type: 'object',
    required: ['system', 'curriculum', 'params', 'render', 'controls'],
    additionalProperties: false,
    properties: {
      system: { const: name },
      curriculum: {
        type: 'object', required: ['grade', 'unit'], additionalProperties: false,
        properties: { grade: { enum: GRADES }, unit: { type: 'string', maxLength: 40 } },
      },
      params: s.schema.params,
      render: { enum: ['2d','3d'] },
      controls: { type: 'array', items: { enum: keys }, maxItems: 6 },
      solver: { enum: s.schema.solvers },
      speed: { type: 'number', minimum: 0.1, maximum: 10 },
      view: {
        type: 'object', additionalProperties: false,
        properties: { scale: { enum: ['real', 'exaggerate'] }, graph: { enum: ['energy', 'none'] }, trail: { type: 'boolean' }, mode: { enum: ['explore', 'experiment'] } },
      },
    },
  };
}

/** 設定を確かめる。まちがいの説明の配列(なければ空) */
export function validateConfig(config) {
  if (!config || typeof config !== 'object') return ['設定がない'];
  if (!isLabConfig(config) || !Object.hasOwn(SYSTEMS, config.system)) return ['実験工房の11モデルから選んでください'];
  return validate(configSchema(config.system), config);
}

/** その系の、はじめの値の設定 */
export function defaultConfig(name, curriculum) {
  const s = getSystem(name);
  const props = s.schema.params.properties;
  return {
    system: name,
    curriculum: curriculum ?? s.schema['x-units'][0],
    params: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v['x-default']])),
    render: s.schema.render[0],
    controls: Object.keys(props).slice(0, 3),
  };
}

/** 条件の説明(スライダー・AIへの説明に使う) */
export function paramInfo(name) {
  return Object.entries(getSystem(name).schema.params.properties).map(([key, v]) => ({
    key, label: v['x-label'], unit: v['x-unit'] ?? '', min: v.minimum, max: v.maximum, step: v['x-step'] ?? (v.maximum - v.minimum) / 100,
    default: v['x-default'], options: v.enum, optionLabels: v['x-options'], aliases: v['x-aliases'] ?? [],
  }));
}

/** 学年・単元から、用意した例をさがす(AIを使わない) */
export function findExamples({ grade, unit, system } = {}) {
  const out = [];
  for (const s of Object.values(SYSTEMS)) {
    if (system && s.name !== system) continue;
    for (const ex of s.examples) {
      const c = ex.config.curriculum;
      if (grade && c.grade !== grade) continue;
      if (unit && !(c.unit.includes(unit) || unit.includes(c.unit))) continue;
      out.push({ ...ex, system: s.name });
    }
  }
  return out;
}
