param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility')
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security')
$resolved = (Resolve-Path -LiteralPath $Installer).Path
$hash = Get-FileHash -LiteralPath $resolved -Algorithm SHA256
$signature = Get-AuthenticodeSignature -LiteralPath $resolved
$version = (Get-Item -LiteralPath $resolved).VersionInfo
[pscustomobject]@{
  File = $resolved
  SizeBytes = (Get-Item -LiteralPath $resolved).Length
  SHA256 = $hash.Hash
  Signature = $signature.Status
  ProductName = $version.ProductName
  FileVersion = $version.FileVersion
}
