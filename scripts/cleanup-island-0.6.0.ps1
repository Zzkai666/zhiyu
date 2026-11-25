$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath 'D:\APP\重构').Path
$release=Join-Path $root 'release'
$latest=Join-Path $release 'ResearchDesk Next 0.6.0.exe'
$expected='06a12a31ad1afd5d98e0f05deaef38edf5527ede9d97a59171af9893303687c6'
if((Get-FileHash -LiteralPath $latest -Algorithm SHA256).Hash -ne $expected){throw 'Latest artifact changed'}
foreach($summary in @('island-0.6.0-packaged/summary.json','portable-launch-0.6.0/summary.json','island-native-0.6.0/summary.json')){
 $check=Get-Content -LiteralPath (Join-Path $root "test-results/$summary") -Raw|ConvertFrom-Json
 if(!$check.passed){throw "Acceptance missing: $summary"}
}
$targets=[Collections.Generic.List[string]]::new()
$targets.Add((Join-Path $release 'ResearchDesk Next 0.5.0.exe'))
$targets.Add((Join-Path $release 'portable-0.6.0-build'))
$targets.Add((Join-Path $root 'components/daozai/target'))
$targets.Add((Join-Path $root 'test-results/island-native-0.6.0/profile'))
$targets.Add((Join-Path $root 'test-results/island-native-0.6.0/preview.exe'))
foreach($folder in @('island-0.6.0','island-0.6.0-packaged','portable-launch-0.6.0','reader-regression-0.6.0','export-regression-0.6.0')){
 $parent=Join-Path $root "test-results/$folder"
 Get-ChildItem -LiteralPath $parent -Directory -ErrorAction SilentlyContinue|Where-Object {$_.Name -like 'isolated-*'}|ForEach-Object {$targets.Add($_.FullName)}
}
$processes=Get-CimInstance Win32_Process
$records=@()
$prior=Join-Path $root 'test-results/island-cleanup-0.6.0.json'
if(Test-Path -LiteralPath $prior){$records=@((Get-Content -LiteralPath $prior -Raw|ConvertFrom-Json).removed)}
foreach($target in $targets){
 if(!(Test-Path -LiteralPath $target)){continue}
 $resolved=(Resolve-Path -LiteralPath $target).Path
 $allowed=$resolved -eq (Join-Path $release 'ResearchDesk Next 0.5.0.exe') -or $resolved -eq (Join-Path $release 'portable-0.6.0-build') -or $resolved -eq (Join-Path $root 'components/daozai/target') -or $resolved.StartsWith((Join-Path $root 'test-results')+'\',[StringComparison]::OrdinalIgnoreCase)
 if(!$allowed -or $resolved -eq $latest){throw "Unsafe cleanup path: $resolved"}
 $active=@($processes|Where-Object {($_.ExecutablePath -and $_.ExecutablePath.StartsWith($resolved,[StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.Contains($resolved))})
 if($active.Count){throw "Active owned artifact: $resolved"}
 $item=Get-Item -LiteralPath $resolved
 if($resolved.EndsWith('0.5.0.exe') -and (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash -ne '4a299996c9ae3cf37d865f370b943e4b80ca66d9aafae4d2c55ba15a3af9e9a1'){throw 'Previous release identity mismatch'}
 $entries=@($item);if($item.PSIsContainer){$entries+=@(Get-ChildItem -LiteralPath $resolved -Recurse -Force)}
 if($entries|Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.Name -eq 'KEEP'}){throw "Protected entry: $resolved"}
 $files=@($entries|Where-Object {!$_.PSIsContainer});$bytes=($files|Measure-Object Length -Sum).Sum
 foreach($file in $files){$stream=[IO.File]::Open($file.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None);$stream.Dispose()}
 Remove-Item -LiteralPath $resolved -Recurse -Force
 $records+=@([pscustomobject]@{path=$resolved;bytes=$bytes;files=$files.Count})
 $records|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'test-results/island-cleanup-0.6.0-progress.json') -Encoding utf8
}
[pscustomobject]@{latest=$latest;sha256=$expected;bytes=(Get-Item -LiteralPath $latest).Length;removed=$records;originalResearchDeskPreserved=$true;formalDataPreserved=$true;checkedAt=(Get-Date).ToUniversalTime().ToString('o')}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $root 'test-results/island-cleanup-0.6.0.json') -Encoding utf8
$remaining=@(Get-ChildItem -LiteralPath $release)
if($remaining.Count -ne 1 -or $remaining[0].FullName -ne $latest){throw 'Release directory contains unexpected items'}
