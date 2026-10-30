$ErrorActionPreference = 'Stop'
# npm may launch Windows PowerShell with a PowerShell 7-only module search path.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility')
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security')
$project = Split-Path $PSScriptRoot -Parent
Push-Location $project
try {
  & (Join-Path $PSScriptRoot 'generate-icon.ps1')
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
  $electronPackage = Get-Content (Join-Path $project 'node_modules\electron\package.json') -Raw | ConvertFrom-Json
  $electronVersion = $electronPackage.version
  $electronDist = Join-Path $project 'node_modules\electron\dist'
  if (-not (Test-Path (Join-Path $electronDist 'electron.exe'))) {
    $zipName = "electron-v$electronVersion-win32-x64.zip"
    $zip = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'electron\Cache') -Recurse -Filter $zipName -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $zip) { throw "Electron runtime cache was not found: $zipName. Run npm install with network access first." }
    $electronDist = Join-Path $env:TEMP "blockcast-electron-$electronVersion-win32-x64"
    if (-not (Test-Path (Join-Path $electronDist 'electron.exe'))) {
      if (Test-Path $electronDist) { Remove-Item -LiteralPath $electronDist -Recurse -Force }
      Expand-Archive -LiteralPath $zip.FullName -DestinationPath $electronDist
    }
  }
  & node (Join-Path $project 'node_modules\electron-builder\cli.js') --win nsis --publish never "--config.electronDist=$electronDist"
  if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }

  $installer = Get-ChildItem (Join-Path $project 'dist') -Filter 'Blockcast-Studio-Setup-*.exe' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $installer) { throw 'Installer artifact was not found' }

  $hash = Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256
  "$($hash.Hash)  $($installer.Name)" | Set-Content -LiteralPath (Join-Path $project 'dist\SHA256SUMS.txt') -Encoding ascii
  $signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
  [pscustomobject]@{
    Artifact = $installer.Name
    SizeBytes = $installer.Length
    SHA256 = $hash.Hash
    SignatureStatus = $signature.Status.ToString()
    BuiltAt = (Get-Date).ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $project 'dist\release-manifest.json') -Encoding utf8

  Write-Host "Release built: $($installer.FullName)"
  Write-Host "SHA256: $($hash.Hash)"
  Write-Host "Signature: $($signature.Status)"
} finally {
  Pop-Location
}
