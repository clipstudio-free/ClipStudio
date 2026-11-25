$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
Write-Host ''
Write-Host '=== ClipStudio : configuration initiale ===' -ForegroundColor Cyan
Write-Host 'Une seule fois : saisir le PROJECT URL et la PUBLISHABLE/ANON KEY de votre Supabase.'
Write-Host 'Ces valeurs seront gardees uniquement sur CE PC dans .env.local (PAS sur GitHub).'
Write-Host 'Supabase : Project Settings > Data API / API Keys.'
Write-Host ''
$url = (Read-Host 'Supabase Project URL (https://...supabase.co)').Trim().TrimEnd('/')
if ($url -notmatch '^https://[a-z0-9-]+\.supabase\.co$') {
    Write-Host 'Erreur : indiquez URL complete comme https://abcdef.supabase.co' -ForegroundColor Red
    exit 1
}
$key = (Read-Host 'Supabase publishable key (sb_publishable_... ou anon eyJ...)').Trim()
if (($key -notmatch '^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_\.\-]+)$') -or $key.Contains('YOUR_')) {
    Write-Host 'Erreur : cle publique invalide. Ne pas utiliser service_role ou secret.' -ForegroundColor Red
    exit 1
}
$front = @(
    '# Local site only. Do not upload this file.',
    "VITE_SUPABASE_URL=$url",
    "VITE_SUPABASE_PUBLISHABLE_KEY=$key",
    'VITE_GENERATOR_API_URL=http://127.0.0.1:8765'
)
[System.IO.File]::WriteAllLines((Join-Path $root '.env.local'), $front, (New-Object System.Text.UTF8Encoding($false)))
$template = Get-Content (Join-Path $root 'backend/.env.production.example') -Raw
$template = $template -replace '(?m)^SUPABASE_URL=.*$', ('SUPABASE_URL=' + $url)
$template = $template -replace '(?m)^SUPABASE_PUBLISHABLE_KEY=.*$', ('SUPABASE_PUBLISHABLE_KEY=' + $key)
$template = $template -replace '(?m)^ALLOWED_ORIGINS=.*$', 'ALLOWED_ORIGINS=https://clipstudio.ahlaouirayane79.workers.dev,http://localhost:5173,http://127.0.0.1:5173'
[System.IO.File]::WriteAllText((Join-Path $root 'backend/.env.local'), $template, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ''
Write-Host 'OK: configuration enregistree. Pas de carte bancaire ni de cle secrete.' -ForegroundColor Green
Write-Host 'Astuce : pour un domaine tunnel fixe, lire GUIDE_AR.txt avant le mode ONLINE.' -ForegroundColor Yellow
& (Join-Path $PSScriptRoot 'RACCOURCIS.ps1')
Write-Host ''
Write-Host 'Configuration terminee. Vous pouvez fermer cette fenetre.' -ForegroundColor Green
Read-Host 'Appuyez sur Entree'
