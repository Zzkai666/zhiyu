param([string]$Target)
$ErrorActionPreference='Stop'
$full=[IO.Path]::GetFullPath($Target)
if(!$full.StartsWith(([IO.Path]::GetFullPath($env:TEMP)).TrimEnd('\')+'\rdnext-installer-',[StringComparison]::OrdinalIgnoreCase)){throw 'Not an owned installer acceptance root'}
$active=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne $PID -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($full+'\',[StringComparison]::OrdinalIgnoreCase)} | Select-Object -ExpandProperty ProcessId)
$locked=@()
if(Test-Path -LiteralPath $full){foreach($file in Get-ChildItem -LiteralPath $full -Recurse -Force -File){
 try{$handle=[IO.File]::Open($file.FullName,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$handle.Dispose()}catch{$locked+=$file.Name}
}}
[pscustomobject]@{active=$active;locked=$locked}|ConvertTo-Json -Compress
