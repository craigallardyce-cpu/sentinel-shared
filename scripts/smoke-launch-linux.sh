#!/usr/bin/env bash
# smoke-launch-linux.sh -- launch a built Linux AppImage headless and assert
# that it opens a top-level window and stays up.
#
#   scripts/smoke-launch-linux.sh <App.AppImage | dir> <window-regex> [-- app args...]
#
# Given a directory, it uses the one *.AppImage in it (and fails if there is
# not exactly one).
#
# Why this exists: until 2026-09 nothing in the fleet ever launched a built
# installer, so "the artifacts built" was the whole of release verification.
# Four releases shipped that nobody could sign in to, and HarborSentinel's
# exited before opening a window, with CI green throughout. This runs the
# ARTIFACT electron-builder produced -- not the working tree -- which is the
# only thing that could have seen either failure.
#
# What it asserts, and deliberately nothing more:
#   1. a visible top-level X window whose title (or WM_CLASS) matches
#      <window-regex> appears within SMOKE_TIMEOUT seconds, and
#   2. the process is still running SMOKE_SETTLE seconds after that, and that
#      same window is still mapped. (Its title may change meanwhile: it starts
#      as the BrowserWindow title and becomes the loaded page's <title>.)
# What the window shows is not asserted. The apps require sign-in, so it is a
# sign-in or starting page, or the busy-port page if something on the runner
# holds the app's port.
#
# Fails (exit 1) if the process exits before a window appears, if no window
# appears in time, or if the process or window is gone after the settle
# period; the app's stdout/stderr tail is printed on every failure. Exit 2 is
# a usage or environment error. The app and every process it started are
# killed on the way out, whatever happened: the app runs in its own process
# group (setsid), the whole group is signalled, and any descendant that left
# the group is found by walking the parent-pid tree. That matters for
# VesselKeeper, which fork()s its backend as a child process.
#
# Environment:
#   SMOKE_TIMEOUT  seconds to wait for the window        (default 60)
#   SMOKE_SETTLE   seconds it must then stay up          (default 5)
#   SMOKE_LOG_TAIL lines of app output to print          (default 80)
#
# The app runs with a throwaway XDG_CONFIG_HOME, so it starts as a fresh
# install would (first-run state, no signed-in session), and a throwaway
# TMPDIR, which is where APPIMAGE_EXTRACT_AND_RUN unpacks the image. Both are
# removed afterwards.
#
# Requires: xvfb-run (apt: xvfb) and xdotool (apt: xdotool). FUSE is not
# needed: APPIMAGE_EXTRACT_AND_RUN=1 makes the AppImage runtime extract itself
# instead of mounting. Electron's own runtime libraries (libnss3, libgtk-3,
# libasound2, libgbm) are already on GitHub's ubuntu-latest image.
#
# In the apps' build.yml -- after "Compile Release Assets", before "Upload
# Build Artifacts", so a Linux build that cannot start fails the build job and
# the release job (needs: build) publishes nothing:
#
#       - name: Smoke-launch the Linux AppImage
#         if: runner.os == 'Linux'
#         run: |
#           sudo apt-get update -qq
#           sudo apt-get install -y -qq --no-install-recommends xvfb xdotool
#           bash ../sentinel-shared/scripts/smoke-launch-linux.sh dist-electron 'HarborSentinel'
#
# with the app's productName as the regex. The job's working-directory is the
# app, and sentinel-shared is checked out beside it at the pinned SHA, which
# must be one that contains this script.
#
# Electron is started with --no-sandbox: an extracted AppImage's chrome-sandbox
# is not setuid root, and Ubuntu 24.04 restricts the unprivileged user
# namespaces the fallback sandbox needs. Nothing else is added to the command
# line, so @sentinel/electron-shell's Linux GPU compatibility code runs as it
# would on a customer's machine.

set -euo pipefail

SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-60}"
SMOKE_SETTLE="${SMOKE_SETTLE:-5}"
SMOKE_LOG_TAIL="${SMOKE_LOG_TAIL:-80}"

log() { printf '[smoke] %s\n' "$*"; }
die_usage() { printf '[smoke] %s\n' "$*" >&2; exit 2; }

