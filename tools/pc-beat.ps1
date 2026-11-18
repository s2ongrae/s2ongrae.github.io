<#
  pc-beat — 회사 PC 를 포털 관제(💻 회사 PC 카드)에 1줄로 알리는 도구

  · 공개 저장소에 두는 파일이라 키·주소가 없다. 키는 이 PC 의 사용자 폴더에만 둔다:
      %USERPROFILE%\.portal-beat.json   { "url": "...", "key": "..." }
    (또는 환경변수 PC_BEAT_URL · PC_BEAT_KEY — 화면에 찍지 않는다)
  · 보내는 것: 상태(working|idle) · 프로젝트 · 작업명(60자, 전화·메일·주민번호·키 모양은 가림) · 기준 분
  · 못 보내도 조용히 넘어간다(작업을 막지 않는다). 커밋 훅은 백그라운드로만 돈다.

  쓰는 법 (PowerShell):
    pcbeat setup                  처음 한 번 — 주소·키를 받아 이 PC 에만 저장
    pcbeat start "상품 상세페이지 수정" [smartstore]   작업 시작
    pcbeat done                   작업 끝
    pcbeat hook                   지금 폴더 git 에 post-commit 훅 설치(커밋할 때 자동 알림)
    pcbeat test                   저장한 설정으로 한 번 보내 보기
    pcbeat status                 설정이 있는지만 확인(키는 안 보여줌)

  처음 설치(포털이 만들어 주는 1줄):
    irm https://s2ongrae.github.io/tools/pc-beat.ps1 -OutFile "$env:LOCALAPPDATA\pc-beat.ps1"; & "$env:LOCALAPPDATA\pc-beat.ps1" setup
#>

param(
  [Parameter(Position = 0)][string] $Command = 'help',
  [Parameter(Position = 1)][string] $Arg1 = '',
  [Parameter(Position = 2)][string] $Arg2 = ''
)

$ErrorActionPreference = 'Stop'
$ConfigPath = Join-Path $env:USERPROFILE '.portal-beat.json'
$StaleManual = 30          # 직접 표시(start)는 30분 조용하면 '미확인'
$StaleCommit = 120         # 커밋 알림은 커밋 간격이 길어 120분
$TaskMax = 60
$ProjectOf = @{
  'smartstore-hub'    = 'smartstore'
  'content-hub'       = 'content'
  'gaegyebu'          = 'gaegyebu'
  'insurance-manager' = 'insurance'
  's2ongrae.github.io'= 'portal'
  'hub-agent'         = 'portal'
}

# <PCBEAT_MASK>
$MaskPatterns = @(
  '(?<!\d)01[016789][-\s]?\d{3,4}[-\s]?\d{4}(?!\d)',
  '[\w.+-]+@[\w-]+(\.[\w-]+)+',
  '(?<!\d)\d{6}[-\s]?[1-4]\d{6}(?!\d)',
  '(?<![0-9a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-fA-F])'
)
# </PCBEAT_MASK>

function Show-Usage {
  Write-Host ''
  Write-Host ' pc-beat — 회사 PC 상태를 포털 관제에 알린다' -ForegroundColor Cyan
  Write-Host '   pcbeat setup                     처음 한 번(주소·키 저장)'
  Write-Host '   pcbeat start "작업명" [프로젝트]   작업 시작'
  Write-Host '   pcbeat done                      작업 끝'
  Write-Host '   pcbeat hook                      지금 폴더 git 에 커밋 훅 설치'
  Write-Host '   pcbeat test                      한 번 보내 보기'
  Write-Host '   pcbeat status                    설정 확인(키는 안 보여줌)'
  Write-Host ''
}

# 작업명에서 전화·메일·주민번호·키 모양을 지우고 60자로 자른다
function Mask-Text([string] $Text, [int] $Max) {
  $t = [string] $Text
  foreach ($p in $MaskPatterns) { $t = [regex]::Replace($t, $p, '***') }
  $t = $t -replace '\s+', ' '
  $t = $t.Trim()
  if ($t.Length -gt $Max) { $t = $t.Substring(0, $Max) }
  return $t
}

