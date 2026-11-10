// 自動生成。元のJSONを編集し、このスクリプトで更新する。
export default [
  {
    "title": "自由落下(高さ20mから落とす)",
    "request": "中3の運動の規則性で、物体を高いところから落とす自由落下を見せたい",
    "config": {
      "system": "projectile",
      "curriculum": { "grade": "中3", "unit": "運動の規則性" },
      "params": { "h0": 20, "v0": 0, "angle": 0, "m": 1, "g": 9.8 },
      "render": "2d",
      "controls": ["h0", "g", "m"]
    }
  },
  {
    "title": "斜め上に投げたボールの運動(投射)",
    "request": "中3の力学的エネルギーで、ボールを斜め上に投げたときのエネルギーの変化を見せたい",
    "config": {
      "system": "projectile",
      "curriculum": { "grade": "中3", "unit": "力学的エネルギー" },
      "params": { "h0": 0, "v0": 20, "angle": 45, "m": 1, "g": 9.8 },
      "render": "2d",
      "controls": ["v0", "angle", "g"]
    }
  }
]
;
