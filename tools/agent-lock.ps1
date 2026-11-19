<#
  agent-lock — 같은 레포를 두 에이전트(세션)가 동시에 고치지 않게 하는 도구

  · 공개 파일이라 키·주소·개인정보가 없다. 규칙 전체는 docs/AGENT_COORDINATION.md.
  · 잠금 표시는 레포의 .git 안(agent.lock)에만 만든다 → git 에 올라가지 않는다.
  · 잠금은 "같은 기기" 안의 세션끼리 막는 장치다. 기기끼리는 GitHub(pull --ff-only / push)로 맞춘다.

  쓰는 법 (PowerShell):
    agent-lock status [루트폴더]            루트 아래 모든 레포의 잠금·브랜치·변경 수
    agent-lock lock   <레포> "작업명"        레포를 쓰기 시작(이미 쓰는 세션이 있으면 거절, 종료코드 2)
    agent-lock unlock <레포> [-Force]       다 썼다고 표시(내 잠금만, -Force 면 남의 것도)
    agent-lock wt     <레포> <작업이름>      병렬용 워크트리 + 브랜치 agent/<기기>/<작업이름> 만들기
    agent-lock wtdone <레포> <작업이름>      워크트리 작업을 main 에 합치고 푸시 → 워크트리 정리

  <레포> 는 이름(루트 아래 폴더)이나 경로. 루트는 환경변수 AGENT_ROOT(없으면 현재 폴더의 상위).
  워크트리는 로컬 디스크에 만든다: AGENT_WT_ROOT(기본 %USERPROFILE%\agent-wt). 드라이브 폴더 안에 만들지 않는다.
#>

#  ※ 이 파일은 UTF-8(BOM)로 저장합니다 — 윈도우 파워셸 5.1 이 한글을 바르게 읽으려면 BOM 이 필요해요.

param(
  [Parameter(Position = 0)][string] $Command = 'help',
  [Parameter(Position = 1)][string] $Repo = '',
  [Parameter(Position = 2)][string] $Task = '',
  [switch] $Force
)

$ErrorActionPreference = 'Stop'
$StaleHours = 6
$Device = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'pc' }
$WtRoot = if ($env:AGENT_WT_ROOT) { $env:AGENT_WT_ROOT } else { Join-Path $env:USERPROFILE 'agent-wt' }

function Find-GitRoot([string] $start) {
  $d = (Resolve-Path -LiteralPath $start -ErrorAction Stop).Path
  while ($d) {
    if (Test-Path -LiteralPath (Join-Path $d '.git')) { return $d }
    $p = Split-Path -Parent $d
    if (-not $p -or $p -eq $d) { break }
    $d = $p
  }
  return $null
}

function Resolve-Repo([string] $name) {
  if (-not $name) { return Find-GitRoot (Get-Location).Path }
  if (Test-Path -LiteralPath $name) { return Find-GitRoot $name }
  $root = if ($env:AGENT_ROOT) { $env:AGENT_ROOT } else { Split-Path -Parent (Get-Location).Path }
  $cand = Join-Path $root $name
  if (Test-Path -LiteralPath $cand) { return Find-GitRoot $cand }
  return $null
}

function Get-GitDir([string] $root) {
  $g = Join-Path $root '.git'
  if (Test-Path -LiteralPath $g -PathType Container) { return $g }
  $line = (Get-Content -LiteralPath $g -TotalCount 1)
  if ($line -match '^gitdir:\s*(.+)$') { return $Matches[1].Trim() }
  return $null
}

function Invoke-Git([string] $root, [string[]] $a) {
  $ErrorActionPreference = 'Continue'   # 파워셸 5.1: git 이 stderr 로 쓰는 진행 메시지를 오류로 보지 않게
  $out = & git.exe -C $root @a 2>&1
  if ($LASTEXITCODE -ne 0) { throw ("git " + ($a -join ' ') + " 실패: " + ($out -join ' ')) }
  return $out
}

function Read-Lock([string] $root) {
  $f = Join-Path (Get-GitDir $root) 'agent.lock'
  if (-not (Test-Path -LiteralPath $f)) { return $null }
  try { return (Get-Content -LiteralPath $f -Raw | ConvertFrom-Json) } catch { return $null }
}

function Test-LockStale($lock) {
  if (-not $lock) { return $true }
  $since = [datetime]::Parse($lock.since)
  if (((Get-Date) - $since).TotalHours -gt $StaleHours) { return $true }
  if ($lock.device -eq $Device -and $lock.pid) {
    if (-not (Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue)) { return $true }
  }
  return $false
}

