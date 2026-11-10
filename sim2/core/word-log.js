// 児童の実験助手が「ことばで読めなかった」言い方を、この端末の中だけに記録する。
// - サーバーには送らない。生徒が「先生にわたすファイルを作る」を押したときだけ、ファイルにする。
// - 先生は words.html でファイルを読みこみ、辞書(student-words.json と同じ形)に足す。
// - 先生が足した辞書は、この端末に保存され、ことばの読みとり(core/assistant.js)にすぐ使われる。
const LOG_KEY = 's2-word-log-v1';
const EXTRA_KEY = 's2-words-extra-v1';
const MAX = 200;

const store = {
  get(k, d) { try { return JSON.parse(globalThis.localStorage?.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { globalThis.localStorage?.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

/** 読めなかった言い方を1つ記録する(同じ文が続いたら数だけ足す) */
export function recordMiss({ text, system, grade, how, action }) {
  const t = String(text ?? '').trim().slice(0, 100);
  if (!t || !system) return false;
  const list = store.get(LOG_KEY, []);
  const last = list.at(-1);
  if (last && last.text === t && last.system === system) { last.count = (last.count ?? 1) + 1; last.at = Date.now(); }
  else list.push({ text: t, system, grade: grade ?? null, how: how ?? 'ことば', action: action && action.action !== 'unknown' ? action : null, at: Date.now(), count: 1 });
  return store.set(LOG_KEY, list.slice(-MAX));
}
export const listMisses = () => store.get(LOG_KEY, []);
export const clearMisses = () => store.set(LOG_KEY, []);

/** 先生にわたすファイルの中身 */
export const exportMisses = (list = listMisses()) => ({ kind: 's2-word-log', version: 1, exportedAt: new Date().toISOString(), items: list });

/** 読みこんだファイル(いくつでも)をまとめる。同じ系・同じ言い方は1つにして、数を足す */
export function aggregate(files) {
  const map = new Map();
  for (const f of files) {
    if (f?.kind !== 's2-word-log' || !Array.isArray(f.items)) continue;
    for (const it of f.items) {
      if (typeof it?.text !== 'string' || typeof it?.system !== 'string') continue;
      const text = it.text.trim().slice(0, 100), key = `${it.system}\u0000${text}`;
      const cur = map.get(key) ?? { text, system: it.system, grade: it.grade ?? null, count: 0, ai: null };
      cur.count += Number(it.count) > 0 ? Number(it.count) : 1;
      if (it.action && !cur.ai) cur.ai = it.action;
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** 先生が足した辞書(この端末) */
export const loadExtra = () => store.get(EXTRA_KEY, {});
export const saveExtra = (extra) => store.set(EXTRA_KEY, extra);

/** 辞書を1つ足す。entry:{ type:'phrase', system, match, param, dir } / { type:'alias', system, param, word } / { type:'kana', from, to } */
export function addEntry(extra, entry) {
  const x = structuredClone(extra ?? {});
  if (entry.type === 'kana') { (x.kana ??= []).push([entry.from, entry.to]); return x; }
  const s = ((x.systems ??= {})[entry.system] ??= {});
  if (entry.type === 'phrase') (s.phrases ??= []).push({ match: [entry.match], param: entry.param, dir: entry.dir });
  if (entry.type === 'alias') ((s.aliases ??= {})[entry.param] ??= []).push(entry.word);
  return x;
}

/** 元の辞書と、足した辞書を合わせる(足した言い回しを先に調べる) */
export function mergeWords(base, extra) {
  const e = extra ?? {};
  const out = { ...base, kana: [...(e.kana ?? []), ...(base.kana ?? [])], up: [...(base.up ?? []), ...(e.up ?? [])], down: [...(base.down ?? []), ...(e.down ?? [])],
    implied: { ...(base.implied ?? {}) }, systems: {}, explain: { ...(base.explain ?? {}) } };
  for (const [k, ws] of Object.entries(e.implied ?? {})) out.implied[k] = [...(out.implied[k] ?? []), ...ws];
  for (const [k, ws] of Object.entries(e.explain ?? {})) out.explain[k] = [...(out.explain[k] ?? []), ...ws];
  for (const sys of new Set([...Object.keys(base.systems ?? {}), ...Object.keys(e.systems ?? {})])) {
    const b = base.systems?.[sys] ?? {}, a = e.systems?.[sys] ?? {};
    const aliases = { ...(b.aliases ?? {}) };
    for (const [k, ws] of Object.entries(a.aliases ?? {})) aliases[k] = [...(aliases[k] ?? []), ...ws];
    out.systems[sys] = { aliases, phrases: [...(a.phrases ?? []), ...(b.phrases ?? [])] };
  }
  return out;
}
