# 先生PCで、Ollama のかわりに llama.cpp(llama-server)で gemma4:12b を動かす。
# くらべた結果(RTX 4060 Laptop 8GB):プログラムを書く速さ 11.1 → 17.9 トークン毎秒(eval/history/bench.jsonl)
#   1. Ollama のモデルを止める(GPU のメモリをあける): ollama stop gemma4:12b
#   2. この .ps1 を動かす(C:\dev\llama.cpp\bin に llama.cpp b12138 の CUDA 12.4 版を入れてある)
#   3. 別のウィンドウで: $env:LLM_BACKEND='llamacpp'; $env:LLM_BASE_URL='http://127.0.0.1:8090'; npm start
# モデルのファイルは、Ollama が持っている gemma4:12b(GGUF)をそのまま使う(もう一度ダウンロードしない)。
$llama = $env:LLAMA_SERVER; if (-not $llama) { $llama = "C:\dev\llama.cpp\bin\llama-server.exe" }
$blob = (& ollama show --modelfile gemma4:12b | Select-String -Pattern '^FROM ' | Select-Object -First 1).Line.Substring(5).Trim()
& $llama -m $blob `
  -c 16384 -np 1 `
  --port 8090 --host 127.0.0.1 `
  --jinja --no-webui --reasoning-budget 0 `
  -ngl 99 --fit off -fa on -ctk q8_0 -ctv q8_0
# -c 16384 -np 1   :文脈 16384 トークンを1人分(プログラムを書くときの長い指示が入る)
# --reasoning-budget 0:答えの前の「考える文」を出させない(出すと遅く、JSON にならない)
# -ngl 99 --fit off :全部 GPU にのせる(自動にすると一部が CPU になり、約3分の1の速さになった)
# -fa on -ctk/-ctv q8_0:文脈の記録を小さくして、GPU のメモリに収める
