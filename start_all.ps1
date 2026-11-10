# AI(Gemma)・Google ログイン・Bluetooth 教室を、この先生PCで使えるように、まとめて起動する。
#   .\start_all.ps1              … AIサーバー(Gemma・教室のデータ)を起動して、先生の画面を開く
#   .\start_all.ps1 -Bluetooth   … 上に加えて、Bluetooth の中継アプリも起動する(児童の Chromebook / スマホを Bluetooth でつなぐとき)
#   .\start_all.ps1 -Check       … 何も起動せず、いまの状態だけを調べて表示する
# すでに動いているものは、起動しなおさない(止めもしない)。
param([switch]$Bluetooth, [switch]$Check, [switch]$LocalClass, [int]$Port = 8787, [int]$BlePort = 0)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if ($BlePort -eq 0) { $BlePort = $Port + 1 }
if ($Port -lt 1 -or $Port -gt 65535 -or $BlePort -lt 1 -or $BlePort -gt 65535 -or $Port -eq $BlePort) { throw 'サーバーとBluetoothには別の有効なポート番号を指定してください' }
$quotedRoot = $root.Replace("'", "''")
function Say($ok, $msg) { Write-Host (('{0} {1}' -f $(if ($ok) { '✔' } else { '✖' }), $msg)) -ForegroundColor $(if ($ok) { 'Green' } else { 'Yellow' }) }
function Up($url) { try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $url).StatusCode -eq 200 } catch { $false } }
# POST して、HTTP の状態(200・401・404 など)を返す。つながらなければ 0
function PostStatus($url) {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Method Post -ContentType 'application/json' -Body '{}' $url).StatusCode }
  catch { if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
}

Write-Host "`n== 確認" -ForegroundColor Cyan
$node = Get-Command node -ErrorAction SilentlyContinue
Say ([bool]$node) ('Node.js' + $(if ($node) { " $(node --version)" } else { ':入っていません(https://nodejs.org から Node.js 22 以上を入れてください)' }))
$ollamaUp = Up 'http://localhost:11434/api/tags'
Say $ollamaUp ('Ollama(Gemma を動かすもの)' + $(if ($ollamaUp) { ' が動いています' } else { ' が動いていません(Ollama を起動し、`ollama list` に gemma4:12b があるか確かめてください)' }))
$deps = Test-Path (Join-Path $root 'server\node_modules')
Say $deps ('サーバーの部品(server\node_modules)' + $(if ($deps) { 'あり' } else { 'なし → 起動のときに、自動で入れます(ネットが要ります)' }))
$serverUp = Up "http://localhost:$Port/health"
Say $true ("AIサーバー(:$Port)は、" + $(if ($serverUp) { 'すでに動いています' } else { 'まだ動いていません' }))
# 動いているサーバーが、この友達の版か(友達の「Gemma に根拠から提案させる」の口 /api/inquiry-plan があるか)。404 なら、古い版(別のフォルダ)のサーバー
$wrongServer = $false
if ($serverUp) {
  $st = PostStatus "http://localhost:$Port/api/lab-plan"
  $wrongServer = ($st -eq 404)
  Say (-not $wrongServer) ('動いているサーバーは、提出版' + $(if ($wrongServer) { 'ではありません(実験工房のAIの口がない、別のフォルダの古い版です)' } else { 'に対応しています' }))
  if ($wrongServer) {
    Write-Host "   → そのサーバーのウィンドウで Ctrl+C を押して止めてから、このスクリプトをもう一度実行してください。" -ForegroundColor Yellow
    Write-Host "   → 止めたくないときは、別の口で起動できます:  .\start_all.ps1 -Port 8790" -ForegroundColor Yellow
  }
}
if ($Bluetooth) {
  $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
  Say ([bool]$dotnet) ('.NET SDK' + $(if ($dotnet) { " $(dotnet --version)" } else { ':入っていません(https://dotnet.microsoft.com から .NET 10 SDK を入れてください)' }))
  $relayRunning = [bool](Get-Process -Name TeacherRelay -ErrorAction SilentlyContinue)
  Say $true ('Bluetooth の中継アプリは、' + $(if ($relayRunning) { 'すでに動いています(同じパソコンで動かせるのは1つだけです)' } else { 'まだ動いていません' }))
}
if ($Check) { Write-Host "`n(確認だけです。何も起動していません)" -ForegroundColor Yellow; return }
if (-not $node) { throw 'Node.js が必要です' }
if ($wrongServer) { Write-Host "`n古い版のサーバーが動いているので、起動しませんでした(上の案内のとおり、止めるか、-Port で別の口にしてください)。" -ForegroundColor Yellow; return }

# ---- AIサーバー ----
if (-not $serverUp) {
  if (-not $deps) { Write-Host "`nサーバーの部品を入れています…" -ForegroundColor Cyan; Push-Location (Join-Path $root 'server'); try { npm.cmd ci --omit=dev; if ($LASTEXITCODE -ne 0) { throw 'サーバーの部品を入れられませんでした' } } finally { Pop-Location } }
  Write-Host "`nAIサーバーを、新しいウィンドウで起動します(このウィンドウは閉じてかまいません。サーバーのウィンドウは開いたままにします)" -ForegroundColor Cyan
  Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location -LiteralPath '$quotedRoot\server'; `$env:PORT='$Port'; `$env:RELAY_BLE_PORT='$BlePort'; npm.cmd start"
  for ($i = 0; $i -lt 40 -and -not (Up "http://localhost:$Port/health"); $i++) { Start-Sleep -Milliseconds 500 }
  Say (Up "http://localhost:$Port/health") 'AIサーバーが起動しました'
  if (-not (Up "http://localhost:$Port/health")) { throw 'サーバーのウィンドウのエラーを確認してください' }
}

# ---- Bluetooth の中継アプリ ----
if ($Bluetooth) {
  if (Get-Process -Name TeacherRelay -ErrorAction SilentlyContinue) { Say $true 'Bluetooth の中継アプリは、すでに動いています(そのまま使います)' }
  elseif (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { Say $false '.NET SDK がないので、Bluetooth の中継アプリは起動しません' }
  else {
    Write-Host "`nBluetooth の中継アプリを、新しいウィンドウで起動します(「Bluetooth の広告:Started」と出れば、待ち受けています)" -ForegroundColor Cyan
    Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location -LiteralPath '$quotedRoot\relay\TeacherRelay'; dotnet run -c Release -- --port $BlePort"
  }
}

# ---- 先生の画面 ----
$ready = try { (Invoke-RestMethod -TimeoutSec 5 "http://localhost:$Port/ready") } catch { $null }
Say ([bool]($ready -and $ready.ok)) ('Gemma(' + $(if ($ready) { $ready.model } else { '?' }) + ')が、' + $(if ($ready -and $ready.ok) { '使えます' } else { 'まだ使えません(Ollama を確かめてください)' }))
$page = "http://localhost:$Port/teacher.html"
if ($LocalClass) {
  $page += '?relay'
  Write-Host '  ・ローカル教室を開きます。Google ログインは不要です。教室のデータはこの先生PCに残ります。'
} else {
  Write-Host '  ・Google でログインして使います。'
}
Write-Host "`n先生の画面を開きます: $page" -ForegroundColor Cyan
Start-Process $page
