$ErrorActionPreference='Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
Write-Host 'ClipStudio Frontend Local - http://localhost:5173' -ForegroundColor Cyan
if(-not (Test-Path '.env.local')){Write-Host 'Executer 00_CONFIGURER_UNE_FOIS.bat d abord.' -ForegroundColor Red;return}
if(-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)){Write-Host 'Node.js/npm manquant. Installer Node.js LTS depuis nodejs.org.' -ForegroundColor Red;return}
if(-not (Test-Path 'node_modules/vite')){
  Write-Host 'Premiere installation: npm ci...' -ForegroundColor Cyan
  & npm.cmd ci
  if($LASTEXITCODE -ne 0){Write-Host 'npm ci a echoue.' -ForegroundColor Red;return}
}
# Open the browser when Vite responds, without copying URLs or commands.
$job=Start-Job -ScriptBlock {
 for($i=0;$i -lt 90;$i++){
   try {$tcp=New-Object Net.Sockets.TcpClient('127.0.0.1',5173);$tcp.Close();Start-Process 'http://localhost:5173';break}
   catch{Start-Sleep -Seconds 2}
 }
}
Write-Host 'Site local : http://localhost:5173' -ForegroundColor Green
& npm.cmd run dev -- --host 127.0.0.1
if($LASTEXITCODE -ne 0){Write-Host 'Erreur Frontend.' -ForegroundColor Red}
