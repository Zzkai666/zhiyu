param([string]$Handle,[string]$ParentHandle)
$ErrorActionPreference='Stop'
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class NativeInspect{
 [DllImport("user32.dll")]public static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]public static extern IntPtr Style(IntPtr h,int n);
}
'@
$h=[IntPtr]::new([long]$Handle)
[pscustomobject]@{parentMatches=([NativeInspect]::GetParent($h).ToInt64().ToString() -eq $ParentHandle);visible=[NativeInspect]::IsWindowVisible($h);childStyle=(([NativeInspect]::Style($h,-16).ToInt64() -band 0x40000000) -ne 0)}|ConvertTo-Json -Compress
