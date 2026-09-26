$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'src')).Path
$outputRoot = Join-Path $projectRoot 'dist'
$outputFile = Join-Path $outputRoot 'manga-translation-extension.zip'

if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'manifest.json'))) {
    throw 'The extension manifest is missing.'
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
Add-Type -AssemblyName System.IO.Compression

$stream = [IO.File]::Open($outputFile, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)

try {
    foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse) {
        if ($file.Extension -notin @('.js', '.json', '.css', '.html', '.png')) {
            throw ('Unexpected file in extension source: ' + $file.Name)
        }

        $relativePath = $file.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
        $entry = $archive.CreateEntry($relativePath, [IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $inputStream = [IO.File]::OpenRead($file.FullName)

        try {
            $inputStream.CopyTo($entryStream)
        } finally {
            $inputStream.Dispose()
            $entryStream.Dispose()
        }
    }
} finally {
    $archive.Dispose()
    $stream.Dispose()
}

Write-Output ('Packaged extension: ' + $outputFile)
