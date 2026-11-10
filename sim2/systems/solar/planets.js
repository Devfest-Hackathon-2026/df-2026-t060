// 惑星のデータ(2000年1月1日正午 J2000 の値)。
// 軌道要素:a(AU)・e・I(度)・L(平均経度、度)・peri(近日点の経度 ϖ、度)・node(昇交点の経度 Ω、度)
//   出典:JPL Solar System Dynamics「Approximate Positions of the Planets」(E. M. Standish)
//         https://ssd.jpl.nasa.gov/planets/approx_pos.html の Table 1(1800〜2050年用)
//   地球の行は「地球と月の重心」の値。
// 質量:太陽の質量との比(太陽の質量 ÷ 惑星の質量 の逆数)
//   出典:IAU 2009 の天文定数(Luzum ほか 2011, Celestial Mechanics and Dynamical Astronomy 110, 293)
//   地球は「地球+月」の値(328900.56)。
export const PLANETS = {
  mercury: { name: '水星', a: 0.38709927, e: 0.20563593, I: 7.00497902, L: 252.2503235, peri: 77.45779628, node: 48.33076593, mass: 1 / 6023600, color2d: 'muted', color3d: 0xb0b0b0 },
  venus: { name: '金星', a: 0.72333566, e: 0.00677672, I: 3.39467605, L: 181.9790995, peri: 131.60246718, node: 76.67984255, mass: 1 / 408523.71, color2d: 'yellow', color3d: 0xffe8a3 },
  earth: { name: '地球', a: 1.00000261, e: 0.01671123, I: -0.00001531, L: 100.46457166, peri: 102.93768193, node: 0, mass: 1 / 328900.56, color2d: 'accent2', color3d: 0x4dabf7 },
  mars: { name: '火星', a: 1.52371034, e: 0.0933941, I: 1.84969142, L: -4.55343205, peri: -23.94362959, node: 49.55953891, mass: 1 / 3098708, color2d: 'accent', color3d: 0xff6b6b },
  jupiter: { name: '木星', a: 5.202887, e: 0.04838624, I: 1.30439695, L: 34.39644051, peri: 14.72847983, node: 100.47390909, mass: 1 / 1047.3486, color2d: 'warm', color3d: 0xffa94d },
  saturn: { name: '土星', a: 9.53667594, e: 0.05386179, I: 2.48599187, L: 49.95424423, peri: 92.59887831, node: 113.66242448, mass: 1 / 3497.898, color2d: 'yellow', color3d: 0xffe066 },
  uranus: { name: '天王星', a: 19.18916464, e: 0.04725744, I: 0.77263783, L: 313.23810451, peri: 170.9542763, node: 74.01692503, mass: 1 / 22902.98, color2d: 'good', color3d: 0x63e6be },
  neptune: { name: '海王星', a: 30.06992276, e: 0.00859048, I: 1.77004347, L: -55.12002969, peri: 44.96476227, node: 131.78422574, mass: 1 / 19412.24, color2d: 'purple', color3d: 0x748ffc },
};
