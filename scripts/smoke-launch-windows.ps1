<#
smoke-launch-windows.ps1 -- install a built Windows NSIS installer silently,
optionally over the previous release while that release is running, then launch
the installed app and assert that it opens a top-level window and stays up.

  pwsh scripts/smoke-launch-windows.ps1 -Installer <Setup.exe | dir> -ProductName <name>
       [-PreviousInstaller <Setup.exe>] [-WindowPattern <regex>]

Given a directory, -Installer uses the one *Setup*.exe in it (and fails if there
is not exactly one).

Why this exists: smoke-launch-linux.sh proves a Linux build starts, and release
step 6 left Windows to a person launching the published installer by hand.
This runs the same check on the Windows leg of build.yml, against the
installer electron-builder produced, through the path a customer takes:

  1. With -PreviousInstaller (the last published release's Setup.exe), that
     version is installed and started first, and left running. If it opens no
     window that is a warning, not a failure: it is the old build being tested.
  2. The new installer runs silently (/S) over it. It must exit 0 and must have
     closed the running copy itself (sentinel-shared #98's installer.nsh),
     because an installer that stops at "cannot be closed" is what a customer
     updating with the app in the tray would hit.
  3. The installed executable must be byte-for-byte the one in win-unpacked
     beside the installer, when that directory exists, so the run cannot pass
     by launching the old version.
  4. The installed app is launched with no arguments, as the Start menu does.
     A visible top-level window whose title matches -WindowPattern must appear
     within -Timeout seconds, and the app and that window must still be there
     -Settle seconds later. What the window shows is not asserted: the apps
     require sign-in, so it is the sign-in page.

What it cannot check, and release step 6 still owns: signing in, and About
showing the new version (the window is the sign-in page, and a branch build
carries the same version number as the last release).

Exit 1 on any failure, with the app's output tail printed; exit 2 on a usage
error. Every process started from the install directory is stopped on the way
out, whatever happened; that includes VesselKeeper's forked backend, which runs
the same executable.

In the apps' build.yml, after "Compile Release Assets", beside the Linux smoke
step:

      - name: Smoke-launch the Windows installer
        if: runner.os == 'Windows'
        shell: pwsh
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          $prev = Join-Path $env:RUNNER_TEMP 'previous-release'
          gh release download --repo $env:GITHUB_REPOSITORY --pattern '*Setup*.exe' --dir $prev 2>&1 | Out-Host
          $prevExe = Get-ChildItem $prev -Filter '*Setup*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
          & ../sentinel-shared/scripts/smoke-launch-windows.ps1 -Installer dist-electron -ProductName 'HarborSentinel' -PreviousInstaller $prevExe.FullName

With no published release (or none readable) the previous-version phase is
skipped with a warning and the new installer is tested as a fresh install.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $Installer,
  [Parameter(Mandatory)] [string] $ProductName,
  [string] $PreviousInstaller = '',
  [string] $WindowPattern = '',
  [int] $Timeout = 60,
  [int] $Settle = 5,
  [int] $LogTail = 80
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$InCI = [bool]$env:GITHUB_ACTIONS
$Work = Join-Path ([IO.Path]::GetTempPath()) ("smoke-launch-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $Work | Out-Null
$script:Logs = @()
$script:InstallDir = $null

function Log([string] $msg) { Write-Host "[smoke] $msg" }

function Usage([string] $msg) {
  Write-Host "[smoke] $msg"
  exit 2
}

function Print-Tail {
  foreach ($f in $script:Logs) {
    if (-not (Test-Path $f)) { continue }
    $lines = @(Get-Content $f -ErrorAction SilentlyContinue)
    if ($InCI) { Write-Host "::group::$(Split-Path $f -Leaf) (last $LogTail of $($lines.Count) lines)" }
    Log "---- $(Split-Path $f -Leaf): last $LogTail of $($lines.Count) lines ----"
    $lines | Select-Object -Last $LogTail | ForEach-Object { Write-Host $_ }
    if ($InCI) { Write-Host '::endgroup::' }
  }
}

function Fail([string] $msg) {
  if ($InCI) { Write-Host "::error title=Windows smoke launch failed::$msg" }
  Log "FAIL: $msg"
  Print-Tail
  Stop-Installed
  exit 1
}

function Warn([string] $msg) {
  if ($InCI) { Write-Host "::warning title=Windows smoke launch::$msg" }
  Log "warning: $msg"
}

# Every running process whose image lives under the install directory.
function Get-Installed {
  if (-not $script:InstallDir) { return @() }
  $root = $script:InstallDir.TrimEnd('\') + '\'
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
      try { $_.Path -and $_.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
    })
}

function Stop-Installed {
  $procs = Get-Installed
  if ($procs.Count -gt 0) {
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Log "stopped $($procs.Count) process(es) under $script:InstallDir"
  }
}

# electron-builder's per-user NSIS installer registers itself under HKCU's
# Uninstall key with DisplayName = productName and InstallLocation.
function Resolve-InstallDir {
  $keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')
  foreach ($k in $keys) {
    $hit = Get-ItemProperty $k -ErrorAction SilentlyContinue |
      Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like "$ProductName*" -and $_.PSObject.Properties['InstallLocation'] } |
      Select-Object -First 1
    if ($hit -and $hit.InstallLocation) { return $hit.InstallLocation.Trim('"') }
  }
  $guess = Join-Path $env:LOCALAPPDATA "Programs\$ProductName"
  if (Test-Path $guess) { return $guess }
  return $null
}

function Run-Installer([string] $exe, [string] $label) {
  Log "installing $label silently: $(Split-Path $exe -Leaf)"
  # WaitForExit on the installer alone, not Start-Process -Wait, which also
  # waits for every descendant the installer leaves behind.
  $p = Start-Process -FilePath $exe -ArgumentList '/S' -PassThru
  $null = $p.Handle # keeps ExitCode readable after the process is gone
  if (-not $p.WaitForExit(300000)) { Fail "$label installer still running after 5 minutes" }
  if ($p.ExitCode -ne 0) { Fail "$label installer exited with status $($p.ExitCode)" }
  $dir = Resolve-InstallDir
  if (-not $dir) { Fail "$label installer exited 0 but no install of '$ProductName' is registered" }
  $script:InstallDir = $dir
  $app = Join-Path $dir "$ProductName.exe"
  if (-not (Test-Path $app)) { Fail "$label installer exited 0 but $app does not exist" }
  Log "$label installed at $dir"
  return $app
}

# Launch the installed app and wait for its window. Returns the process, or
# $null when -Soft is set and no window appeared (the caller warns instead).
function Launch-And-Wait([string] $app, [string] $label, [switch] $Soft) {
  $out = Join-Path $Work "$label.out.log"
  $err = Join-Path $Work "$label.err.log"
  $script:Logs += @($out, $err)
  $env:ELECTRON_ENABLE_LOGGING = '1'
  $proc = Start-Process -FilePath $app -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  Log "launched $label (pid $($proc.Id)); waiting up to ${Timeout}s for a window matching /$WindowPattern/"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $win = $null
  while ($sw.Elapsed.TotalSeconds -lt $Timeout) {
    $win = Get-Installed | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -match $WindowPattern } | Select-Object -First 1
    if ($win) { break }
    if ($proc.HasExited -and (Get-Installed).Count -eq 0) {
      $msg = "$label exited after $([int]$sw.Elapsed.TotalSeconds)s, before any window appeared (exit status $($proc.ExitCode))"
      if ($Soft) { Warn $msg; return $null }
      Fail $msg
    }
    Start-Sleep -Seconds 1
  }
  if (-not $win) {
    foreach ($p in Get-Installed | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }) {
      Log "  window: pid $($p.Id) '$($p.MainWindowTitle)'"
    }
    $msg = "$label opened no window matching /$WindowPattern/ within ${Timeout}s"
    if ($Soft) { Warn $msg; return $null }
    Fail $msg
  }
  Log "$label window appeared after $([int]$sw.Elapsed.TotalSeconds)s: '$($win.MainWindowTitle)' (pid $($win.Id))"
  return $win
}

