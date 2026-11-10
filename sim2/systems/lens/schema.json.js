// 自動生成。元のJSONを編集し、このスクリプトで更新する。
export default {
  "x-label": "凸レンズの像",
  "x-measures": "物体の位置と、像の位置・大きさ・向き(実像と虚像)",
  "x-units": [
    { "grade": "中1", "unit": "光と音(凸レンズのはたらき)" }
  ],
  "render": ["2d"],
  "solvers": ["analytic"],
  "params": {
    "type": "object",
    "required": ["a", "f", "h"],
    "additionalProperties": false,
    "properties": {
      "a": { "type": "number", "minimum": 2, "maximum": 80, "x-aliases": ["物体の位置", "物体", "ろうそく", "きょり"], "x-label": "物体の位置(レンズからのきょり)", "x-unit": "cm", "x-step": 0.5, "x-default": 30 },
      "f": { "type": "number", "minimum": 5, "maximum": 30, "x-aliases": ["焦点距離", "焦点"], "x-label": "焦点距離", "x-unit": "cm", "x-step": 0.5, "x-default": 10 },
      "h": { "type": "number", "minimum": 1, "maximum": 10, "x-aliases": ["物体の高さ", "高さ"], "x-label": "物体の高さ", "x-unit": "cm", "x-step": 0.5, "x-default": 4 }
    }
  }
}
;
