// 物理の定数と、プリセットの値(実データ・文献値)。出典を書く。

/** 標準重力加速度 9.80665 m/s²(国際度量衡総会 1901年の定義。BIPM「SI Brochure」第9版) */
export const G_STANDARD = 9.80665;
/** 教科書で使う重力加速度(中学の教科書は 9.8 m/s² を使う) */
export const G_EARTH = 9.8;

/**
 * 天体の表面の重力加速度(m/s²)
 * 出典:NASA Goddard Space Flight Center「Planetary Fact Sheet」
 *       https://nssdc.gsfc.nasa.gov/planetary/factsheet/ (Gravity の行)
 *       月は https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html
 */
export const SURFACE_GRAVITY = {
  earth: { label: '地球', g: 9.8 },
  moon: { label: '月', g: 1.62 },
  mars: { label: '火星', g: 3.71 },
  jupiter: { label: '木星', g: 24.79 },
  venus: { label: '金星', g: 8.87 },
  mercury: { label: '水星', g: 3.7 },
};

/** ことばから天体をさがす(「月面にして」→ moon) */
export const GRAVITY_WORDS = [
  [/月(面|の上|で)?/, 'moon'], [/火星/, 'mars'], [/木星/, 'jupiter'], [/金星/, 'venus'], [/水星/, 'mercury'], [/地球/, 'earth'],
];

/** 学年(現行の学習指導要領。小3〜中3) */
export const GRADES = ['小3', '小4', '小5', '小6', '中1', '中2', '中3'];
/** 小学生かどうか(ふりがな・数式を出さない表示にする) */
export const isElementary = (grade) => /^小/.test(grade ?? '');

/**
 * 地球の重力定数 GM = 3.986004418e14 m³/s²(IERS Conventions 2010 / NASA の標準値)
 * 地球の平均半径 6.371e6 m(NASA「Earth Fact Sheet」の体積平均半径 6371.0 km)
 */
export const GM_EARTH = 3.986004418e14;
export const R_EARTH = 6.371e6;
