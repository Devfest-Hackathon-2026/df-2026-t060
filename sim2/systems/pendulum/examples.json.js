// 自動生成。元のJSONを編集し、このスクリプトで更新する。
export default [
  {
    "title": "ふりこの1往復の時間(糸の長さ)",
    "request": "小5のふりこで、糸の長さを変えて1往復の時間を調べたい",
    "config": {
      "system": "pendulum",
      "curriculum": { "grade": "小5", "unit": "振り子の運動" },
      "params": { "L": 1, "m": 0.05, "theta0": 15, "g": 9.8, "b": 0 },
      "render": "2d",
      "controls": ["L", "m", "theta0"],
      "view": { "mode": "experiment" }
    }
  },
  {
    "title": "ふりこの力学的エネルギー",
    "request": "中3の力学的エネルギーで、ふりこの位置エネルギーと運動エネルギーの移り変わりを見せたい",
    "config": {
      "system": "pendulum",
      "curriculum": { "grade": "中3", "unit": "力学的エネルギー" },
      "params": { "L": 1, "m": 0.2, "theta0": 40, "g": 9.8, "b": 0 },
      "render": "2d",
      "controls": ["theta0", "m", "b"]
    }
  },
  {
    "title": "月の上のふりこ",
    "request": "月の上でふりこを動かすとどうなるか",
    "config": {
      "system": "pendulum",
      "curriculum": { "grade": "中3", "unit": "力学的エネルギー" },
      "params": { "L": 1, "m": 0.1, "theta0": 20, "g": 1.62, "b": 0 },
      "render": "2d",
      "controls": ["L", "g"]
    }
  }
]
;
