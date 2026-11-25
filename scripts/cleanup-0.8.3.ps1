param([switch]$Execute)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if($root -ne 'D:\APP\重构'){throw 'Unexpected workspace'}
$targets=[Collections.Generic.List[string]]::new()
foreach($name in @('pipeline-0.8.3','pipeline-ui-0.8.3','pipeline-packaged-0.8.3','codex-discovery-0.8.3','codex-packaged-0.8.3','reading-0.8.3','export-0.8.3','portable-launch-final-0.8.3')){
 $base=Join-Path $root "test-results\$name"
 if(Test-Path -LiteralPath $base){foreach($d in Get-ChildItem -LiteralPath $base -Directory -Filter 'isolated-*'){$targets.Add($d.FullName)}}
}
foreach($name in @('release\delivery-0.8.3-build','test-results\installer-build-0.8.3')){
 $path=Join-Path $root $name;if(Test-Path -LiteralPath $path){$targets.Add($path)}
}
foreach($name in @('optional-installer-final-0.8.3','pipeline-upgrade-0.8.3')){
 $base=Join-Path $root "test-results\$name"
 if(Test-Path -LiteralPath $base){foreach($report in Get-ChildItem -LiteralPath $base -File -Filter 'summary*.json'){$s=Get-Content -LiteralPath $report.FullName -Raw|ConvertFrom-Json;if($s.root -and (Test-Path -LiteralPath $s.root)){$targets.Add($s.root)}}}
}
$probe=Join-Path $root 'test-results\pipeline-0.8.3\resource-probe.json'
if(Test-Path -LiteralPath $probe){$s=Get-Content -LiteralPath $probe -Raw|ConvertFrom-Json;if($s.root -and (Test-Path -LiteralPath $s.root)){$targets.Add($s.root)}}
$oldHashes=@{'ResearchDesk Next 0.8.1.exe'='ccf1a9f2b7f3f9a2edaa4435e3c356ea78463de92e574d123fb031c88c6b59e2';'知屿 0.8.2.exe'='e8bd6e2dcb8f38f48dd5107a42e2e3e44d829b08d9fc2bb5e738b0994a37b9fe';'知屿-0.8.2-Setup.exe'='503836341aa3ed03fc30cde6224f2a1c5dd9c5051503f544375d634ea9db0dd8'}
foreach($name in $oldHashes.Keys){$path=Join-Path $root "release\$name";if(Test-Path -LiteralPath $path){if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $oldHashes[$name]){throw 'Old release hash changed'};$targets.Add($path)}}
foreach($name in @('release\使用说明-0.8.2.txt','release\SHA256SUMS-0.8.2.txt')){$path=Join-Path $root $name;if(Test-Path -LiteralPath $path){$targets.Add($path)}}
function ActiveOwners([string]$path){
 @(Get-CimInstance Win32_Process|Where-Object {($_.ExecutablePath -and ($_.ExecutablePath -eq $path -or $_.ExecutablePath.StartsWith($path+'\',[StringComparison]::OrdinalIgnoreCase))) -or ($_.CommandLine -and $_.CommandLine.IndexOf($path,[StringComparison]::OrdinalIgnoreCase) -ge 0)}|ForEach-Object {$_.ProcessId})
}
$plan=@()
foreach($target in ($targets|Sort-Object -Unique)){
 $full=[IO.Path]::GetFullPath($target)
 $inside=$full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)
 $tempRoot=([IO.Path]::GetFullPath($env:TEMP)).TrimEnd('\')
 $ownedTemp=($full.StartsWith($tempRoot+'\rdnext-installer-',[StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($tempRoot+'\zhiyu-rc-',[StringComparison]::OrdinalIgnoreCase)) -and [IO.Path]::GetDirectoryName($full) -eq $tempRoot
 if(!$inside -and !$ownedTemp){throw "Outside boundary: $full"}
 if($full -match '\\(data|models|\.git|\.toolchain)(\\|$)'){throw 'Protected path'}
 $item=Get-Item -LiteralPath $full -Force
 $children=@($item)+@(if($item.PSIsContainer){Get-ChildItem -LiteralPath $full -Recurse -Force})
 if($children|Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.Name -match '^KEEP($|[.\-_])'}){throw 'Reparse or KEEP protected'}
 $files=@($children|Where-Object {!$_.PSIsContainer})
 $plan+=[pscustomobject]@{path=$full;bytes=($files|Measure-Object Length -Sum).Sum;files=$files.Count;active=@(ActiveOwners $full)}
}
$plan|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'test-results\cleanup-plan-0.8.3.json') -Encoding utf8
if(!$Execute){$plan|Select-Object path,bytes,files,active;exit 0}
foreach($name in @('optional-installer-final-0.8.3','pipeline-upgrade-0.8.3','pipeline-packaged-0.8.3','codex-packaged-0.8.3','portable-launch-final-0.8.3')){
 $s=Get-Content -LiteralPath (Join-Path $root "test-results\$name\summary.json") -Raw|ConvertFrom-Json
 if(!$s.passed){throw "Final delivery not validated: $name"}
}
$install=Get-Content -LiteralPath (Join-Path $root 'test-results\optional-installer-final-0.8.3\summary.json') -Raw|ConvertFrom-Json
$portable=Get-Content -LiteralPath (Join-Path $root 'test-results\portable-launch-final-0.8.3\summary.json') -Raw|ConvertFrom-Json
if((Get-FileHash -LiteralPath (Join-Path $root 'release\知屿-0.8.3-Setup.exe') -Algorithm SHA256).Hash -ne $install.sha256){throw 'Installer changed'}
if((Get-FileHash -LiteralPath (Join-Path $root 'release\知屿 0.8.3.exe') -Algorithm SHA256).Hash -ne $portable.sha256){throw 'Portable changed'}
$removed=@();$skipped=@();$bytes=0
foreach($row in $plan){
 $current=@(ActiveOwners $row.path)
 if($current.Count){$skipped+=@{path=$row.path;reason='Active process';pids=$current};continue}
 $item=Get-Item -LiteralPath $row.path -Force
 $files=if($item.PSIsContainer){@(Get-ChildItem -LiteralPath $row.path -Recurse -Force -File)}else{@($item)}
 $locked=$false
 foreach($file in $files){try{$handle=[IO.File]::Open($file.FullName,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$handle.Dispose()}catch{$locked=$true;break}}
 if($locked){$skipped+=@{path=$row.path;reason='OS lock or access restriction'};continue}
 if(@(ActiveOwners $row.path).Count){$skipped+=@{path=$row.path;reason='Process became active'};continue}
 Remove-Item -LiteralPath $row.path -Recurse -Force
 $removed+=$row.path;$bytes+=$row.bytes
}
[pscustomobject]@{completedAt=(Get-Date).ToString('o');removed=$removed;skipped=$skipped;bytes=$bytes;formalDataTouched=$false;toolchainPreserved=$true;sourceBeforeRetained=$true}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'test-results\cleanup-summary-0.8.3.json') -Encoding utf8
