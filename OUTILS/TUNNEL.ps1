$ErrorActionPreference='Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
Write-Host 'ClipStudio - Cloudflare Tunnel' -ForegroundColor Cyan
if(-not (Get-Command cloudflared -ErrorAction SilentlyContinue)){
 Write-Host 'cloudflared manquant. Installer Cloudflare Tunnel CLI (voir GUIDE_AR.txt).' -ForegroundColor Red
 return
}
Write-Host 'Attendez que backend tourne sur http://127.0.0.1:8765' -ForegroundColor Yellow
$tokfile=Join-Path $root '.tunnel_token.local'
if(Test-Path $tokfile){
  $token=(Get-Content $tokfile -Raw).Trim()
  if($token){
    Write-Host 'Tunnel nomme: adresse stable selon votre configuration Cloudflare.' -ForegroundColor Green
    & cloudflared tunnel run --token $token
  }else { Write-Host 'Token vide dans .tunnel_token.local.' -ForegroundColor Red }
}else{
  Write-Host 'Tunnel temporaire : adresse https://xxxxx.trycloudflare.com change au redemarrage.' -ForegroundColor Yellow
  Write-Host 'Le site public Cloudflare doit pointer sur le lien HTTPS courant pour appeler ce backend.' -ForegroundColor Yellow
  & cloudflared tunnel --url http://127.0.0.1:8765
}
