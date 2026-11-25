param([switch]$Execute)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if($root -ne 'D:\APP\重构'){throw 'Unexpected workspace'}
$targets=[Collections.Generic.List[string]]::new()
foreach($name in @('date-edit-0.7.1','react-settings-0.7.1','react-settings-packaged-0.7.1','island-0.7.1','reading-0.7.1','portable-launch-final-0.7.1')){
 $base=Join-Path $root "test-results\$name"
 if(Test-Path -LiteralPath $base){foreach($d in Get-ChildItem -LiteralPath $base -Directory -Filter 'isolated-*'){$targets.Add($d.FullName)}}
}
foreach($name in @('release\delivery-0.7.1-build','test-results\installer-build-0.7.1','scripts\close-date-fixture.mjs')){
 $path=Join-Path $root $name;if(Test-Path -LiteralPath $path){$targets.Add($path)}
}
$installerSummary=Join-Path $root 'test-results\optional-installer-final-0.7.1\summary.json'
if(Test-Path -LiteralPath $installerSummary){$s=Get-Content -LiteralPath $installerSummary -Raw|ConvertFrom-Json;if($s.passed -and $s.root){$targets.Add($s.root)}}
$oldHashes=@{'ResearchDesk Next 0.7.0.exe'='741749285daf6792d1d217c93ffba74cd8fe25eb14dbba83c99ce18d51d60bc3';'ResearchDesk-Next-0.7.0-Setup.exe'='3f2f81734f5f1650506ffb1ae3121dc5e2758bd77689e6a26c47d24b060bc836'}
foreach($n in $oldHashes.Keys){$path=Join-Path $root "release\$n";if(Test-Path -LiteralPath $path){if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $oldHashes[$n]){throw 'Old release hash changed'};$targets.Add($path)}}
function ActiveOwners([string]$path){
 @(Get-CimInstance Win32_Process|Where-Object {($_.ExecutablePath -and ($_.ExecutablePath -eq $path -or $_.ExecutablePath.StartsWith($path+'\',[StringComparison]::OrdinalIgnoreCase))) -or ($_.CommandLine -and $_.CommandLine.IndexOf($path,[StringComparison]::OrdinalIgnoreCase) -ge 0)}|ForEach-Object {$_.ProcessId})
}
$plan=@()
foreach($target in ($targets|Sort-Object -Unique)){
 $full=[IO.Path]::GetFullPath($target)
 $inside=$full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)
 $tempRoot=([IO.Path]::GetFullPath($env:TEMP)).TrimEnd('\')
 $ownedTemp=$full.StartsWith($tempRoot+'\rdnext-installer-',[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetDirectoryName($full) -eq $tempRoot
 if(!$inside -and !$ownedTemp){throw "Outside boundary: $full"}
 if($full -match '\\(data|models|\.git|\.toolchain)(\\|$)'){throw 'Protected path'}
 $item=Get-Item -LiteralPath $full -Force
 $children=@($item)+@(if($item.PSIsContainer){Get-ChildItem -LiteralPath $full -Recurse -Force})
 if($children|Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.Name -match '^KEEP($|[.\-_])'}){throw 'Reparse or KEEP protected'}
 $files=@($children|Where-Object {!$_.PSIsContainer})
 $plan+=[pscustomobject]@{path=$full;bytes=($files|Measure-Object Length -Sum).Sum;files=$files.Count;active=@(ActiveOwners $full)}
}
$plan|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'test-results\cleanup-plan-0.7.1.json') -Encoding utf8
if(!$Execute){$plan|Select-Object path,bytes,files,active;exit 0}
$install=Get-Content -LiteralPath $installerSummary -Raw|ConvertFrom-Json
$portable=Get-Content -LiteralPath (Join-Path $root 'test-results\portable-launch-final-0.7.1\summary.json') -Raw|ConvertFrom-Json
if(!$install.passed -or !$portable.passed){throw 'Final delivery not validated'}
if((Get-FileHash -LiteralPath (Join-Path $root 'release\ResearchDesk-Next-0.7.1-Setup.exe') -Algorithm SHA256).Hash -ne $install.sha256){throw 'Installer changed'}
if((Get-FileHash -LiteralPath (Join-Path $root 'release\ResearchDesk Next 0.7.1.exe') -Algorithm SHA256).Hash -ne $portable.sha256){throw 'Portable changed'}
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
[pscustomobject]@{completedAt=(Get-Date).ToString('o');removed=$removed;skipped=$skipped;bytes=$bytes;formalDataTouched=$false;toolchainPreserved=$true}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'test-results\cleanup-summary-0.7.1.json') -Encoding utf8
