param([string]$Handle,[string]$ParentHandle,[int]$X,[int]$Y)
$ErrorActionPreference='Stop'
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class NativeInput{
 [DllImport("user32.dll")]public static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint msg,IntPtr wp,IntPtr lp);
}
'@
[void][NativeInput]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$h=[IntPtr]::new([long]$Handle)
if([NativeInput]::GetParent($h).ToInt64().ToString() -ne $ParentHandle){throw 'Not owned child'}
$lp=[IntPtr]::new(($Y -shl 16) -bor $X)
[void][NativeInput]::PostMessage($h,0x200,[IntPtr]::Zero,$lp)
[void][NativeInput]::PostMessage($h,0x201,[IntPtr]::new(1),$lp)
[void][NativeInput]::PostMessage($h,0x202,[IntPtr]::Zero,$lp)
