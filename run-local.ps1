$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$codexPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if (Test-Path $codexPython) {
  $pythonExe = $codexPython
} elseif ($pythonCommand = Get-Command python -ErrorAction SilentlyContinue) {
  $pythonExe = $pythonCommand.Source
} else {
  Write-Host "Python was not found. Install Python 3.10 or newer, then run this script again."
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host "Starting PRISM Production Scheduling with Google OR-Tools CP-SAT..."
Write-Host "Open http://localhost:3001 if the browser does not open automatically."
Start-Process "http://localhost:3001"
& $pythonExe app_server.py
