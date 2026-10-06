; Mariner Sentinel fleet: NSIS include shared by HarborSentinel, OceanSentinel
; and VesselKeeper. Each app's electron-builder config pulls it in with
;
;   "nsis": { "include": "../sentinel-shared/electron-shell/installer.nsh" }
;
; Written against electron-builder / app-builder-lib 26.15.3, whose
; templates/nsis/include/allowOnlyOneInstallerInstance.nsh runs
; `!insertmacro customCheckAppRunning` in place of its own _CHECK_APP_RUNNING
; whenever that macro is defined. CHECK_APP_RUNNING is inserted by both the
; installer (installSection.nsh, before the old version is uninstalled) and the
; uninstaller (un.checkAppRunning), so this macro runs in both.
;
; WHY THIS EXISTS
;
; On 5-6 Oct 2026 the Windows installers stopped with "<App> cannot be closed.
; Please close it manually and click Retry to continue." in two ways:
;
;  1. The app really was running. HarborSentinel and OceanSentinel hide to the
;     tray on close, so an in-app update or a manual reinstall found them still
;     alive. The apps now quit before installing (HarborSentinel #88,
;     OceanSentinel #92), but that only helps an update launched FROM a fixed
;     version. For a customer still on 2.12.x or 2.13.0 the new installer is
;     the only new code that runs, so the installer has to do the closing.
;     electron-builder's own check asks first, force-kills, and after two
;     rounds gives up with that dialog.
;
;  2. A false positive: nothing from the install directory was running, the
;     dialog still appeared, Retry repeated it, and only uninstall + reinstall
;     cleared it. The same text is shown from a second place: the new
;     installer runs the OLD version's uninstaller (installUtil.nsh,
;     uninstallOldVersion) and, if that exits non-zero five times, shows
;     "cannot be closed". The old uninstaller (run with --updated) renames
;     every installed file out of the way and aborts if any single one will
;     not move -- held open by antivirus, an indexer, a backup tool, anything.
;     Retry reruns the same old uninstaller. A manual uninstall deletes on a
;     best-effort basis instead, which is why uninstall + reinstall worked.
;     Reproduced on 2026-10-05 with a test build: no app process running,
;     one installed file held open by an unrelated process -> exactly this
;     dialog. That uninstaller belongs to the version being replaced, so no
;     include can change it; what an include can do is make sure that, by the
;     time it runs, nothing is still holding the files.
;
; WHAT IT DOES
;
;  - Ends every process whose executable lives under "$INSTDIR\" and, like
;    `taskkill /T`, their descendants: Electron's renderer/GPU/utility
;    processes and VesselKeeper's forked Node backend (which runs the same
;    executable with ELECTRON_RUN_AS_NODE). Matching on the path rather than
;    the image name means a second copy of the app elsewhere (a dev build, a
;    test install) is left alone; a non-elevated installer can only read the
;    paths of the current user's processes, so it is scoped to this user.
;  - Never ends itself: the installer and anything it started are excluded,
;    which matters because an in-app update makes the installer a child of
;    the very app it is closing (a plain `taskkill /T` on the app would kill
;    the installer too).
;  - On an in-app update (--updated) first gives the app 1.5 s to exit on its
;    own, then force-ends whatever is left.
;  - Waits, re-checking every 250 ms for at most 15 s, until no such process is
;    left AND every installed file can be renamed (probed by renaming each one
;    and straight back), i.e. until the old uninstaller can do its job. This
;    absorbs the locks that follow a process exit and antivirus scans, on top
;    of the old uninstaller's own retries (in testing a 30 s lock got through,
;    a 5-minute one did not). The 15 s is only spent if something really is
;    stuck; normally this takes about a second. A file held open for longer
;    by something that is not the app still ends in the old uninstaller's
;    dialog: nothing the new installer controls can release another
;    program's handle.
;  - Then carries on. It never shows a dialog of its own, and it never reports
;    "running" from a probe that failed: nsExec's "error" is compared as a
;    string, where the stock check's integer comparison reads it as 0, which
;    means "running".
;  - If PowerShell cannot run (missing, or blocked by policy), falls back to
;    `taskkill /F /IM <exe>` for the current user, which matches by name.