# ------------------------------------------------------------ arguments --

if (-not $WindowPattern) { $WindowPattern = [regex]::Escape($ProductName) }
if ($Timeout -le 0) { Usage '-Timeout must be greater than 0' }

if (Test-Path $Installer -PathType Container) {
  $found = @(Get-ChildItem $Installer -Filter '*Setup*.exe' -File | Where-Object { $_.Name -notlike '*uninstaller*' })
  if ($found.Count -ne 1) { Usage "expected exactly one *Setup*.exe in $Installer, found $($found.Count)" }
  $Installer = $found[0].FullName
}
if (-not (Test-Path $Installer -PathType Leaf)) { Usage "no such file: $Installer" }
$Installer = (Resolve-Path $Installer).Path
$Unpacked = Join-Path (Split-Path $Installer -Parent) "win-unpacked\$ProductName.exe"

try {
  # -------------------------------------------- the previous release --
  $oldProcs = @()
  if ($PreviousInstaller -and (Test-Path $PreviousInstaller -PathType Leaf)) {
    $oldApp = Run-Installer (Resolve-Path $PreviousInstaller).Path 'previous release'
    $old = Launch-And-Wait $oldApp 'previous' -Soft
    $oldProcs = Get-Installed
    if ($old) { Log "previous release is running ($($oldProcs.Count) processes); installing the new build over it" }
  } else {
    Warn 'no previous release installer given; testing the new build as a fresh install only'
  }

  # ---------------------------------------- the new build, over it --
  $app = Run-Installer $Installer 'new build'
  $still = @($oldProcs | Where-Object { -not $_.HasExited })
  if ($still.Count -gt 0) {
    Fail "the new installer finished but left $($still.Count) process(es) of the running previous release alive (pids $($still.Id -join ', '))"
  }
  if ($oldProcs.Count -gt 0) { Log 'the installer closed the running previous release' }

  if (Test-Path $Unpacked) {
    $a = (Get-FileHash $app -Algorithm SHA256).Hash
    $b = (Get-FileHash $Unpacked -Algorithm SHA256).Hash
    if ($a -ne $b) { Fail "the installed $ProductName.exe ($($a.Substring(0,12))) is not the one this build produced ($($b.Substring(0,12)))" }
    Log "installed $ProductName.exe matches win-unpacked ($($a.Substring(0,12)))"
  } else {
    Warn "no $Unpacked to compare the installed executable with"
  }

  $win = Launch-And-Wait $app 'new'
  $handle = $win.MainWindowHandle
  Start-Sleep -Seconds $Settle
  $live = Get-Installed | Where-Object { $_.Id -eq $win.Id }
  if (-not $live) { Fail "the app opened a window, then exited within ${Settle}s" }
  $live.Refresh()
  if ($live.MainWindowHandle -eq [IntPtr]::Zero) { Fail "the window closed within ${Settle}s of opening, though the app is still running" }

  Log "PASS: window '$($live.MainWindowTitle)' open and the app still running after ${Settle}s"
  $LogTail = 20
  Print-Tail
} finally {
  Stop-Installed
  Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
}
