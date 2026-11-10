"""JSONの内容を通常のJSモジュールとしても配る。JSON import構文に依存しない。"""
from pathlib import Path
base = Path(__file__).resolve().parent.parent / "public/js/sim2/systems"
for f in base.rglob("*.json"):
    f.with_suffix(".json.js").write_text("// 自動生成。元のJSONを編集し、このスクリプトで更新する。\nexport default " + f.read_text(encoding="utf-8") + ";\n", encoding="utf-8")
