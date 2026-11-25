param([switch]$Execute)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if($root -ne 'D:\APP\重构'){throw 'Unexpected workspace'}
$targets=[Collections.Generic.List[string]]::new()
foreach($name in @('brand-0.8.2','brand-packaged-0.8.2','library-workflow-0.8.2','portable-launch-final-0.8.2')){
 $base=Join-Path $root "test-results\$name"
 if(Test-Path -LiteralPath $base){foreach($d in Get-ChildItem -LiteralPath $base -Directory -Filter 'isolated-*'){$targets.Add($d.FullName)}}
}
foreach($name in @('release\delivery-0.8.2-build','test-results\installer-build-0.8.2')){
 $path=Join-Path $root $name;if(Test-Path -LiteralPath $path){$targets.Add($path)}
}
$installerSummary=Join-Path $root 'test-results\optional-installer-final-0.8.2\summary.json'
if(Test-Path -LiteralPath $installerSummary){foreach($report in Get-ChildItem -LiteralPath (Split-Path $installerSummary) -File -Filter 'summary*.json'){$s=Get-Content -LiteralPath $report.FullName -Raw|ConvertFrom-Json;if($s.passed -and $s.root){$targets.Add($s.root)}}}
$oldHashes=@{'ResearchDesk Next 0.8.1.exe'='ccf1a9f2b7f3f9a2edaa4435e3c356ea78463de92e574d123fb031c88c6b59e2';'ResearchDesk-Next-0.8.1-Setup.exe'='5cd6aca945cd3eff27dd6a159833c370c0f555727ef8f08fcef19d5149a1cca9'}
foreach($n in $oldHashes.Keys){$path=Join-Path $root "release\$n";if(Test-Path -LiteralPath $path){if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $oldHashes[$n]){throw 'Old release hash changed'};$targets.Add($path)}}
foreach($n in @('release\使用说明-0.8.1.txt','release\SHA256SUMS-0.8.1.txt')){$p=Join-Path $root $n;if(Test-Path -LiteralPath $p){$targets.Add($p)}}
$upgrade=Join-Path $root 'test-results\brand-upgrade-0.8.2\summary.json'
if(Test-Path -LiteralPath $upgrade){foreach($report in Get-ChildItem -LiteralPath (Split-Path $upgrade) -Filter 'summary*.json' -File){$s=Get-Content -LiteralPath $report.FullName -Raw|ConvertFrom-Json;if($s.root){$targets.Add($s.root)}}}
$probe=Join-Path $root 'test-results\brand-0.8.2\resource-probe.json'
if(Test-Path -LiteralPath $probe){$s=Get-Content -LiteralPath $probe -Raw|ConvertFrom-Json;if($s.exitCode -eq 0 -and $s.probe){$targets.Add($s.probe)}}
function ActiveOwners([string]$path){
 @(Get-CimInstance Win32_Process|Where-Object {($_.ExecutablePath -and ($_.ExecutablePath -eq $path -or $_.ExecutablePath.StartsWith($path+'\',[StringComparison]::OrdinalIgnoreCase))) -or ($_.CommandLine -and $_.CommandLine.IndexOf($path,[StringComparison]::OrdinalIgnoreCase) -ge 0)}|ForEach-Object {$_.ProcessId})
}
$plan=@()
foreach($target in ($targets|Sort-Object -Unique)){
 $full=[IO.Path]::GetFullPath($target)
 $inside=$full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)
 $tempRoot=([IO.Path]::GetFullPath($env:TEMP)).TrimEnd('\')
 $ownedTemp=($full.StartsWith($tempRoot+'\rdnext-installer-',[StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($tempRoot+'\rdnext-brand-upgrade-',[StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($tempRoot+'\zhiyu-rc-',[StringComparison]::OrdinalIgnoreCase)) -and [IO.Path]::GetDirectoryName($full) -eq $tempRoot
 if(!$inside -and !$ownedTemp){throw "Outside boundary: $full"}
 if($full -match '\\(data|models|\.git|\.toolchain)(\\|$)'){throw 'Protected path'}
 $item=Get-Item -LiteralPath $full -Force
 $children=@($item)+@(if($item.PSIsContainer){Get-ChildItem -LiteralPath $full -Recurse -Force})
 if($children|Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.Name -match '^KEEP($|[.\-_])'}){throw 'Reparse or KEEP protected'}
 $files=@($children|Where-Object {!$_.PSIsContainer})
 $plan+=[pscustomobject]@{path=$full;bytes=($files|Measure-Object Length -Sum).Sum;files=$files.Count;active=@(ActiveOwners $full)}
}
$plan|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'test-results\cleanup-plan-0.8.2.json') -Encoding utf8
if(!$Execute){$plan|Select-Object path,bytes,files,active;exit 0}
$install=Get-Content -LiteralPath $installerSummary -Raw|ConvertFrom-Json
$portable=Get-Content -LiteralPath (Join-Path $root 'test-results\portable-launch-final-0.8.2\summary.json') -Raw|ConvertFrom-Json
if(!$install.passed -or !$portable.passed){throw 'Final delivery not validated'}
if((Get-FileHash -LiteralPath (Join-Path $root 'release\知屿-0.8.2-Setup.exe') -Algorithm SHA256).Hash -ne $install.sha256){throw 'Installer changed'}
if((Get-FileHash -LiteralPath (Join-Path $root 'release\知屿 0.8.2.exe') -Algorithm SHA256).Hash -ne $portable.sha256){throw 'Portable changed'}
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
[pscustomobject]@{completedAt=(Get-Date).ToString('o');removed=$removed;skipped=$skipped;bytes=$bytes;formalDataTouched=$false;toolchainPreserved=$true;sourceBeforeRetained=$true}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'test-results\cleanup-summary-0.8.2.json') -Encoding utf8
