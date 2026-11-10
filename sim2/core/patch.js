// JSON Patch(RFC 6902)を当てる・差分を作る。もとの設定は書きかえず、新しいものを返す。
//   applyPatch({ params: { g: 9.8 } }, [{ op: 'replace', path: '/params/g', value: 1.62 }])

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** JSON Pointer(RFC 6901)を、名前の列にする。"/a/b~1c" → ["a", "b/c"] */
export function parsePointer(p) {
  if (p === '') return [];
  if (typeof p !== 'string' || !p.startsWith('/')) throw new Error(`場所の書き方がおかしい:${p}`);
  return p.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function locate(doc, path) {
  const keys = parsePointer(path);
  if (!keys.length) return { parent: null, key: null };
  let parent = doc;
  for (const k of keys.slice(0, -1)) {
    if (parent === null || typeof parent !== 'object' || !(k in parent)) throw new Error(`場所がない:${path}`);
    parent = parent[k];
  }
  if (parent === null || typeof parent !== 'object') throw new Error(`場所がない:${path}`);
  return { parent, key: keys[keys.length - 1] };
}

const get = (doc, path) => {
  const { parent, key } = locate(doc, path);
  if (parent === null) return doc;
  if (!(key in parent)) throw new Error(`場所がない:${path}`);
  return parent[key];
};

function add(doc, path, value) {
  const { parent, key } = locate(doc, path);
  if (parent === null) return value;
  if (Array.isArray(parent)) {
    const i = key === '-' ? parent.length : Number(key);
    if (!Number.isInteger(i) || i < 0 || i > parent.length) throw new Error(`場所がない:${path}`);
    parent.splice(i, 0, value);
  } else parent[key] = value;
  return doc;
}

function remove(doc, path) {
  const { parent, key } = locate(doc, path);
  if (parent === null) throw new Error('全体は消せない');
  if (Array.isArray(parent)) {
    const i = Number(key);
    if (!Number.isInteger(i) || i < 0 || i >= parent.length) throw new Error(`場所がない:${path}`);
    parent.splice(i, 1);
  } else {
    if (!(key in parent)) throw new Error(`場所がない:${path}`);
    delete parent[key];
  }
  return doc;
}

/**
 * @param {object} doc
 * @param {{op: string, path: string, value?: any, from?: string}[]} ops
 * @returns {object} 当てたあとの新しい設定(1つでも当てられなければ、例外を投げて何も変えない)
 */
export function applyPatch(doc, ops) {
  if (!Array.isArray(ops)) throw new Error('差分は配列で書く');
  let out = clone(doc);
  for (const o of ops) {
    switch (o?.op) {
      case 'add': out = add(out, o.path, clone(o.value)); break;
      case 'remove': out = remove(out, o.path); break;
      case 'replace': get(out, o.path); out = add(remove(out, o.path), o.path, clone(o.value)); break;
      case 'move': { const v = get(out, o.from); out = add(remove(out, o.from), o.path, v); break; }
      case 'copy': out = add(out, o.path, clone(get(out, o.from))); break;
      case 'test': if (JSON.stringify(get(out, o.path)) !== JSON.stringify(o.value)) throw new Error(`test が合わない:${o.path}`); break;
      default: throw new Error(`使えない op:${o?.op}`);
    }
  }
  return out;
}

/** 2つの設定のちがい(変更前と変更後をならべて見せるため)。[{ path, before, after }] */
export function diff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(a) || !isObj(b)) return [{ path: path || '/', before: a, after: b }];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.flatMap((k) => diff(a[k], b[k], `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`));
}