function Read-Config {
  $url = [string] $env:PC_BEAT_URL
  $key = [string] $env:PC_BEAT_KEY
  if ((Test-Path $ConfigPath) -and (-not $url -or -not $key)) {
    try {
      $c = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
      if (-not $url) { $url = [string] $c.url }
      if (-not $key) { $key = [string] $c.key }
    } catch { }
  }
  if (-not $url -or -not $key) { return $null }
  return @{ url = $url; key = $key }
}

# 한 줄 알림. 실패해도 예외를 던지지 않는다(커밋·작업을 막지 않는다)
function Send-Beat {
  param(
    [string] $State,
    [string] $Project = '',
    [string] $Task = '',
    [string] $Source = 'manual',
    [int] $StaleMin = $StaleManual,
    [switch] $Quiet
  )
  $cfg = Read-Config
  if (-not $cfg) {
    if (-not $Quiet) { Write-Host ' 설정이 없어요 — 먼저: pcbeat setup' -ForegroundColor Yellow }
    return $false
  }
  $body = @{
    action    = 'agent_beat'
    key       = $cfg.key
    target    = 'pc'
    state     = $State
    project   = [string] $Project
    task      = (Mask-Text $Task $TaskMax)
    source    = $Source
    stale_min = $StaleMin
  } | ConvertTo-Json -Compress
  try {
    $res = Invoke-RestMethod -Uri $cfg.url -Method Post -ContentType 'application/json; charset=utf-8' `
      -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 10 -UseBasicParsing
    if ($res -and $res.ok -eq $true) {
      if (-not $Quiet) { Write-Host (' 보냈어요 · ' + $State + ' · ' + (Mask-Text $Task $TaskMax)) -ForegroundColor Green }
      return $true
    }
    if (-not $Quiet) { Write-Host (' 서버가 거절했어요: ' + [string] $res.error) -ForegroundColor Yellow }
  } catch {
    if (-not $Quiet) { Write-Host (' 못 보냈어요: ' + $_.Exception.Message) -ForegroundColor Yellow }
  }
  return $false
}

# 지금 폴더의 git 저장소 이름 → 포털 프로젝트 id
function Get-ProjectOf {
  param([string] $Root)
  $name = ''
  if ($Root) { $name = Split-Path -Leaf $Root }
  if ($ProjectOf.ContainsKey($name)) { return $ProjectOf[$name] }
  return 'life'
}

function Invoke-Setup {
  Write-Host ' 포털 서버 주소와 키를 이 PC 에만 저장해요(레포·커밋에는 남기지 않아요).' -ForegroundColor Cyan
  $url = Read-Host ' 서버 주소 (Apps Script 웹 앱 URL)'
  $sec = Read-Host ' 서버 키 (화면에 안 보여요)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if (-not $url -or -not $key) { Write-Host ' 주소·키가 비어 있어 저장하지 않았어요.' -ForegroundColor Yellow; return }
  $obj = @{ url = $url.Trim(); key = $key.Trim() }
  $json = $obj | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($ConfigPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host (' 저장했어요: ' + $ConfigPath) -ForegroundColor Green

  # 이 파일을 사용자 폴더로 복사해 두면 어느 폴더에서든 부를 수 있어요
  $self = $PSCommandPath
  $target = Join-Path $env:LOCALAPPDATA 'pc-beat.ps1'
  if ($self -and ($self -ne $target) -and (Test-Path $self)) {
    Copy-Item -Path $self -Destination $target -Force
    Write-Host (' 복사했어요: ' + $target) -ForegroundColor Green
  }

  # 프로필에 pcbeat 한 줄 별칭(이미 있으면 건너뜀)
  $line = 'function pcbeat { & "' + $target + '" @args }'
  try {
    if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force | Out-Null }
    $prof = Get-Content -Raw -Path $PROFILE
    if ($prof -notmatch 'function pcbeat') {
      Add-Content -Path $PROFILE -Value $line -Encoding UTF8
      Write-Host ' 프로필에 pcbeat 명령을 넣었어요(새 창부터 적용).' -ForegroundColor Green
    }
  } catch { Write-Host ' 프로필 설정은 건너뛰었어요(권한).' -ForegroundColor Yellow }

  Write-Host ''
  Write-Host ' 이제 한 번 보내 볼까요?' -ForegroundColor Cyan
  if (Send-Beat -State 'idle' -Source 'manual') {
    Write-Host ' 좋아요. 이제 이렇게 쓰면 돼요:' -ForegroundColor Green
    Write-Host '   pcbeat start "작업명" [프로젝트]'
    Write-Host '   pcbeat done'
    Write-Host '   pcbeat hook      (지금 폴더 레포에 커밋 훅)'
  }
}

function Invoke-Hook {
  $root = ''
  try { $root = (git rev-parse --show-toplevel 2>$null) } catch { $root = '' }
  if (-not $root) { Write-Host ' 지금 폴더가 git 저장소가 아니에요.' -ForegroundColor Yellow; return }
  $hooks = Join-Path $root '.git/hooks'
  if (-not (Test-Path $hooks)) { New-Item -ItemType Directory -Path $hooks -Force | Out-Null }
  $hookPath = Join-Path $hooks 'post-commit'
  $target = Join-Path $env:LOCALAPPDATA 'pc-beat.ps1'
  $lines = @(
    '#!/bin/sh',
    '# 포털 관제 — 커밋할 때 회사 PC 상태를 백그라운드로 알린다(커밋은 기다리지 않음)',
    'PSB="' + ($target -replace '\\', '/') + '"',
    'if [ -f "$PSB" ]; then',
    '  powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PSB" commit >/dev/null 2>&1 &',
    'fi',
    'exit 0'
  )
  if (Test-Path $hookPath) {
    $old = Get-Content -Raw -Path $hookPath
    if ($old -match 'pc-beat') { Write-Host ' 이미 커밋 훅이 있어요.' -ForegroundColor Yellow; return }
    Copy-Item -Path $hookPath -Destination ($hookPath + '.bak') -Force
    Write-Host (' 기존 훅은 ' + $hookPath + '.bak 로 백업했어요.') -ForegroundColor Yellow
  }
  [System.IO.File]::WriteAllText($hookPath, ($lines -join "`n") + "`n")
  Write-Host (' 커밋 훅을 설치했어요: ' + $hookPath) -ForegroundColor Green
  Write-Host ' 이제 이 폴더에서 git commit 하면 커밋 제목이 포털 💻 회사 PC 카드에 자동으로 떠요.'
}

function Invoke-Status {
  $cfg = Read-Config
  if (-not $cfg) {
    Write-Host ' 설정 없음 — pcbeat setup 으로 주소·키를 저장하세요.' -ForegroundColor Yellow
    Write-Host (' 저장 위치: ' + $ConfigPath)
    return
  }
  $host_ = ''
  try { $host_ = ([System.Uri] $cfg.url).Host } catch { $host_ = '(주소 형식 확인 필요)' }
  Write-Host (' 설정 있음 · 서버 도메인: ' + $host_ + ' · 키 길이: ' + $cfg.key.Length) -ForegroundColor Green
  Write-Host (' 저장 위치: ' + $ConfigPath)
}

switch ($Command.ToLower()) {
  'setup'   { Invoke-Setup }
  'start'   {
    $root = ''
    try { $root = (git rev-parse --show-toplevel 2>$null) } catch { $root = '' }
    $proj = $Arg2
    if (-not $proj) { $proj = Get-ProjectOf $root }
    $task = $Arg1
    if (-not $task) { $task = (Split-Path -Leaf $root) + ' 작업' }
    Send-Beat -State 'working' -Project $proj -Task $task -Source 'manual' -StaleMin $StaleManual | Out-Null
  }
  'done'    { Send-Beat -State 'idle' -Source 'manual' | Out-Null }
  'off'     { Send-Beat -State 'idle' -Source 'manual' | Out-Null }
  'commit'  {
    $root = ''
    try { $root = (git rev-parse --show-toplevel 2>$null) } catch { $root = '' }
    $subject = ''
    try { $subject = (git log -1 --pretty=%s 2>$null) } catch { $subject = '' }
    if (-not $subject) { $subject = '커밋' }
    Send-Beat -State 'working' -Project (Get-ProjectOf $root) -Task $subject -Source 'commit' -StaleMin $StaleCommit -Quiet | Out-Null
  }
  'hook'    { Invoke-Hook }
  'test'    { Send-Beat -State 'idle' -Source 'manual' | Out-Null }
  'status'  { Invoke-Status }
  default   { Show-Usage }
}
