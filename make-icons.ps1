# Draws Aarya's app icons (a white "A" on navy) into the site folder.
# Run from C:\dev\aarya:  powershell -ExecutionPolicy Bypass -File .\make-icons.ps1

Add-Type -AssemblyName System.Drawing

$site = Join-Path $PSScriptRoot 'site'
$navy = [System.Drawing.ColorTranslator]::FromHtml('#1f2a44')
$navyBrush = New-Object System.Drawing.SolidBrush $navy

# The letter A, drawn on a 32 x 32 grid (same shape as favicon.svg).
$outer = @(@(13.2, 5), @(18.8, 5), @(26.5, 27), @(21.9, 27), @(20.3, 22.1), @(11.7, 22.1), @(10.1, 27), @(5.5, 27))
$hole  = @(@(12.9, 18.3), @(19.1, 18.3), @(16, 8.9))

function New-Icon([string]$name, [int]$size, [double]$safe) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear($navy)

  $scale = $size / 32 * $safe
  $off = ($size - 32 * $scale) / 2

  $outerPts = foreach ($p in $outer) { [System.Drawing.PointF]::new([single]($off + $p[0] * $scale), [single]($off + $p[1] * $scale)) }
  $holePts  = foreach ($p in $hole)  { [System.Drawing.PointF]::new([single]($off + $p[0] * $scale), [single]($off + $p[1] * $scale)) }

  $g.FillPolygon([System.Drawing.Brushes]::White, [System.Drawing.PointF[]]$outerPts)
  $g.FillPolygon($navyBrush, [System.Drawing.PointF[]]$holePts)

  $path = Join-Path $site $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Host "Created $path"
}

New-Icon 'icon-192.png' 192 1.0
New-Icon 'icon-512.png' 512 1.0
New-Icon 'icon-maskable-512.png' 512 0.7   # smaller A, so Android can crop it into a circle