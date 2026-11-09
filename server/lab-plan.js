// 自由文から、既存の実験と安全な条件だけを提案する。コードは生成・実行しない。
import { chat, MODEL } from './draft.js';
import { LAB_PRESETS, labParamGuide, makeLabPlan } from '../public/js/hybrid-lab.js';
import { GRADES } from '../public/js/sim2/core/constants.js';

const schema = {
  type: 'object', additionalProperties: false, required: ['preset', 'edits', 'reason'],
  properties: {
    preset: { enum: [...LAB_PRESETS.map(p => p.id), 'unsupported'] },
    edits: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['key', 'value'],
      properties: { key: { type: 'string' }, value: { anyOf: [{ type: 'number' }, { type: 'string' }] } } } },
    reason: { type: 'string', maxLength: 240 },
  },
};

export async function proposeLab(text, grade, ask = chat) {
  const gradeName = ({ 5: '小5', 6: '小6', 7: '中1', 8: '中2', 9: '中3' })[grade] ?? (GRADES.includes(grade) ? grade : '小5');
  const out = await ask({
    system: '先生が使う理科の実験工房の案を作ります。後述の登録済み実験から1つ選び、明示された条件だけを edits に入れてください。範囲や単位を守り、分からない値は省きます。適切な実験がなければ preset を unsupported、edits を空配列にします。reason は日本語で短く、何を比べるとよいかを書きます。計算結果や測定値を作らず、コードを出さず、JSONだけを返してください。',
    user: JSON.stringify({ grade: gradeName, request: text, registeredExperiments: labParamGuide() }),
    schema, temperature: 0.12, maxTokens: 500,
  });
  const data = out.json;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !['preset', 'edits', 'reason'].includes(k)) || !Array.isArray(data.edits) || typeof data.reason !== 'string') throw new Error('Gemmaの提案形式を確認できませんでした。');
  if (data.preset === 'unsupported') return { unsupported: true, reason: data.reason.slice(0, 240), model: MODEL };
  if (data.edits.some(e => !e || Object.keys(e).some(k => !['key', 'value'].includes(k)))) throw new Error('Gemmaの条件の形式を確認できませんでした。');
  return { plan: makeLabPlan(data.preset, { edits: data.edits, reason: data.reason, grade: gradeName }), model: MODEL };
}
