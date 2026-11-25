$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Set-Location ..
npm.cmd start
exit $LASTEXITCODE