!macro customCheckAppRunning
  Push $0
  Push $1
  Push $R9

  InitPluginsDir
  System::Call 'kernel32::GetCurrentProcessId() i .r0'
  System::Call 'kernel32::SetEnvironmentVariable(t "SENTINEL_NSIS_PID", t "$0") i'
  System::Call 'kernel32::SetEnvironmentVariable(t "SENTINEL_NSIS_INSTDIR", t "$INSTDIR") i'
  ${if} ${isUpdated}
    System::Call 'kernel32::SetEnvironmentVariable(t "SENTINEL_NSIS_GRACE_MS", t "1500") i'
  ${else}
    System::Call 'kernel32::SetEnvironmentVariable(t "SENTINEL_NSIS_GRACE_MS", t "0") i'
  ${endIf}
  System::Call 'kernel32::SetEnvironmentVariable(t "SENTINEL_NSIS_PS1", t "$PLUGINSDIR\sentinel-close-app.ps1") i'

  ; The script is written out at run time and run through ScriptBlock::Create,
  ; not -File, so a machine policy of AllSigned/Restricted for script files does
  ; not stop it. Exit codes: 0 = nothing left, 3 = something survived the 15 s,
  ; anything else = PowerShell itself failed (use the fallback below).
  FileOpen $R9 "$PLUGINSDIR\sentinel-close-app.ps1" w
  FileWrite $R9 `$$ErrorActionPreference = 'Stop'$\r$\n`
  FileWrite $R9 `$$dir = $$env:SENTINEL_NSIS_INSTDIR.TrimEnd('\') + '\'$\r$\n`
  FileWrite $R9 `$$self = [int]$$env:SENTINEL_NSIS_PID$\r$\n`
  FileWrite $R9 `$$grace = [int]$$env:SENTINEL_NSIS_GRACE_MS$\r$\n`
  FileWrite $R9 `function Get-Targets {$\r$\n`
  FileWrite $R9 `  $$all = @(Get-CimInstance -ClassName Win32_Process)$\r$\n`
  FileWrite $R9 `  $$byId = @{}; foreach ($$p in $$all) { $$byId[[int]$$p.ProcessId] = $$p }$\r$\n`
  ; A child counts only if it started after its parent, so a recycled PID cannot
  ; pull an unrelated process into either set.
  FileWrite $R9 `  function Grow($$set, $$stop) { do { $$n = $$set.Count; foreach ($$p in $$all) { $$id = [int]$$p.ProcessId; $$pp = [int]$$p.ParentProcessId; if (-not $$set.ContainsKey($$id) -and $$set.ContainsKey($$pp) -and -not ($$stop -and $$stop.ContainsKey($$id))) { $$par = $$byId[$$pp]; if (-not $$par -or -not $$par.CreationDate -or -not $$p.CreationDate -or $$p.CreationDate -ge $$par.CreationDate) { $$set[$$id] = $$true } } } } while ($$set.Count -ne $$n) }$\r$\n`
  FileWrite $R9 `  $$skip = @{}; $$skip[$$self] = $$true; $$skip[$$PID] = $$true; Grow $$skip $$null$\r$\n`
  FileWrite $R9 `  $$hit = @{}; foreach ($$p in $$all) { $$id = [int]$$p.ProcessId; if ($$p.ExecutablePath -and $$p.ExecutablePath.StartsWith($$dir, [StringComparison]::OrdinalIgnoreCase) -and -not $$skip.ContainsKey($$id)) { $$hit[$$id] = $$true } }$\r$\n`
  FileWrite $R9 `  Grow $$hit $$skip$\r$\n`
  FileWrite $R9 `  return @($$hit.Keys)$\r$\n`
  FileWrite $R9 `}$\r$\n`
  ; "Released" means what the old version's uninstaller is about to need: every
  ; installed file can be renamed (it moves them all away and gives up if one
  ; will not move). Probed by renaming each file and straight back.
  FileWrite $R9 `function Test-Released { if (-not (Test-Path -LiteralPath $$dir)) { return $$true }; foreach ($$f in @(Get-ChildItem -LiteralPath $$dir -Recurse -File -Force -ErrorAction SilentlyContinue)) { $$a = $$f.FullName; $$b = $$a + '.sentinel-probe'; try { [IO.File]::Move($$a, $$b) } catch { return $$false }; try { [IO.File]::Move($$b, $$a) } catch { } }; return $$true }$\r$\n`
  FileWrite $R9 `$$left = @(Get-Targets)$\r$\n`
  FileWrite $R9 `if ($$left.Count -gt 0 -and $$grace -gt 0) { $$g = (Get-Date).AddMilliseconds($$grace); while ($$left.Count -gt 0 -and (Get-Date) -lt $$g) { Start-Sleep -Milliseconds 250; $$left = @(Get-Targets) } }$\r$\n`
  FileWrite $R9 `$$deadline = (Get-Date).AddSeconds(15)$\r$\n`
  FileWrite $R9 `while ($$true) {$\r$\n`
  FileWrite $R9 `  foreach ($$id in $$left) { Stop-Process -Id $$id -Force -ErrorAction SilentlyContinue }$\r$\n`
  FileWrite $R9 `  if ($$left.Count -eq 0 -and (Test-Released)) { exit 0 }$\r$\n`
  FileWrite $R9 `  if ((Get-Date) -ge $$deadline) { exit 3 }$\r$\n`
  FileWrite $R9 `  Start-Sleep -Milliseconds 250$\r$\n`
  FileWrite $R9 `  $$left = @(Get-Targets)$\r$\n`
  FileWrite $R9 `}$\r$\n`
  FileClose $R9

  DetailPrint "$(appClosing)"
  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& ([ScriptBlock]::Create([IO.File]::ReadAllText($$env:SENTINEL_NSIS_PS1)))"`
  Pop $0
  Delete "$PLUGINSDIR\sentinel-close-app.ps1"

  ; Compare as strings: nsExec reports a failure to start as "error", which an
  ; integer comparison would read as 0 -- the stock check's own false positive.
  ${if} "$0" == "3"
    DetailPrint `"${PRODUCT_NAME}" was still running, or its files still in use, after 15 seconds; continuing.`
  ${elseIf} "$0" != "0"
    DetailPrint `PowerShell unavailable ($0); closing "${APP_EXECUTABLE_FILENAME}" by name.`
    nsExec::Exec `"$CmdPath" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
    Pop $0
    StrCpy $1 0
    ${do}
      nsExec::Exec `"$CmdPath" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
      Pop $0
      ${if} "$0" != "0"
        ${break}
      ${endIf}
      Sleep 250
      IntOp $1 $1 + 1
    ${loopUntil} $1 >= 20
    ; Give the image handles a moment after the last process is gone.
    Sleep 250
  ${endIf}

  Pop $R9
  Pop $1
  Pop $0
!macroend
