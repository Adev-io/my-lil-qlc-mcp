<#
  qlc-window.ps1 — Front the QLC+ console, optionally send keys/click, and screenshot.

  Usage:
    # Just screenshot the current QLC+ window
    ./scripts/qlc-window.ps1

    # Send a key chord (e.g. Ctrl+F12 to open DevTools) then screenshot
    ./scripts/qlc-window.ps1 -Keys "^{F12}"

    # Click a screen point (X,Y) then screenshot
    ./scripts/qlc-window.ps1 -Click "640,360"

    # Custom screenshot dir and settle time
    ./scripts/qlc-window.ps1 -OutDir "D:\Shots" -SettleMs 1000

  Params:
    -Keys      : SendKeys chord (e.g. "^{F12}" for Ctrl+F12, "~" for Enter).
    -Click     : Screen point as "x,y" (e.g. "100,200"). Sends a left click.
    -OutDir    : Directory for PNG output (default: C:\Users\Arikl\Desktop\screenshots).
    -SettleMs  : Milliseconds to wait after each action (default: 700).
#>
param([string]$Keys = "", [string]$Click = "", [string]$OutDir = "C:\Users\Arikl\Desktop\screenshots", [int]$SettleMs = 700)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

# Define P/Invoke signatures for window and input control
if (-not ('QWin' -as [type])) {
  Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class QWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
}

# Find the QLC+ process with a visible window
$p = Get-Process qlcplus -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) {
  Write-Host "  [!] QLC+ is not running (or has no window)"
  exit 1
}

# Restore the window (SW_RESTORE = 9) and bring it to foreground
[QWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[QWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds $SettleMs

# Send keys if provided
if ($Keys) {
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds $SettleMs
}

# Send a mouse click if provided
if ($Click) {
  $xy = $Click -split ','
  [QWin]::SetCursorPos([int]$xy[0], [int]$xy[1]) | Out-Null
  # mouse_event flags: 2 = MOUSEEVENTF_LEFTDOWN, 4 = MOUSEEVENTF_LEFTUP
  [QWin]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [QWin]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds $SettleMs
}

# Capture the primary screen
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)

# Create OutDir if it doesn't exist
if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

# Save the screenshot with a timestamp
$file = Join-Path $OutDir ("qlc-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".png")
$bmp.Save($file)
$g.Dispose()
$bmp.Dispose()

# Output the file path
Write-Output $file
