// 設定(config)の形を確かめる。JSON Schema の、このアプリで使う部分だけを自分で書いたもの
// (ライブラリを足さずに、ブラウザとサーバーの両方で同じものを使うため)。
// 使えるもの:type / enum / const / minimum / maximum / required / properties /
//            additionalProperties(false のみ)/ items / minItems / maxItems / maxLength
// 「x-」で始まるもの(x-unit, x-label など)は、画面用の説明なので確かめに使わない。

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);

/**
 * @param {object} schema
 * @param {*} value
 * @returns {string[]} まちがいの説明(なければ空)。説明は「/params/L:…」の形
 */
export function validate(schema, value, path = '') {
  const errs = [];
  const at = path || '/';
  if (schema.const !== undefined && value !== schema.const) errs.push(`${at}:${JSON.stringify(schema.const)} でなければいけない`);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}:${schema.enum.map((x) => JSON.stringify(x)).join('・')} のどれか`);
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(value, t))) { errs.push(`${at}:${types.join('か')}でなければいけない`); return errs; }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${at}:${schema.minimum} 以上`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${at}:${schema.maximum} 以下`);
  }
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${at}:${schema.maxLength}字まで`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${at}:${schema.minItems}こ以上`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${at}:${schema.maxItems}こまで`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${path}/${i}`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${path}/${k}:必要`);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errs.push(...validate(props[k], v, `${path}/${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}/${k}:この名前は使えない`);
    }
  }
  return errs;
}

/** Ollama の format などに渡すため、画面用の「x-」の説明を取りのぞいた Schema にする */
export function stripExtras(schema) {
  if (Array.isArray(schema)) return schema.map(stripExtras);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(Object.entries(schema).filter(([k]) => !k.startsWith('x-')).map(([k, v]) => [k, stripExtras(v)]));
}