usage() {
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

# ---------------------------------------------------------------- arguments --

[[ $# -ge 2 ]] || usage
APPIMAGE="$1"
WINDOW_RE="$2"
shift 2
if [[ $# -gt 0 ]]; then
  [[ "$1" == "--" ]] || die_usage "unexpected argument '$1' (app arguments go after --)"
  shift
fi
APP_ARGS=("$@")

if [[ -d "$APPIMAGE" ]]; then
  shopt -s nullglob
  found=("$APPIMAGE"/*.AppImage)
  shopt -u nullglob
  [[ ${#found[@]} -eq 1 ]] ||
    die_usage "expected exactly one *.AppImage in $APPIMAGE, found ${#found[@]}${found[*]:+: ${found[*]}}"
  APPIMAGE="${found[0]}"
fi
[[ -f "$APPIMAGE" ]] || die_usage "no such file: $APPIMAGE"
[[ -n "$WINDOW_RE" ]] || die_usage "window regex must not be empty"
for n in SMOKE_TIMEOUT SMOKE_SETTLE SMOKE_LOG_TAIL; do
  [[ "${!n}" =~ ^[0-9]+$ ]] || die_usage "$n must be a whole number of seconds/lines, got '${!n}'"
done
[[ "$SMOKE_TIMEOUT" -gt 0 ]] || die_usage "SMOKE_TIMEOUT must be greater than 0"

# --------------------------------------------- re-exec under a fresh Xvfb --
# Always our own server, even when DISPLAY is set, so a developer running this
# on a desktop does not get the app on their screen and a CI runner never
# depends on ambient state. -a picks a free display number.

if [[ -z "${SMOKE_INSIDE_XVFB:-}" ]]; then
  missing=()
  for tool in xvfb-run xdotool; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    die_usage "missing ${missing[*]}; install with: sudo apt-get install -y xvfb xdotool"
  fi
  export SMOKE_INSIDE_XVFB=1
  exec xvfb-run -a -s "-screen 0 1280x800x24" \
    "$0" "$APPIMAGE" "$WINDOW_RE" -- "${APP_ARGS[@]}"
fi

# ------------------------------------------------------------ the launch --

APPIMAGE="$(cd "$(dirname "$APPIMAGE")" && pwd)/$(basename "$APPIMAGE")"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/smoke-launch.XXXXXX")"
APP_LOG="$WORK/app.log"
mkdir -p "$WORK/config" "$WORK/tmp"
: >"$APP_LOG"
APP_PID=""

in_ci() { [[ -n "${GITHUB_ACTIONS:-}" ]]; }

print_tail() {
  local lines
  lines="$(wc -l <"$APP_LOG" | tr -d ' ')"
  in_ci && echo "::group::app output (last $SMOKE_LOG_TAIL of $lines lines)"
  log "---- app output: last $SMOKE_LOG_TAIL of $lines lines ----"
  tail -n "$SMOKE_LOG_TAIL" "$APP_LOG" || true
  log "---- end of app output ----"
  in_ci && echo "::endgroup::"
  return 0
}

fail() {
  in_ci && echo "::error title=Linux smoke launch failed::$*"
  log "FAIL: $*"
  print_tail
  exit 1
}

# True while the process exists and is not a zombie. `kill -0` alone is not
# enough: an exited child of this shell stays a zombie until reaped, and
# kill -0 succeeds on a zombie.
alive() {
  local stat
  stat="$(ps -o stat= -p "$1" 2>/dev/null || true)"
  [[ -n "$stat" && "$stat" != Z* ]]
}

# Every descendant of $1, deepest last, from a single ps snapshot.
descendants() {
  ps -e -o pid=,ppid= | awk -v root="$1" '
    { parent[$1] = $2 }
    END {
      for (p in parent) {
        q = parent[p]
        while (q != "" && q != 0 && q != 1) {
          if (q == root) { print p; break }
          q = parent[q]
        }
      }
    }'
}

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [[ -n "$APP_PID" ]]; then
    # Snapshot the tree before signalling anything: once the app dies its
    # children reparent to init and can no longer be traced back to it.
    local tree survivors
    tree="$APP_PID $(descendants "$APP_PID" | tr '\n' ' ')"
    kill -TERM -- "-$APP_PID" 2>/dev/null || true
    # shellcheck disable=SC2086 # word-splitting the pid list is intended
    kill -TERM $tree 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      survivors=""
      for p in $tree; do alive "$p" && survivors+="$p "; done
      [[ -z "$survivors" ]] && break
      sleep 0.5
    done
    if [[ -n "$survivors" ]]; then
      log "still running after SIGTERM, sending SIGKILL: $survivors"
      kill -KILL -- "-$APP_PID" 2>/dev/null || true
      # shellcheck disable=SC2086
      kill -KILL $survivors 2>/dev/null || true
    fi
    wait "$APP_PID" 2>/dev/null || true
    log "app process tree stopped (${tree% })"
  fi
  rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# upload-artifact/download-artifact drop the executable bit.
[[ -x "$APPIMAGE" ]] || chmod +x "$APPIMAGE"
log "launching $(basename "$APPIMAGE") on DISPLAY=$DISPLAY (timeout ${SMOKE_TIMEOUT}s, settle ${SMOKE_SETTLE}s)"

# setsid gives the app its own process group (pgid == its pid), so cleanup can
# signal the whole group. A background job of a non-interactive shell is never
# a group leader, so setsid execs in place rather than forking, and $! is the
# app itself.
APPIMAGE_EXTRACT_AND_RUN=1 \
XDG_CONFIG_HOME="$WORK/config" \
TMPDIR="$WORK/tmp" \
ELECTRON_ENABLE_LOGGING=1 \
  setsid "$APPIMAGE" --no-sandbox "${APP_ARGS[@]}" >"$APP_LOG" 2>&1 </dev/null &
APP_PID=$!

pgid="$(ps -o pgid= -p "$APP_PID" 2>/dev/null | tr -d ' ' || true)"
if [[ -n "$pgid" && "$pgid" != "$APP_PID" ]]; then
  log "warning: app pgid $pgid != pid $APP_PID; relying on the pid tree for cleanup"
fi

find_window() {
  local ids
  ids="$(xdotool search --onlyvisible --name "$WINDOW_RE" 2>/dev/null || true)"
  [[ -n "$ids" ]] || ids="$(xdotool search --onlyvisible --class "$WINDOW_RE" 2>/dev/null || true)"
  printf '%s' "$ids" | head -n 1
}

# Reap the exited app and record its status. Not called through $(...): a
# subshell cannot wait for its parent's child.
APP_STATUS=""
reap() {
  APP_STATUS=0
  wait "$APP_PID" 2>/dev/null || APP_STATUS=$?
}

start=$SECONDS
win=""
while (( SECONDS - start < SMOKE_TIMEOUT )); do
  if ! alive "$APP_PID"; then
    reap
    fail "the app exited after $((SECONDS - start))s, before any window matching /$WINDOW_RE/ appeared (exit status $APP_STATUS)"
  fi
  win="$(find_window)"
  [[ -n "$win" ]] && break
  sleep 1
done

if [[ -z "$win" ]]; then
  log "visible windows at timeout:"
  for w in $(xdotool search --onlyvisible --name '.' 2>/dev/null || true); do
    log "  $w '$(xdotool getwindowname "$w" 2>/dev/null || true)'"
  done
  fail "no window matching /$WINDOW_RE/ within ${SMOKE_TIMEOUT}s (the app is still running)"
fi

title="$(xdotool getwindowname "$win" 2>/dev/null || true)"
geometry="$(xdotool getwindowgeometry "$win" 2>/dev/null | awk '/Geometry/ {print $2}' || true)"
log "window $win appeared after $((SECONDS - start))s: '$title' ${geometry:+($geometry)}"

sleep "$SMOKE_SETTLE"
if ! alive "$APP_PID"; then
  reap
  fail "the app opened a window, then exited within ${SMOKE_SETTLE}s (exit status $APP_STATUS)"
fi
# By id, not by regex: the title legitimately changes when the page loads.
if ! xdotool search --onlyvisible --name '' 2>/dev/null | grep -qx "$win"; then
  fail "window $win closed within ${SMOKE_SETTLE}s of opening, though the app is still running"
fi
title="$(xdotool getwindowname "$win" 2>/dev/null || true)"

log "PASS: window '$title' open and the app still running after ${SMOKE_SETTLE}s"
SMOKE_LOG_TAIL=20 print_tail
