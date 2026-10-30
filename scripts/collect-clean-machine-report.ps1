param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$Output = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'blockcast-clean-machine-report.json')
)
$ErrorActionPreference = 'Stop'
function Test-SafePath($Value) { return [bool]($Value -and (Test-Path -LiteralPath $Value)) }
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$edgeCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$edge = $edgeCandidates | Select-Object -First 1
$installDirectory = Join-Path $env:LOCALAPPDATA 'Programs\blockcast-desktop'
$appExe = Get-ChildItem $installDirectory -Filter '*.exe' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike 'Uninstall*' } | Select-Object -First 1 -ExpandProperty FullName
$shortcutShell = New-Object -ComObject WScript.Shell
$desktopShortcut = Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter '*.lnk' -File -ErrorAction SilentlyContinue | Where-Object { $shortcutShell.CreateShortcut($_.FullName).TargetPath -like '*\Programs\blockcast-desktop\*.exe' } | Select-Object -First 1 -ExpandProperty FullName
$startShortcut = Get-ChildItem (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') -Filter '*.lnk' -File -ErrorAction SilentlyContinue | Where-Object { $shortcutShell.CreateShortcut($_.FullName).TargetPath -like '*\Programs\blockcast-desktop\*.exe' } | Select-Object -First 1 -ExpandProperty FullName
$os = Get-CimInstance Win32_OperatingSystem
$video = Get-CimInstance Win32_VideoController | Select-Object -First 1
$logPixels = (Get-ItemProperty 'HKCU:\Control Panel\Desktop' -Name LogPixels -ErrorAction SilentlyContinue).LogPixels
$report = [ordered]@{
  schemaVersion = 1
  generatedAt = (Get-Date).ToString('o')
  os = [ordered]@{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber; architecture = $os.OSArchitecture }
  display = [ordered]@{ width = $video.CurrentHorizontalResolution; height = $video.CurrentVerticalResolution; scalePercent = if ($logPixels) { [math]::Round($logPixels / 96 * 100) } else { 100 } }
  edge = [ordered]@{ found = [bool]$edge; version = if ($edge) { (Get-Item -LiteralPath $edge).VersionInfo.ProductVersion } else { $null } }
  installer = [ordered]@{ file = (Split-Path $installerPath -Leaf); sizeBytes = (Get-Item -LiteralPath $installerPath).Length; sha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash; signature = (Get-AuthenticodeSignature -LiteralPath $installerPath).Status.ToString() }
  installation = [ordered]@{ appExists = Test-SafePath $appExe; appVersion = if (Test-SafePath $appExe) { (Get-Item -LiteralPath $appExe).VersionInfo.ProductVersion } else { $null }; desktopShortcut = Test-SafePath $desktopShortcut; startMenuShortcut = Test-SafePath $startShortcut }
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Output -Encoding utf8
Write-Host "Report written: $Output"
