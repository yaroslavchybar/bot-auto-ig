[CmdletBinding()]
param(
  [switch]$WithUploader,
  [switch]$WithConvex,
  [switch]$UseTabs,
  [switch]$NoNewWindows,
  [string]$PythonPath
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$psExe = (Get-Process -Id $PID).Path
$defaultVenvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'

function Test-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)

  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Resolve-PythonPath {
  param([string]$RequestedPythonPath)

  if ($RequestedPythonPath) {
    if (-not (Test-Path $RequestedPythonPath)) {
      throw "Requested PythonPath does not exist: $RequestedPythonPath"
    }
    return (Resolve-Path $RequestedPythonPath).Path
  }

  if (Test-Path $defaultVenvPython) {
    return (Resolve-Path $defaultVenvPython).Path
  }

  if (Test-CommandExists 'python') {
    return 'python'
  }

  if (Test-CommandExists 'py') {
    $pyPath = & py -3.11 -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1
    if ($pyPath) {
      $pyPath = $pyPath.ToString().Trim()
    }

    if ($pyPath -and (Test-Path -LiteralPath $pyPath)) {
      return $pyPath
    }

    return 'py'
  }

  throw 'No Python interpreter found. Create .venv or install Python 3.11+.'
}

function Get-NodeCommand {
  if (Test-CommandExists 'npm') {
    return 'npm'
  }

  throw 'npm is not available on PATH.'
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

$npm = Get-NodeCommand
$python = Resolve-PythonPath -RequestedPythonPath $PythonPath

Assert-PathExists -Path (Join-Path $repoRoot 'package.json') -Message 'Run this script from the repo root.'
Assert-PathExists -Path (Join-Path $repoRoot 'frontend\package.json') -Message 'Missing frontend/package.json.'
Assert-PathExists -Path (Join-Path $repoRoot 'server\package.json') -Message 'Missing server/package.json.'

Write-Host 'Starting local dev processes...' -ForegroundColor Yellow
Write-Host 'Frontend: http://localhost:5173' -ForegroundColor Yellow
Write-Host 'API:      http://localhost:3001' -ForegroundColor Yellow

$serverCommand = "$npm run dev"
$frontendCommand = "$npm --prefix frontend run dev"

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
  $uploaderDir = Join-Path $repoRoot 'datauploader'
  Assert-PathExists -Path $uploaderDir -Message 'Missing datauploader directory.'

  $envFile = if (Test-Path (Join-Path $repoRoot '.env.local')) {
    '..\.env.local'
  } elseif (Test-Path (Join-Path $repoRoot '.env')) {
    '..\.env'
  } else {
    $null
  }

  $uploaderCommand = "& '$python' -m uvicorn api:app --reload --host 0.0.0.0 --port 3002"
  if ($envFile) {
    $uploaderCommand += " --env-file $envFile"
  }

  Write-Host 'Uploader: http://localhost:3002' -ForegroundColor Yellow
  $processes += [pscustomobject]@{
    Name = 'datauploader'
    WorkingDirectory = $uploaderDir
    Command = $uploaderCommand
    FullCommand = "Write-Host ""[datauploader] working dir: $uploaderDir"" -ForegroundColor Cyan; Set-Location -LiteralPath '$uploaderDir'; $uploaderCommand"
  }
}

if ($WithConvex) {
  $convexCommand = 'npx convex dev'
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
Write-Host '  .\dev-local.ps1 -PythonPath C:\path\to\python.exe' -ForegroundColor Green
