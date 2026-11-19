@echo off
cd /d "%~dp0"
py -3.12 --version >nul 2>&1
if errorlevel 1 (
  echo Python 3.12 required. Install Python 3.12, not 3.15.
  pause
  exit /b 1
)
py -3.12 -m pip install -r requirements.txt
if errorlevel 1 (
  pause
  exit /b 1
)
py -3.12 -m uvicorn server:app --host 127.0.0.1 --port 8765 --workers 1
pause
