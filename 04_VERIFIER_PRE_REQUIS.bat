@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0OUTILS\VERIFIER.ps1"
