Add-Type -AssemblyName System.Drawing
$size = 256
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
$graphics.Clear([System.Drawing.Color]::FromArgb(31, 38, 36))

$black = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(16, 21, 18))
$darkGreen = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 102, 56))
$green = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(102, 158, 83))
$lightGreen = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(132, 190, 98))
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(246, 243, 233))

$graphics.FillRectangle($black, 27, 27, 202, 202)
$graphics.FillRectangle($darkGreen, 39, 39, 178, 178)
$graphics.FillRectangle($green, 39, 39, 147, 147)
$graphics.FillRectangle($lightGreen, 51, 51, 135, 43)
$graphics.FillRectangle($white, 76, 91, 24, 28)
$graphics.FillRectangle($white, 156, 91, 24, 28)
$graphics.FillRectangle($white, 100, 132, 56, 24)
$graphics.FillRectangle($white, 116, 156, 24, 24)

$output = Join-Path $PSScriptRoot '..\build\icon.png'
$directory = Split-Path $output -Parent
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)

$graphics.Dispose()
$bitmap.Dispose()
$black.Dispose()
$darkGreen.Dispose()
$green.Dispose()
$lightGreen.Dispose()
$white.Dispose()
