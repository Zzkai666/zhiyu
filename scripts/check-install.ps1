$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Set-Location ..
$root = (Get-Location).Path
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $root "release\ResearchDesk Next Setup $version.exe"
$existing = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object DisplayName -EQ 'ResearchDesk Next'
if ($existing) { throw 'Remove the existing ResearchDesk Next installation before using the isolated install test.' }
$testOutput = Join-Path $root 'test-results'
New-Item -ItemType Directory -Force -Path $testOutput | Out-Null
$destination = Join-Path $testOutput ('installed-' + [guid]::NewGuid().ToString('N'))
$exe = Join-Path $destination 'ResearchDesk Next.exe'
$uninstaller = Join-Path $destination 'Uninstall ResearchDesk Next.exe'
try {
  $process = Start-Process -FilePath $installer -ArgumentList @('/S',('/D=' + $destination)) -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0 -or !(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Installer did not create the isolated application.' }
  $env:RDNEXT_EXE = $exe
  $env:RDNEXT_RESULTS = if ($env:RDNEXT_INSTALL_RESULTS) { $env:RDNEXT_INSTALL_RESULTS } else { Join-Path $testOutput 'installed-smoke' }
  npm.cmd run test:desktop
  if ($LASTEXITCODE -ne 0) { throw 'Installed Electron smoke test failed.' }
  if ($env:RDNEXT_INSTALL_WORKSPACE -eq '1') {
    $env:RDNEXT_WORKSPACE_RESULTS = Join-Path $env:RDNEXT_RESULTS 'workspace'
    npm.cmd run test:workspace
    if ($LASTEXITCODE -ne 0) { throw 'Installed workspace smoke test failed.' }
  }
  if ($env:RDNEXT_INSTALL_READER_UX -eq '1') {
    $env:RDNEXT_UX_RESULTS = Join-Path $env:RDNEXT_RESULTS 'reader-ux'
    npm.cmd run test:reader-ux
    if ($LASTEXITCODE -ne 0) { throw 'Installed reader UX smoke test failed.' }
  }
} finally {
  if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
    $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw 'Uninstaller failed.' }
  }
}
if (Test-Path -LiteralPath $exe) { throw 'Uninstall left the test executable behind.' }
'Installation, isolated desktop test, and uninstall passed.'
