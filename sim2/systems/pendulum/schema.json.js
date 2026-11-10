// 自動生成。元のJSONを編集し、このスクリプトで更新する。
export default {
  "x-label": "ふりこ",
  "x-measures": "ふりこの1往復の時間と、エネルギーの移り変わり",
  "x-units": [
    { "grade": "小5", "unit": "振り子の運動" },
    { "grade": "中3", "unit": "力学的エネルギー" }
  ],
  "render": ["2d"],
  "solvers": ["velocityVerlet", "rk4", "backwardEuler"],
  "params": {
    "type": "object",
    "required": ["L", "m", "theta0", "g"],
    "additionalProperties": false,
    "properties": {
      "L": { "x-aliases": ["糸", "ひも", "長さ"], "type": "number", "minimum": 0.1, "maximum": 3, "x-label": "糸の長さ", "x-unit": "m", "x-step": 0.1, "x-default": 1 },
      "m": { "x-aliases": ["おもり", "重さ", "質量"], "type": "number", "minimum": 0.01, "maximum": 2, "x-label": "おもりの質量", "x-label-e": "おもりの重さ", "x-unit": "kg", "x-step": 0.01, "x-default": 0.1 },
      "theta0": { "x-aliases": ["振れはば", "ふれはば", "角度"], "type": "number", "minimum": 1, "maximum": 80, "x-label": "振れはば", "x-unit": "度", "x-step": 1, "x-default": 20 },
      "g": { "x-aliases": ["重力"], "type": "number", "minimum": 0.5, "maximum": 30, "x-label": "重力加速度", "x-label-e": "重力の強さ", "x-unit": "m/s²", "x-step": 0.01, "x-default": 9.8 },
      "b": { "x-aliases": ["空気の抵抗", "抵抗"], "type": "number", "minimum": 0, "maximum": 2, "x-label": "空気の抵抗", "x-unit": "1/s", "x-step": 0.05, "x-default": 0 }
    }
  }
}
;
