$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "backend")
if (!(Test-Path ".env.local")) { Write-Host "Configure backend/.env.local first (copy .env.production.example)."; exit 1 }
py -3.12 -m pip install -r requirements.txt
py -3.12 -m uvicorn server:app --host 127.0.0.1 --port 8765 --workers 1
