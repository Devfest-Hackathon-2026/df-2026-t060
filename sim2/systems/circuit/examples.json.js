// 自動生成。元のJSONを編集し、このスクリプトで更新する。
export default [
  {
    "title": "直列回路の電流と電圧",
    "request": "中2の直列回路で、それぞれの抵抗に加わる電圧と流れる電流を調べたい",
    "config": {
      "system": "circuit",
      "curriculum": { "grade": "中2", "unit": "電流と電圧" },
      "params": { "layout": "series2", "V": 6, "R1": 10, "R2": 20, "R3": 30 },
      "render": "2d",
      "controls": ["layout", "V", "R1", "R2"]
    }
  },
  {
    "title": "並列回路の電流",
    "request": "中2の並列回路で、枝分かれした電流がどうなるかを見せたい",
    "config": {
      "system": "circuit",
      "curriculum": { "grade": "中2", "unit": "電流と電圧" },
      "params": { "layout": "parallel2", "V": 6, "R1": 10, "R2": 30, "R3": 30 },
      "render": "2d",
      "controls": ["layout", "R1", "R2"]
    }
  },
  {
    "title": "直列と並列の組み合わせ",
    "request": "直列と並列を組み合わせた回路の電流と電圧",
    "config": {
      "system": "circuit",
      "curriculum": { "grade": "中2", "unit": "電流と電圧" },
      "params": { "layout": "mixed", "V": 9, "R1": 10, "R2": 20, "R3": 20 },
      "render": "2d",
      "controls": ["V", "R1", "R2", "R3"]
    }
  }
]
;
