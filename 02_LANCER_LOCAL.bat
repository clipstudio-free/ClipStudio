@echo off
setlocal
cd /d "%~dp0"
if not exist "backend\.env.local" (
  echo Configuration necessaire : entrez vos identifiants Supabase une fois.
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0OUTILS\CONFIGURER.ps1"
)
if not exist "backend\.env.local" (echo Configuration non terminee. & pause & exit /b 1)
start "ClipStudio - Backend" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0OUTILS\BACKEND.ps1"
timeout /t 4 /nobreak >nul
start "ClipStudio - Frontend Local" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0OUTILS\FRONTEND.ps1"
endlocal
exit /b 0