function Get-OwnerPid {
  # 이 스크립트를 부른 쪽(보통 claude/셸)의 PID — 죽었는지로 낡은 잠금을 가린다
  try { return (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId } catch { return $PID }
}

function Show-Usage {
  Write-Host ''
  Write-Host ' agent-lock — 같은 레포 동시 작업 방지' -ForegroundColor Cyan
  Write-Host '   agent-lock status [루트]'
  Write-Host '   agent-lock lock   <레포> "작업명"'
  Write-Host '   agent-lock unlock <레포> [-Force]'
  Write-Host '   agent-lock wt     <레포> <작업이름>'
  Write-Host '   agent-lock wtdone <레포> <작업이름>'
  Write-Host ''
}

switch ($Command) {
  'status' {
    $root = if ($Repo) { $Repo } elseif ($env:AGENT_ROOT) { $env:AGENT_ROOT } else { Split-Path -Parent (Get-Location).Path }
    Get-ChildItem -LiteralPath $root -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName '.git') } | ForEach-Object {
      $r = $_.FullName
      $branch = (& git.exe -C $r branch --show-current 2>$null)
      $dirty = @(& git.exe -C $r status --short 2>$null).Count
      $lock = Read-Lock $r
      $state = '비어 있음'
      if ($lock) {
        if (Test-LockStale $lock) { $state = "낡은 잠금($($lock.device) · $($lock.task))" }
        else { $state = "사용 중 — $($lock.device) · $($lock.task) · $($lock.since)" }
      }
      Write-Host ("{0,-22} {1,-10} 변경 {2,3}  {3}" -f $_.Name, $branch, $dirty, $state)
    }
  }
  'lock' {
    $r = Resolve-Repo $Repo
    if (-not $r) { Write-Host '레포를 못 찾았어요.' -ForegroundColor Red; exit 1 }
    $lock = Read-Lock $r
    $me = Get-OwnerPid
    if ($lock -and -not (Test-LockStale $lock) -and -not ($lock.device -eq $Device -and [int]$lock.pid -eq [int]$me)) {
      Write-Host ("이미 쓰는 세션이 있어요: {0} · {1} · {2}" -f $lock.device, $lock.task, $lock.since) -ForegroundColor Yellow
      Write-Host ('→ 병렬로 해야 하면 워크트리: agent-lock wt "' + (Split-Path -Leaf $r) + '" <작업이름>') -ForegroundColor Yellow
      exit 2
    }
    $obj = [ordered]@{ device = $Device; pid = [int]$me; task = $Task; since = (Get-Date).ToString('s') }
    ($obj | ConvertTo-Json -Compress) | Set-Content -LiteralPath (Join-Path (Get-GitDir $r) 'agent.lock') -Encoding UTF8
    Write-Host ("잠금: {0} ← {1}" -f (Split-Path -Leaf $r), $Task) -ForegroundColor Green
  }
  'unlock' {
    $r = Resolve-Repo $Repo
    if (-not $r) { Write-Host '레포를 못 찾았어요.' -ForegroundColor Red; exit 1 }
    $lock = Read-Lock $r
    if (-not $lock) { Write-Host '잠금이 없어요.'; break }
    $mine = ($lock.device -eq $Device)
    if (-not $mine -and -not $Force) { Write-Host '다른 기기의 잠금이에요. 정말 풀려면 -Force.' -ForegroundColor Yellow; exit 2 }
    Remove-Item -LiteralPath (Join-Path (Get-GitDir $r) 'agent.lock') -Force
    Write-Host '풀었어요.' -ForegroundColor Green
  }
  'wt' {
    $r = Resolve-Repo $Repo
    if (-not $r) { Write-Host '레포를 못 찾았어요.' -ForegroundColor Red; exit 1 }
    if ($Task -notmatch '^[A-Za-z0-9._-]+$') { Write-Host '작업이름은 영문·숫자·.-_ 만 쓰세요.' -ForegroundColor Red; exit 1 }
    $name = Split-Path -Leaf $r
    $branch = "agent/$($Device.ToLower())/$Task"
    $path = Join-Path $WtRoot "$name-$Task"
    if (Test-Path -LiteralPath $path) { Write-Host "이미 있어요: $path" -ForegroundColor Yellow; exit 2 }
    Invoke-Git $r @('pull', '--ff-only') | Out-Null
    New-Item -ItemType Directory -Force -Path $WtRoot | Out-Null
    Invoke-Git $r @('worktree', 'add', '-b', $branch, $path) | Out-Null
    Write-Host "워크트리: $path" -ForegroundColor Green
    Write-Host "브랜치:   $branch"
    Write-Host '→ 이 폴더에서 새 세션을 열어 작업하세요. 끝나면 테스트 후: agent-lock wtdone' -ForegroundColor Cyan
  }
  'wtdone' {
    $r = Resolve-Repo $Repo
    if (-not $r) { Write-Host '레포를 못 찾았어요.' -ForegroundColor Red; exit 1 }
    $name = Split-Path -Leaf $r
    $branch = "agent/$($Device.ToLower())/$Task"
    $path = Join-Path $WtRoot "$name-$Task"
    if (-not (Test-Path -LiteralPath $path)) { Write-Host "워크트리가 없어요: $path" -ForegroundColor Red; exit 1 }
    if (@(& git.exe -C $path status --short).Count -gt 0) { Write-Host '커밋 안 한 변경이 있어요. 먼저 커밋하세요.' -ForegroundColor Yellow; exit 2 }
    Invoke-Git $r @('fetch', '--quiet') | Out-Null
    try { Invoke-Git $path @('rebase', 'origin/main') | Out-Null }
    catch { & git.exe -C $path rebase --abort 2>$null; Write-Host 'main 위로 합치다 충돌 — 중단했어요. 사람이 확인하세요.' -ForegroundColor Red; exit 3 }
    Write-Host '※ 합치기 전에 이 워크트리에서 테스트가 통과했는지 확인했나요? (안 했다면 Ctrl+C)' -ForegroundColor Yellow
    Invoke-Git $r @('pull', '--ff-only') | Out-Null
    try { Invoke-Git $r @('merge', '--ff-only', $branch) | Out-Null }
    catch { Write-Host 'main 이 그사이 앞서갔어요(ff 불가). 다시 wtdone 하면 한 번 더 rebase 해요.' -ForegroundColor Red; exit 3 }
    Invoke-Git $r @('push') | Out-Null
    Invoke-Git $r @('worktree', 'remove', $path) | Out-Null
    Invoke-Git $r @('branch', '-d', $branch) | Out-Null
    Write-Host '합치고 푸시했어요. 워크트리·브랜치 정리 끝.' -ForegroundColor Green
  }
  default { Show-Usage }
}
