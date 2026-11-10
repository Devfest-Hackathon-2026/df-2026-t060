// シミュレーションのデータ表と、Excel で開ける CSV。
//  - 4種類のシミュレーション:条件を少しずつ変えたデータ表(simSweep)
//  - AIが作ったシミュレーション:計算を確かめた表(verifyCustomSim。シミュレーションの値と、公式で計算した値)
import { el } from './common.js';

/** 表(2次元の配列)を CSV にする。Excel で文字化けしないように、先頭に BOM をつける */
export function toCsv(table) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + table.map((row) => row.map(cell).join(',')).join('\r\n');
}

/** CSV をファイルとして保存させる */
export function downloadCsv(filename, table) {
  const blob = new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** 4種類のシミュレーションのデータ表(simSweep の結果)を、表とCSV用の配列にする */
export function sweepTable(sweep) {
  const head = ['変えた条件', '条件の値', '単位', `${sweep.measure}${sweep.unit ? `(${sweep.unit})` : ''}`];
  return [head, ...sweep.rows.map((r) => [r.param, r.value, r.unit, r.result])];
}

/** AIが作ったシミュレーションを確かめた結果を、表とCSV用の配列にする */
export function verifyTable(result) {
  const head = ['条件', '確かめた値', 'シミュレーションの値', '公式で計算した値', 'ちがい(%)', '判定', 'メモ'];
  return [head, ...result.rows.map((r) => [
    Object.entries(r.conditions).map(([k, v]) => `${k}=${v}`).join(' '),
    `${r.check.label}${r.check.unit ? `(${r.check.unit})` : ''}`,
    Number.isFinite(r.got) ? Number(r.got.toFixed(4)) : '',
    Number.isFinite(r.exp) ? Number(r.exp.toFixed(4)) : '',
    Number.isFinite(r.rel) ? Number((r.rel * 100).toFixed(2)) : '',
    r.ok ? '○' : '×',
    r.note,
  ])];
}

/** 配列の表を、画面の <table> にする(1行目は見出し) */
export function htmlTable(table, { okCol = -1 } = {}) {
  const [head, ...rows] = table;
  return el('div', { class: 'datatable' },
    el('table', {},
      el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, String(h))))),
      el('tbody', {}, ...rows.map((r) => el('tr', { class: okCol >= 0 ? (r[okCol] === '○' ? 'ok' : 'ng') : '' }, ...r.map((c) => el('td', {}, String(c))))))));
}
