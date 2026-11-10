// 自動生成。元のJSONを編集し、このスクリプトで更新する。
export default {
  "x-label": "人工衛星の軌道(万有引力・3次元)",
  "x-measures": "回り続ける・落ちる・飛んでいく条件、周期、軌道の形",
  "x-units": [
    { "grade": "中3", "unit": "運動とエネルギー(発展)" }
  ],
  "render": ["2d", "3d"],
  "solvers": ["velocityVerlet", "rk4"],
  "params": {
    "type": "object",
    "required": ["alt", "ratio", "incl", "m"],
    "additionalProperties": false,
    "properties": {
      "alt": { "type": "number", "minimum": 200, "maximum": 40000, "x-aliases": ["高度", "高さ", "地表からの高さ"], "x-label": "打ち出す高さ(地表から)", "x-unit": "km", "x-step": 100, "x-default": 400 },
      "ratio": { "type": "number", "minimum": 0.5, "maximum": 1.6, "x-aliases": ["速さの比", "速さ", "打ち出す速さ"], "x-label": "打ち出す速さ(回り続ける速さの何倍か)", "x-unit": "倍", "x-step": 0.01, "x-default": 1 },
      "incl": { "type": "number", "minimum": 0, "maximum": 90, "x-aliases": ["傾き", "軌道傾斜角", "角度"], "x-label": "軌道の傾き(赤道面から)", "x-unit": "度", "x-step": 1, "x-default": 0 },
      "m": { "type": "number", "minimum": 1, "maximum": 10000, "x-aliases": ["重さ", "質量"], "x-label": "衛星の質量", "x-label-e": "衛星の重さ", "x-unit": "kg", "x-step": 1, "x-default": 1000 }
    }
  }
}
;
