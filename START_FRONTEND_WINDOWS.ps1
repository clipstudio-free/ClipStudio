$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (!(Test-Path ".env.local")) { Write-Host "Configure .env.local first (copy .env.example)."; exit 1 }
npm ci
npm run dev
