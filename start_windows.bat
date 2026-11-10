@echo off
setlocal
cd /d "%~dp0"
py -3 --version >nul 2>&1
if not errorlevel 1 (
  py -3 start_local.py --open %*
) else (
  python start_local.py --open %*
)
pause
