// 自動生成。元のJSONを編集し、このスクリプトで更新する。
export default [
  {
    "title": "凸レンズでできる像(実像と虚像)",
    "request": "中1の凸レンズで、物体の位置を変えると像の位置や大きさがどう変わるかを見せたい",
    "config": {
      "system": "lens",
      "curriculum": { "grade": "中1", "unit": "光と音(凸レンズのはたらき)" },
      "params": { "a": 30, "f": 10, "h": 4 },
      "render": "2d",
      "controls": ["a", "f"],
      "view": { "graph": "none" }
    }
  },
  {
    "title": "焦点の内側に物体を置くと(虚像・虫めがね)",
    "request": "物体を焦点の内側に置いたときの虚像を見せたい(虫めがね)",
    "config": {
      "system": "lens",
      "curriculum": { "grade": "中1", "unit": "光と音(凸レンズのはたらき)" },
      "params": { "a": 6, "f": 10, "h": 3 },
      "render": "2d",
      "controls": ["a"],
      "view": { "graph": "none" }
    }
  }
]
;
