$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Write-Host '=== ClipStudio : verification ===' -ForegroundColor Cyan
foreach ($t in @('py','node','npm.cmd','ffmpeg','ffprobe','cloudflared')){
 $p=Get-Command $t -ErrorAction SilentlyContinue
 if($p){ Write-Host ('OK  '+$t+' -> '+$p.Source) -ForegroundColor Green }
 else{ Write-Host ('MANQUANT: '+$t) -ForegroundColor Yellow }
}
if(Get-Command py -ErrorAction SilentlyContinue){
  & py -3.12 --version
  if($LASTEXITCODE -ne 0){Write-Host 'Installer Python 3.12 depuis https://www.python.org/downloads/windows/' -ForegroundColor Yellow}
}
Write-Host 'Node.js LTS : https://nodejs.org/'
Write-Host 'FFmpeg : https://ffmpeg.org/download.html'
Write-Host 'cloudflared : https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
Write-Host ('Backend config: '+(Test-Path (Join-Path $root 'backend/.env.local')))
Write-Host ('Frontend config: '+(Test-Path (Join-Path $root '.env.local')))
Read-Host 'Appuyez sur Entree'
