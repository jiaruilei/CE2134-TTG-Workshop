param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$copyPath = Join-Path $outputPath 'source-copy.pptx'
if ($copyPath -eq $sourcePath) { throw 'Choose an output directory that does not contain the source as source-copy.pptx.' }
Copy-Item -LiteralPath $sourcePath -Destination $copyPath
$powerpoint = New-Object -ComObject PowerPoint.Application
$presentation = $null
try {
    $presentation = $powerpoint.Presentations.Open($copyPath, -1, 0, 0)
    for ($i=1; $i -le $presentation.Slides.Count; $i++) {
        $presentation.Slides.Item($i).Export((Join-Path $outputPath ('slide-{0:00}.png' -f $i)), 'PNG', 1920, 1080)
    }
    # Preserve the two Appear builds; show both dates with the final build.
    $slide = $presentation.Slides.Item(2)
    foreach ($shape in $slide.Shapes) {
        if ($shape.Id -in @(11,8,10,3,6)) { $shape.Visible = 0 }
    }
    $slide.Export((Join-Path $outputPath 'slide-02-build-0.png'), 'PNG', 1920, 1080)
    foreach ($shape in $slide.Shapes) { if ($shape.Id -eq 11) { $shape.Visible = -1 } }
    $slide.Export((Join-Path $outputPath 'slide-02-build-1.png'), 'PNG', 1920, 1080)
    # Only the two long hyperlink text boxes are hidden for the live webpage layer.
    $slide = $presentation.Slides.Item(6)
    foreach ($shape in $slide.Shapes) { if ($shape.Id -in @(14,16)) { $shape.Visible = 0 } }
    $slide.Export((Join-Path $outputPath 'slide-06-web.png'), 'PNG', 1920, 1080)
    $presentation.Saved = -1
    Write-Output ('Exported {0} slides and original animation builds.' -f $presentation.Slides.Count)
}
finally {
    if ($null -ne $presentation) { $presentation.Close(); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) | Out-Null }
    if ($null -ne $powerpoint) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerpoint) | Out-Null }
}
