$ErrorActionPreference='Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location (Join-Path $root 'backend')
Write-Host 'ClipStudio Backend / Generator - port 8765' -ForegroundColor Cyan
if(-not (Test-Path '.env.local')){Write-Host 'Executer 00_CONFIGURER_UNE_FOIS.bat d abord.' -ForegroundColor Red; return}
if(-not (Get-Command py -ErrorAction SilentlyContinue)){Write-Host 'Python launcher manquant (installer Python 3.12).' -ForegroundColor Red;return}
& py -3.12 --version
if($LASTEXITCODE -ne 0){Write-Host 'Python 3.12 manquant : installer depuis python.org.' -ForegroundColor Red;return}
foreach($t in @('ffmpeg','ffprobe')){
 if(-not (Get-Command $t -ErrorAction SilentlyContinue)){Write-Host ('Attention: '+$t+' introuvable. Generation video impossible avant installation de FFmpeg.') -ForegroundColor Yellow}
}
$venv = Join-Path (Get-Location).Path '.venv/Scripts/python.exe'
if(-not (Test-Path $venv)){
  Write-Host 'Premiere installation: creation environnement Python...' -ForegroundColor Cyan
  & py -3.12 -m venv '.venv'
  if($LASTEXITCODE -ne 0){Write-Host 'Creation venv a echoue.' -ForegroundColor Red; return}
}
$hash=(Get-FileHash -Algorithm SHA256 'requirements.txt').Hash
$marker = '.venv/.clipstudio_requirements_sha256'
$need = (-not (Test-Path $marker)) -or ((Get-Content $marker -Raw).Trim() -ne $hash)
if($need){
 Write-Host 'Installation dependances: premier demarrage peut prendre du temps...' -ForegroundColor Cyan
 & $venv -m pip install -r requirements.txt
 if($LASTEXITCODE -ne 0){Write-Host 'Installation des dependances echouee. Lire erreur ci-dessus.' -ForegroundColor Red;return}
 [IO.File]::WriteAllText((Join-Path (Get-Location).Path $marker),$hash)
}
Write-Host 'Backend disponible sur http://127.0.0.1:8765/health' -ForegroundColor Green
& $venv -m uvicorn server:app --host 127.0.0.1 --port 8765 --workers 1
if($LASTEXITCODE -ne 0){Write-Host 'Erreur Backend. Port 8765 utilise ou dependance manquante.' -ForegroundColor Red}
