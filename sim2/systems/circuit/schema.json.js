// 自動生成。元のJSONを編集し、このスクリプトで更新する。
export default {
  "x-label": "直流回路",
  "x-measures": "直列・並列回路の、それぞれの抵抗に流れる電流と、加わる電圧",
  "x-units": [
    { "grade": "中2", "unit": "電流と電圧" }
  ],
  "render": ["2d"],
  "solvers": ["analytic"],
  "params": {
    "type": "object",
    "required": ["layout", "V", "R1", "R2"],
    "additionalProperties": false,
    "properties": {
      "layout": {
        "enum": ["series2", "series3", "parallel2", "parallel3", "mixed"],
        "x-label": "回路のつなぎ方",
        "x-aliases": ["つなぎ方", "回路"],
        "x-options": { "series2": "直列(抵抗2つ)", "series3": "直列(抵抗3つ)", "parallel2": "並列(抵抗2つ)", "parallel3": "並列(抵抗3つ)", "mixed": "直列と並列の組み合わせ" },
        "x-default": "series2"
      },
      "V": { "type": "number", "minimum": 1, "maximum": 12, "x-aliases": ["電源の電圧", "電源", "電池", "電圧"], "x-label": "電源の電圧", "x-unit": "V", "x-step": 0.5, "x-default": 6 },
      "R1": { "type": "number", "minimum": 1, "maximum": 50, "x-aliases": ["抵抗1", "R1"], "x-label": "抵抗 R1", "x-unit": "Ω", "x-step": 1, "x-default": 10 },
      "R2": { "type": "number", "minimum": 1, "maximum": 50, "x-aliases": ["抵抗2", "R2"], "x-label": "抵抗 R2", "x-unit": "Ω", "x-step": 1, "x-default": 20 },
      "R3": { "type": "number", "minimum": 1, "maximum": 50, "x-aliases": ["抵抗3", "R3"], "x-label": "抵抗 R3", "x-unit": "Ω", "x-step": 1, "x-default": 30 }
    }
  }
}
;
