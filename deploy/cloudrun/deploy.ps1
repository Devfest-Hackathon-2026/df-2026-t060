# AIサーバー(+ Ollama)を Cloud Run に載せる手順を、順に実行する PowerShell。
#   何をするかを表示するだけ(実行しない):   .\deploy\cloudrun\deploy.ps1 -Project kyoiku-hakkason -Region asia-southeast1
#   本当に実行する:                         .\deploy\cloudrun\deploy.ps1 -Project kyoiku-hakkason -Region asia-southeast1 -Apply
# 実行すると、Google Cloud の費用がかかります(ビルドと、GPU つきの Cloud Run)。先に docs/cloudrun.md を読んでください。
# Region は、Cloud Run の GPU(L4)が使えるところを選ぶ。Cloud Run のドキュメントで確かめること。
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [Parameter(Mandatory = $true)][string]$Region,
  [string]$Model = 'gemma4:12b',
  [string]$TeacherDomains = '',
  [string]$TeacherEmails = '',
  [switch]$SkipOllamaBuild,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$repo = "$Region-docker.pkg.dev/$Project/kyozai"
$appImage = "$repo/app:latest"
$ollamaImage = "$repo/ollama:latest"

if (-not $TeacherDomains -and -not $TeacherEmails) {
  Write-Warning '使える先生(-TeacherDomains か -TeacherEmails)が決まっていません。このままだと、Google アカウントがあればだれでもAIを使えます。'
}

$steps = @(
  @{ title = '1. 必要な API を有効にする(初回だけ)'; cmd = "gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project $Project" },
  @{ title = '2. イメージの置き場をつくる(初回だけ。すでにあればエラーになるが、そのままでよい)'; cmd = "gcloud artifacts repositories create kyozai --repository-format=docker --location=$Region --project $Project"; optional = $true },
  @{ title = '3. AIサーバーのイメージをビルドする'; cmd = "gcloud builds submit --config deploy/cloudrun/cloudbuild-app.yaml --substitutions _IMAGE=$appImage --project $Project ." }
)
if (-not $SkipOllamaBuild) {
  $steps += @{ title = '4. Ollama(Gemma 入り)のイメージをビルドする(約 9GB。時間がかかる)'; cmd = "gcloud builds submit --config deploy/cloudrun/cloudbuild-ollama.yaml --substitutions _IMAGE=$ollamaImage,_MODEL=$Model --project $Project deploy/cloudrun" }
}
# サービス定義の PROJECT / REGION / 使える先生を埋めて、一時ファイルにしてデプロイする
$steps += @{ title = '5. Cloud Run にデプロイする'; special = 'deploy' }
$steps += @{ title = '6. だれでも呼べるようにする(ログインの確認と、使える先生の制限は、アプリがする)'; cmd = "gcloud run services add-iam-policy-binding kyozai-ai --region $Region --member=allUsers --role=roles/run.invoker --project $Project" }
$steps += @{ title = '7. サービスのアドレスを表示する(先生の画面の「AI」の表示から、この https://〜.run.app を入れる)'; cmd = "gcloud run services describe kyozai-ai --region $Region --project $Project --format 'value(status.url)'" }

function Write-Service {
  $yaml = Get-Content (Join-Path $root 'deploy\cloudrun\service.yaml') -Raw -Encoding UTF8
  $yaml = $yaml.Replace('REGION', $Region).Replace('PROJECT', $Project)
  $yaml = $yaml -replace '(?m)(- name: TEACHER_DOMAINS\r?\n\s+value: )".*"', "`$1`"$TeacherDomains`""
  $yaml = $yaml -replace '(?m)(- name: TEACHER_EMAILS\r?\n\s+value: )".*"', "`$1`"$TeacherEmails`""
  $tmp = Join-Path ([IO.Path]::GetTempPath()) 'kyozai-ai-service.yaml'
  [IO.File]::WriteAllText($tmp, $yaml, (New-Object Text.UTF8Encoding($false)))
  return $tmp
}

Push-Location $root
try {
  foreach ($s in $steps) {
    Write-Host "`n== $($s.title)" -ForegroundColor Cyan
    if ($s.special -eq 'deploy') {
      $tmp = Write-Service
      Write-Host "gcloud run services replace $tmp --region $Region --project $Project"
      if ($Apply) { gcloud run services replace $tmp --region $Region --project $Project; if ($LASTEXITCODE -ne 0) { throw 'デプロイに失敗しました' } }
      continue
    }
    Write-Host $s.cmd
    if ($Apply) {
      Invoke-Expression $s.cmd
      if ($LASTEXITCODE -ne 0 -and -not $s.optional) { throw "失敗しました:$($s.title)" }
    }
  }
  if (-not $Apply) { Write-Host "`n(表示しただけです。実行するには -Apply をつけてください)" -ForegroundColor Yellow }
} finally {
  Pop-Location
}
