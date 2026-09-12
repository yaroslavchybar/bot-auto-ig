[CmdletBinding()]
param(
  [switch]$WithUploader,
  [switch]$WithConvex,
  [switch]$UseTabs,
  [switch]$NoNewWindows
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$psExe = (Get-Process -Id $PID).Path

function Test-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)

  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-JSCommand {
  if (Test-CommandExists 'bun') {
    return 'bun'
  }

  throw 'bun is not available on PATH.'
}

function Start-DevProcess {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$Command
  )

  $banner = "Write-Host ""[$Name] working dir: $WorkingDirectory"" -ForegroundColor Cyan"
  $fullCommand = "$banner; Set-Location -LiteralPath '$WorkingDirectory'; $Command"

  if ($NoNewWindows) {
    Write-Host "[$Name] $Command" -ForegroundColor Green
    Start-Job -Name $Name -ScriptBlock {
      param($wd, $cmd)
      Set-Location -LiteralPath $wd
      powershell -NoLogo -NoProfile -NoExit -Command $cmd
    } -ArgumentList $WorkingDirectory, $Command | Out-Null
    return
  }

  Start-Process -FilePath $psExe -WorkingDirectory $WorkingDirectory -ArgumentList @(
    '-NoLogo',
    '-NoProfile',
    '-NoExit',
    '-Command',
    $fullCommand
  ) | Out-Null
}

function Open-InWindowsTerminalTabs {
  param(
    [Parameter(Mandatory = $true)][array]$Processes
  )

  if (-not (Test-CommandExists 'wt')) {
    throw 'Windows Terminal (wt.exe) is not available on PATH.'
  }

  $args = @('-w', '0')
  $first = $true

  foreach ($proc in $Processes) {
    if (-not $first) {
      $args += ';'
    }

    $encodedCommand = [Convert]::ToBase64String(
      [Text.Encoding]::Unicode.GetBytes($proc.FullCommand)
    )

    $args += @(
      'new-tab',
      '--title',
      $proc.Name,
      '-d',
      $proc.WorkingDirectory,
      $psExe,
      '-NoLogo',
      '-NoProfile',
      '-NoExit',
      '-EncodedCommand',
      $encodedCommand
    )

    $first = $false
  }

  Start-Process -FilePath 'wt.exe' -ArgumentList $args | Out-Null
}

function Assert-PathExists {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (-not (Test-Path $Path)) {
    throw $Message
  }
}

$bun = Get-JSCommand

Assert-PathExists -Path (Join-Path $repoRoot 'package.json') -Message 'Run this script from the repo root.'
Assert-PathExists -Path (Join-Path $repoRoot 'frontend\package.json') -Message 'Missing frontend/package.json.'
Assert-PathExists -Path (Join-Path $repoRoot 'server\package.json') -Message 'Missing server/package.json.'

Write-Host 'Starting local dev processes...' -ForegroundColor Yellow
Write-Host 'Frontend: http://localhost:5173' -ForegroundColor Yellow
Write-Host 'API:      http://localhost:3001' -ForegroundColor Yellow

$serverCommand = "$bun run dev"
$frontendCommand = "$bun run --filter frontend dev"

$processes = @(
  [pscustomobject]@{
    Name = 'server'
    WorkingDirectory = $repoRoot
    Command = $serverCommand
    FullCommand = "Write-Host ""[server] working dir: $repoRoot"" -ForegroundColor Cyan; Set-Location -LiteralPath '$repoRoot'; $serverCommand"
  },
  [pscustomobject]@{
    Name = 'frontend'
    WorkingDirectory = $repoRoot
    Command = $frontendCommand
    FullCommand = "Write-Host ""[frontend] working dir: $repoRoot"" -ForegroundColor Cyan; Set-Location -LiteralPath '$repoRoot'; $frontendCommand"
  }
)

if ($WithUploader) {
  Write-Host 'Uploader: http://localhost:3002' -ForegroundColor Yellow
  $uploaderCommand = "$bun run --filter anti-uploader dev"
  $processes += [pscustomobject]@{
    Name = 'datauploader'
    WorkingDirectory = $repoRoot
    Command = $uploaderCommand
    FullCommand = "Write-Host ""[datauploader] working dir: $repoRoot"" -ForegroundColor Cyan; Set-Location -LiteralPath '$repoRoot'; $uploaderCommand"
  }
}

if ($WithConvex) {
  $convexCommand = 'bunx convex dev'
  $processes += [pscustomobject]@{
    Name = 'convex'
    WorkingDirectory = $repoRoot
    Command = $convexCommand
    FullCommand = "Write-Host ""[convex] working dir: $repoRoot"" -ForegroundColor Cyan; Set-Location -LiteralPath '$repoRoot'; $convexCommand"
  }
}

if ($UseTabs) {
  Open-InWindowsTerminalTabs -Processes $processes
} else {
  foreach ($proc in $processes) {
    Start-DevProcess -Name $proc.Name -WorkingDirectory $proc.WorkingDirectory -Command $proc.Command
  }
}

Write-Host '' 
Write-Host 'Launched dev processes.' -ForegroundColor Green
Write-Host 'Options:' -ForegroundColor Green
Write-Host '  .\dev-local.ps1' -ForegroundColor Green
Write-Host '  .\dev-local.ps1 -WithUploader' -ForegroundColor Green
Write-Host '  .\dev-local.ps1 -WithUploader -WithConvex' -ForegroundColor Green
Write-Host '  .\dev-local.ps1 -UseTabs -WithUploader -WithConvex' -ForegroundColor Green
