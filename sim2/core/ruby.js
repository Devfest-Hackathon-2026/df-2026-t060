// 小学生向けのふりがな。シミュレーションの画面に出てくる漢字のことばだけの読みの表
// (形態素解析の道具がないので、表にあることばだけにふりがなをつける)。
// 長いことばを先に合わせる(「重力」は「重」より先)。

const READINGS = {
  糸: 'いと', 長: 'なが', 重: 'おも', 重力: 'じゅうりょく', 質量: 'しつりょう', 振: 'ふ', 空気: 'くうき', 抵抗: 'ていこう',
  速: 'はや', 高: 'たか', 時間: 'じかん', 往復: 'おうふく', 回数: 'かいすう', 回: 'かい', 運動: 'うんどう', 位置: 'いち',
  合計: 'ごうけい', 予想: 'よそう', 実験: 'じっけん', 結果: 'けっか', 再生: 'さいせい', 一時停止: 'いちじていし', 送: 'おく',
  角度: 'かくど', 斜面: 'しゃめん', 光: 'ひかり', 物体: 'ぶったい', 像: 'ぞう', 電流: 'でんりゅう', 電圧: 'でんあつ',
  回路: 'かいろ', 豆電球: 'まめでんきゅう', 乾電池: 'かんでんち', 表: 'ひょう', 書: 'か', 出: 'だ', 加速度: 'かそくど',
  地球: 'ちきゅう', 月: 'つき', 火星: 'かせい', 木星: 'もくせい', 計: 'はか', 変: 'か', 比: 'くら', 調: 'しら',
  記録: 'きろく', 平均: 'へいきん', 秒: 'びょう', 大: 'おお', 小: 'ちい', 始: 'はじ', 次: 'つぎ', 自分: 'じぶん',
  考: 'かんが', 理由: 'りゆう', 同: 'おな', 短: 'みじか', 遅: 'おそ', 一定: 'いってい', 数: 'かず', 書き出: 'かきだ',
};
const KEYS = Object.keys(READINGS).sort((a, b) => b.length - a.length);
const KANJI = /[一-鿿]/;

/**
 * 文を、ふりがなつきの部品(文字列と <ruby>)に分ける
 * @param {string} text
 * @param {Document} [doc]
 * @returns {(string|HTMLElement)[]}
 */
export function rubyNodes(text, doc = globalThis.document) {
  const out = [];
  let buf = '';
  for (let i = 0; i < text.length;) {
    if (KANJI.test(text[i])) {
      const key = KEYS.find((k) => text.startsWith(k, i));
      if (key) {
        if (buf) { out.push(buf); buf = ''; }
        const r = doc.createElement('ruby');
        r.append(key, Object.assign(doc.createElement('rt'), { textContent: READINGS[key] }));
        out.push(r);
        i += key.length;
        continue;
      }
    }
    buf += text[i++];
  }
  if (buf) out.push(buf);
  return out;
}

/** テスト用:ふりがなをつけた結果を「漢字(よみ)」の文字にする */
export function rubyText(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const key = KANJI.test(text[i]) && KEYS.find((k) => text.startsWith(k, i));
    if (key) { out += `${key}(${READINGS[key]})`; i += key.length; } else out += text[i++];
  }
  return out;
}
