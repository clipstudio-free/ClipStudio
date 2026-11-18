@echo off
cd /d "%~dp0"
py -3.12 -m pip install -r requirements.txt
if errorlevel 1 pause & exit /b 1
py -3.12 -m uvicorn server:app --host 127.0.0.1 --port 8765
pause