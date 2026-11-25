param([switch]$Execute)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if($root -ne 'D:\APP\重构'){throw 'Unexpected workspace'}
$reports=@('settings-host-prototype','planner-settings-0.7.0','native-settings-0.7.0','reading-0.7.0','export-0.7.0','portable-launch-0.7.0','portable-launch-final-0.7.0','island-0.7.0')
$targets=[Collections.Generic.List[string]]::new()
foreach($name in $reports){
 $base=Join-Path $root "test-results\$name"
 if(Test-Path -LiteralPath $base){foreach($dir in Get-ChildItem -LiteralPath $base -Directory -Filter 'isolated-*'){$targets.Add($dir.FullName)}}
}
# Only this round's accidental legacy output, as recorded by its actual summary.
$legacy=Join-Path $root 'test-results\island-0.6.0\summary.json'
if(Test-Path -LiteralPath $legacy){$record=Get-Content -LiteralPath $legacy -Raw|ConvertFrom-Json;if($record.root -and ([IO.DirectoryInfo]$record.root).CreationTime -gt [datetime]'2026-11-13T18:00:00'){$targets.Add($record.root)}}
foreach($name in @('portable-0.7.0-build','final-0.7.0-build','delivery-0.7.0-build')){$target=Join-Path $root "release\$name";if(Test-Path -LiteralPath $target){$targets.Add($target)}}
$old=Join-Path $root 'release\ResearchDesk Next 0.6.0.exe'
if(Test-Path -LiteralPath $old){if((Get-FileHash -LiteralPath $old -Algorithm SHA256).Hash -ne '06A12A31AD1AFD5D98E0F05DEAef38EDF5527EDE9D97A59171AF9893303687C6'){throw 'Old release hash changed'};$targets.Add($old)}
foreach($prefix in @('rdnext-installer-*','rdnext-installer-probe-*')){
 foreach($t in Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter $prefix){
  if($t.CreationTime -le [datetime]'2026-11-13T18:00:00'){continue}
  $setup=Join-Path $t.FullName 'Setup.exe';$probe=Join-Path $t.FullName 'Probe.exe'
  if((Test-Path -LiteralPath $setup) -or (Test-Path -LiteralPath $probe)){$targets.Add($t.FullName)}
 }
}
foreach($file in @('scripts\settings-host-prototype.mjs','scripts\settings-host-prototype.ps1','scripts\native-settings-capture.ps1','scripts\installer-lock-probe.mjs','scripts\installer-phase-probe.mjs')){
 $path=Join-Path $root $file;if(Test-Path -LiteralPath $path){$targets.Add($path)}
}
foreach($png in Get-ChildItem -LiteralPath (Join-Path $root 'test-results\native-settings-0.7.0') -File -Filter '*.png'){$targets.Add($png.FullName)}
$targets=@($targets|Sort-Object -Unique)
$processes=Get-CimInstance Win32_Process|Select-Object ProcessId,ExecutablePath,CommandLine
$plan=@()
foreach($target in $targets){
 $full=[IO.Path]::GetFullPath($target)
 $inside=$full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)
 $ownedTemp=$full.StartsWith(([IO.Path]::GetFullPath($env:TEMP)).TrimEnd('\')+'\rdnext-installer-',[StringComparison]::OrdinalIgnoreCase)
 if(!$inside -and !$ownedTemp){throw "Outside boundary: $full"}
 if($full -match '\\(data|models|\.git|\.toolchain)(\\|$)'){throw "Protected path: $full"}
 $item=Get-Item -LiteralPath $full -Force
 $children=@($item)+@(if($item.PSIsContainer){Get-ChildItem -LiteralPath $full -Recurse -Force})
 if($children|Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.Name -match '^KEEP($|[.\-_])'}){throw "Reparse/KEEP protected: $full"}
 $active=$processes|Where-Object {($_.ExecutablePath -and ($_.ExecutablePath -eq $full -or $_.ExecutablePath.StartsWith($full+'\',[StringComparison]::OrdinalIgnoreCase))) -or ($_.CommandLine -and $_.CommandLine.IndexOf($full,[StringComparison]::OrdinalIgnoreCase) -ge 0)}
 $files=@($children|Where-Object {!$_.PSIsContainer});$bytes=($files|Measure-Object Length -Sum).Sum
 $plan+= [pscustomobject]@{path=$full;bytes=$bytes;files=$files.Count;active=@($active | ForEach-Object {$_.ProcessId} | Where-Object {$_})}
}
$plan|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'test-results\cleanup-plan-0.7.0.json') -Encoding utf8
if(!$Execute){$plan|Select-Object path,bytes,files,active;exit 0}
$installerReport=Get-Content -LiteralPath (Join-Path $root 'test-results\optional-installer-final-0.7.0\summary.json') -Raw|ConvertFrom-Json
$portableReport=Get-Content -LiteralPath (Join-Path $root 'test-results\portable-launch-final-0.7.0\summary.json') -Raw|ConvertFrom-Json
if(!$installerReport.passed -or !$portableReport.passed){throw 'Final delivery not validated'}
if((Get-FileHash -LiteralPath (Join-Path $root 'release\ResearchDesk-Next-0.7.0-Setup.exe') -Algorithm SHA256).Hash -ne $installerReport.sha256){throw 'Installer changed after validation'}
if((Get-FileHash -LiteralPath (Join-Path $root 'release\ResearchDesk Next 0.7.0.exe') -Algorithm SHA256).Hash -ne $portableReport.sha256){throw 'Portable changed after validation'}
foreach($row in $plan){
 if($row.active.Count){throw "Active process owns $($row.path)"}
 $item=Get-Item -LiteralPath $row.path -Force
 $files=if($item.PSIsContainer){@(Get-ChildItem -LiteralPath $row.path -Recurse -Force -File)}else{@($item)}
 foreach($f in $files){$lock=[IO.File]::Open($f.FullName,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$lock.Dispose()}
}
$removed=@()
foreach($row in $plan){Remove-Item -LiteralPath $row.path -Recurse -Force;$removed+=$row.path}
[pscustomobject]@{completedAt=(Get-Date).ToString('o');removed=$removed;bytes=($plan|Measure-Object bytes -Sum).Sum;formalDataTouched=$false;toolchainPreserved=$true}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $root 'test-results\cleanup-summary-0.7.0.json') -Encoding utf8
