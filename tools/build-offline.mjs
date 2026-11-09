// 静的ファイルの一覧を更新する。
import { readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const root = resolve(import.meta.dirname, '../public'), files = [];
async function walk(dir) { for (const x of await readdir(dir, { withFileTypes:true })) {
  const p = resolve(dir, x.name); if (x.isDirectory()) { if (!['models','vendor'].includes(x.name) || dir !== root) await walk(p); }
  else if (/\.(js|json|css|html|svg|webmanifest|png)$/.test(x.name) && !['offline-files.json','inquiry-offline-sw.js'].includes(x.name)) files.push(relative(root, p).replaceAll('\\','/'));
} }
await walk(root); files.sort();
await writeFile(resolve(root,'offline-files.json'), JSON.stringify({ version:1, files }, null, 2));
console.log(`保存するファイル ${files.length}件`);
