$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$desktop = [Environment]::GetFolderPath('Desktop')
$wsh = New-Object -ComObject WScript.Shell
$specs = @(
   @{Title='ClipStudio - LOCAL';File='02_LANCER_LOCAL.bat'},
   @{Title='ClipStudio - ONLINE';File='03_LANCER_ONLINE.bat'}
)
foreach($s in $specs){
   $link = $wsh.CreateShortcut((Join-Path $desktop ($s.Title + '.lnk')))
   $link.TargetPath = (Join-Path $root $s.File)
   $link.WorkingDirectory = $root
   $link.IconLocation = (Join-Path $root 'ClipStudio.ico')
   $link.Description = 'ClipStudio one-click launcher'
   $link.Save()
   Write-Host ('Desktop shortcut created: ' + $s.Title) -ForegroundColor Green
}
