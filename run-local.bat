@echo off
setlocal
cd /d "%~dp0"

set "CODEX_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if exist "%CODEX_PYTHON%" (
  set "PYTHON_CMD=%CODEX_PYTHON%"
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    set "PYTHON_CMD=python"
  ) else (
    echo Python was not found.
    echo Install Python 3.10 or newer, then run this file again.
    pause
    exit /b 1
  )
)

echo Starting PRISM Production Scheduling with Google OR-Tools CP-SAT...
echo Open http://localhost:3001 if the browser does not open automatically.
start "" "http://localhost:3001"
"%PYTHON_CMD%" app_server.py
pause
