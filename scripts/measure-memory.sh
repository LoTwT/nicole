#!/bin/bash
#
# Measure Nicole's idle memory footprint on macOS.
#
# This script is the single definition of the procedure that
# docs/specs/performance.md links to: snapshot the existing WebKit processes,
# launch the given .app with `open -n`, wait for it to settle, then sum the
# phys_footprint of the new main process and the WebKit processes that appeared.
#
# It only terminates the instance it launched: the main process is identified by
# its executable path and start time, so an already running Nicole (installed or
# built elsewhere) is left alone. WebKit helpers are matched to that process by
# resource coalition; helpers of another app, and any that survive the launched
# instance, are excluded from the total. It creates no temporary files.
#
# The default 10s wait matches the budget procedure. Pass a larger --wait to
# leave room for WebKit's prewarmed processes and the first render; recorded
# baselines also cross-check with a longer wait (see
# docs/references/memory-baseline.md).
#
# Requires the macOS system bash 3.2 (`/bin/bash`); do not use bash 4+ features.
#
# Exit status: 0 success, 1 precondition or measurement failure, 2 over budget.

set -u
set -o pipefail

PROGRAM=${0##*/}
WAIT_SECONDS=10
BUDGET_MB=
APP_PATH=

usage() {
  cat <<EOF
Usage: $PROGRAM [--app PATH] [--wait SECONDS] [--budget MB]

  --app PATH      .app bundle to launch (default: build/<os>-<arch>/Nicole.app)
  --wait SECONDS  stabilization delay after launch (default: 10)
  --budget MB     exit with status 2 when the total exceeds this threshold
  -h, --help      print this help

Output: a table with the main process, GPU, WebContent, Networking and other
WebKit processes, followed by one machine-readable \`SUMMARY key=value ...\`
line. Footprints use the value that \`footprint\` prints in MB, the same
rounded-per-process convention as the recorded baselines. WebKit helpers are
matched to the app by resource coalition (using python3 when available).
EOF
}

fail() {
  printf '%s: error: %s\n' "$PROGRAM" "$*" >&2
  exit 1
}

warn() {
  printf '%s: warning: %s\n' "$PROGRAM" "$*" >&2
}

while [ "$#" -gt 0 ]; do
  case $1 in
    --app)
      [ "$#" -ge 2 ] || fail "--app needs a path"
      APP_PATH=$2
      shift 2
      ;;
    --app=*)
      APP_PATH=${1#--app=}
      shift
      ;;
    --wait)
      [ "$#" -ge 2 ] || fail "--wait needs a number of seconds"
      WAIT_SECONDS=$2
      shift 2
      ;;
    --wait=*)
      WAIT_SECONDS=${1#--wait=}
      shift
      ;;
    --budget)
      [ "$#" -ge 2 ] || fail "--budget needs a number of megabytes"
      BUDGET_MB=$2
      shift 2
      ;;
    --budget=*)
      BUDGET_MB=${1#--budget=}
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      fail "unknown option: $1 (try --help)"
      ;;
    *)
      [ -z "$APP_PATH" ] || fail "unexpected argument: $1"
      APP_PATH=$1
      shift
      ;;
  esac
done

[ -z "${1:-}" ] || fail "unexpected argument: $1"

case $WAIT_SECONDS in
  ''|*[!0-9]*) fail "--wait must be a positive integer, got: $WAIT_SECONDS" ;;
esac
[ "$WAIT_SECONDS" -gt 0 ] || fail "--wait must be greater than 0"

if [ -n "$BUDGET_MB" ]; then
  case $BUDGET_MB in
    ''|*[!0-9]*) fail "--budget must be a positive integer, got: $BUDGET_MB" ;;
  esac
  [ "$BUDGET_MB" -gt 0 ] || fail "--budget must be greater than 0"
fi

command -v footprint >/dev/null 2>&1 ||
  fail "footprint not found; it is required and only available on macOS"
command -v open >/dev/null 2>&1 ||
  fail "open not found; this script only runs on macOS"
command -v ps >/dev/null 2>&1 || fail "ps not found"

# Default to the local build for this OS and architecture, e.g.
# build/darwin-arm64/Nicole.app, which is where `mygo build` puts it.
if [ -z "$APP_PATH" ]; then
  build_arch=$(uname -m)
  [ "$build_arch" = "x86_64" ] && build_arch=amd64
  APP_PATH="build/$(uname -s | tr '[:upper:]' '[:lower:]')-$build_arch/Nicole.app"
fi

[ -e "$APP_PATH" ] || fail "app bundle not found: $APP_PATH (build it first, or pass --app)"
[ -d "$APP_PATH" ] || fail "not an app bundle directory: $APP_PATH"

# Resolve to an absolute path without a trailing slash; ps reports absolute
# executable paths, so the comparison must be absolute too.
APP_PATH=$(cd "$APP_PATH" 2>/dev/null && pwd -P) ||
  fail "cannot resolve app bundle path: $APP_PATH"
APP_PATH=${APP_PATH%/}

INFO_PLIST="$APP_PATH/Contents/Info.plist"
[ -f "$INFO_PLIST" ] || fail "not an app bundle (missing Contents/Info.plist): $APP_PATH"

EXECUTABLE_NAME=
if [ -x /usr/libexec/PlistBuddy ]; then
  EXECUTABLE_NAME=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$INFO_PLIST" 2>/dev/null)
fi
if [ -z "$EXECUTABLE_NAME" ]; then
  EXECUTABLE_NAME=${APP_PATH##*/}
  EXECUTABLE_NAME=${EXECUTABLE_NAME%.app}
fi
APP_EXE="$APP_PATH/Contents/MacOS/$EXECUTABLE_NAME"
[ -x "$APP_EXE" ] || fail "app executable not found or not executable: $APP_EXE"

# List the PIDs whose executable path is exactly the given app executable.
list_main_pids() {
  ps -axo pid=,comm= | EXE="$APP_EXE" awk '
    {
      pid = $1
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "")
      if ($0 == ENVIRON["EXE"]) print pid
    }'
}

# List every com.apple.WebKit.* helper as "pid name".
list_webkit_processes() {
  ps -axo pid=,comm= | awk '
    {
      pid = $1
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "")
      n = split($0, parts, "/")
      name = parts[n]
      if (name ~ /^com\.apple\.WebKit\./) print pid " " name
    }'
}

pid_list_contains() {
  case $1 in
    *" $2 "*) return 0 ;;
  esac
  return 1
}

# WebKit helpers share the resource coalition of the app that started them, and
# another app's helpers do not. macOS exposes it through proc_pidinfo; python3 is
# already a documented tool in this repository (see docs/development.md). Without
# it, the script falls back to the PID diff and the survivor check.
COALITION_LOOKUP=0
if command -v python3 >/dev/null 2>&1; then
  COALITION_LOOKUP=1
else
  warn "python3 not found; WebKit processes are attributed by PID diff only"
fi

coalition_id() {
  python3 - "$1" <<'PY' 2>/dev/null
import ctypes, ctypes.util, sys
libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)

class CoalitionInfo(ctypes.Structure):
    _fields_ = [("ids", ctypes.c_uint64 * 4), ("reserved", ctypes.c_uint64 * 3)]

info = CoalitionInfo()
if libc.proc_pidinfo(int(sys.argv[1]), 20, 0, ctypes.byref(info), ctypes.sizeof(info)) <= 0:
    sys.exit(1)
print("%d.%d" % (info.ids[0], info.ids[1]))
PY
}

# Another Nicole-family app (the installed release, or a `mygo dev` instance)
# can spawn WebKit processes while this measurement runs. They are identified
# and excluded after the launched instance stops, but name them up front so the
# operator knows why a run may be noisy.
for pid in $(ps -axo pid=,comm= | awk '
    {
      pid = $1
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "")
      n = split($0, parts, "/")
      name = parts[n]
      if (name == "Nicole" || name == "Nicole Dev") print pid
    }'); do
  warn "another Nicole-family app is running (pid $pid: $(ps -o comm= -p "$pid" 2>/dev/null))"
  warn "its WebKit activity can appear during the measurement; unrelated processes are excluded at the end"
done

# Snapshot state before launching. Existing main and WebKit processes are never
# touched; only PIDs that appear after this point belong to the new instance.
BEFORE_MAIN=" $(list_main_pids | tr '\n' ' ') "
BEFORE_WEBKIT=" $(list_webkit_processes | awk '{print $1}' | tr '\n' ' ') "

LAUNCHED_PID=
LAUNCHED_START=
MAIN_PID=

stop_launched_instance() {
  [ -n "$LAUNCHED_PID" ] || return 0

  if ! kill -0 "$LAUNCHED_PID" 2>/dev/null; then
    LAUNCHED_PID=
    return 0
  fi

  # Refuse to signal a reused PID: both the executable and the start time must
  # still match the process observed right after launch.
  current_exe=$(ps -o comm= -p "$LAUNCHED_PID" 2>/dev/null)
  current_start=$(ps -o lstart= -p "$LAUNCHED_PID" 2>/dev/null)
  if [ "$current_exe" != "$APP_EXE" ] || [ "$current_start" != "$LAUNCHED_START" ]; then
    warn "refusing to stop pid $LAUNCHED_PID: it is no longer the instance this script launched"
    LAUNCHED_PID=
    return 1
  fi

  kill -TERM "$LAUNCHED_PID" 2>/dev/null
  waited=0
  while kill -0 "$LAUNCHED_PID" 2>/dev/null && [ "$waited" -lt 50 ]; do
    sleep 0.2
    waited=$((waited + 1))
  done
  if kill -0 "$LAUNCHED_PID" 2>/dev/null; then
    warn "pid $LAUNCHED_PID ignored SIGTERM; sending SIGKILL"
    kill -KILL "$LAUNCHED_PID" 2>/dev/null
    waited=0
    while kill -0 "$LAUNCHED_PID" 2>/dev/null && [ "$waited" -lt 25 ]; do
      sleep 0.2
      waited=$((waited + 1))
    done
  fi
  if kill -0 "$LAUNCHED_PID" 2>/dev/null; then
    warn "pid $LAUNCHED_PID is still running after SIGKILL"
    return 1
  fi

  LAUNCHED_PID=
  return 0
}

cleanup() {
  stop_launched_instance
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'App: %s\n' "$APP_PATH"
printf 'Waiting %s seconds after launch before measuring.\n' "$WAIT_SECONDS"

open -n "$APP_PATH" || fail "open -n failed for $APP_PATH"

launch_started=$(date +%s)
deadline=$((launch_started + WAIT_SECONDS))
while :; do
  for pid in $(list_main_pids); do
    pid_list_contains "$BEFORE_MAIN" "$pid" && continue
    [ -n "$LAUNCHED_PID" ] || LAUNCHED_PID=$pid
  done
  [ -n "$LAUNCHED_PID" ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    fail "the app did not start within ${WAIT_SECONDS}s (try a larger --wait)"
  fi
  sleep 0.2
done

LAUNCHED_START=$(ps -o lstart= -p "$LAUNCHED_PID" 2>/dev/null)
[ -n "$LAUNCHED_START" ] || fail "the launched app exited before it could be inspected"

# Let startup work settle. The wait counts from launch, so process detection
# time does not extend the documented stabilization window.
while [ "$(date +%s)" -lt "$deadline" ]; do
  sleep 0.5
done

kill -0 "$LAUNCHED_PID" 2>/dev/null ||
  fail "the launched app exited during the ${WAIT_SECONDS}s stabilization window"

# Other instances of this same app path started by the user in the meantime are
# not ours; report them instead of attributing or stopping them.
for pid in $(list_main_pids); do
  pid_list_contains "$BEFORE_MAIN" "$pid" && continue
  [ "$pid" = "$LAUNCHED_PID" ] && continue
  warn "another instance of $APP_PATH appeared during the measurement (pid $pid); ignoring it"
done

MAIN_COALITION=
if [ "$COALITION_LOOKUP" -eq 1 ]; then
  MAIN_COALITION=$(coalition_id "$LAUNCHED_PID") || MAIN_COALITION=
  [ -n "$MAIN_COALITION" ] ||
    warn "could not read the resource coalition of pid $LAUNCHED_PID; using the PID diff only"
fi

measure_pid() {
  local pid=$1 output
  output=$(footprint -p "$pid" --noCategories 2>/dev/null) || return 1
  printf '%s\n' "$output" | awk '
    /^[[:space:]]*phys_footprint:/ {
      value = $2
      unit = $3
      if (unit == "GB") value *= 1024
      else if (unit == "KB") value /= 1024
      else if (unit == "B") value /= 1048576
      printf "%.0f\n", value
      found = 1
      exit
    }
    END { if (!found) exit 1 }'
}

main_mb=$(measure_pid "$LAUNCHED_PID") ||
  fail "footprint failed for the main process (pid $LAUNCHED_PID)"

# Processes that appeared after the launch snapshot, recorded as
# "pid:role:mb". Another application can spawn WebKit helpers in the same
# window; those with a different coalition are skipped here, and the ones that
# outlive the launched instance are excluded below.
CANDIDATES=
EXCLUDED_MB=0
EXCLUDED_COUNT=0
FOREIGN_PIDS=
AFTER_WEBKIT=$(list_webkit_processes)
for pid in $(printf '%s\n' "$AFTER_WEBKIT" | awk 'NF {print $1}'); do
  pid_list_contains "$BEFORE_WEBKIT" "$pid" && continue
  name=$(printf '%s\n' "$AFTER_WEBKIT" | awk -v pid="$pid" '$1 == pid {print $2; exit}')
  if ! kill -0 "$pid" 2>/dev/null; then
    warn "WebKit process $pid ($name) exited before it could be measured; skipped"
    continue
  fi
  if [ -n "$MAIN_COALITION" ]; then
    candidate_coalition=$(coalition_id "$pid") || candidate_coalition=
    if [ -z "$candidate_coalition" ]; then
      warn "could not read the resource coalition of $name (pid $pid); skipped"
      EXCLUDED_COUNT=$((EXCLUDED_COUNT + 1))
      continue
    fi
    if [ "$candidate_coalition" != "$MAIN_COALITION" ]; then
      EXCLUDED_COUNT=$((EXCLUDED_COUNT + 1))
      FOREIGN_PIDS="${FOREIGN_PIDS:+$FOREIGN_PIDS, }$pid"
      continue
    fi
  fi
  mb=$(measure_pid "$pid") || fail "footprint failed for $name (pid $pid)"
  case $name in
    com.apple.WebKit.GPU) role=gpu ;;
    com.apple.WebKit.WebContent) role=web ;;
    com.apple.WebKit.Networking) role=net ;;
    *)
      role=other
      warn "unclassified WebKit process $pid ($name); counted under Other"
      ;;
  esac
  CANDIDATES="${CANDIDATES:+$CANDIDATES }$pid:$role:$mb"
done

if [ -n "$FOREIGN_PIDS" ]; then
  warn "WebKit processes from another application (different coalition) skipped: $FOREIGN_PIDS"
fi

MAIN_PID=$LAUNCHED_PID
stop_launched_instance || true
if kill -0 "$MAIN_PID" 2>/dev/null; then
  fail "the launched instance (pid $MAIN_PID) is still running; not reporting a total"
fi

# WebKit helpers of the launched instance exit with it. Wait briefly for that;
# anything still alive belongs to another application and is not counted.
waited=0
survivors=
while [ "$waited" -lt 15 ]; do
  survivors=
  for record in $CANDIDATES; do
    pid=${record%%:*}
    if kill -0 "$pid" 2>/dev/null; then
      survivors="${survivors:+$survivors }$pid"
    fi
  done
  [ -z "$survivors" ] && break
  sleep 0.2
  waited=$((waited + 1))
done

GPU_MB=0
WEB_MB=0
NET_MB=0
OTHER_MB=0
GPU_PIDS=
WEB_PIDS=
NET_PIDS=
OTHER_PIDS=
WEBKIT_COUNT=0

for record in $CANDIDATES; do
  pid=${record%%:*}
  rest=${record#*:}
  role=${rest%%:*}
  mb=${rest##*:}
  if pid_list_contains " $survivors " "$pid"; then
    EXCLUDED_MB=$((EXCLUDED_MB + mb))
    EXCLUDED_COUNT=$((EXCLUDED_COUNT + 1))
    continue
  fi
  WEBKIT_COUNT=$((WEBKIT_COUNT + 1))
  case $role in
    gpu)
      GPU_MB=$((GPU_MB + mb))
      GPU_PIDS="${GPU_PIDS:+$GPU_PIDS, }$pid"
      ;;
    web)
      WEB_MB=$((WEB_MB + mb))
      WEB_PIDS="${WEB_PIDS:+$WEB_PIDS, }$pid"
      ;;
    net)
      NET_MB=$((NET_MB + mb))
      NET_PIDS="${NET_PIDS:+$NET_PIDS, }$pid"
      ;;
    *)
      OTHER_MB=$((OTHER_MB + mb))
      OTHER_PIDS="${OTHER_PIDS:+$OTHER_PIDS, }$pid"
      ;;
  esac
done

if [ -n "$survivors" ]; then
  warn "WebKit processes still running after the instance stopped: $survivors"
  warn "they belong to another application; excluded $EXCLUDED_MB MB from the total"
fi

TOTAL_MB=$((main_mb + GPU_MB + WEB_MB + NET_MB + OTHER_MB))

print_row() {
  printf '%-12s %-28s %10s\n' "$1" "${2:--}" "${3:--}"
}

printf '\n'
printf '%-12s %-28s %10s\n' "Role" "PID(s)" "MB"
printf '%-12s %-28s %10s\n' "------------" "----------------------------" "----------"
print_row "Main" "$MAIN_PID" "$main_mb"
print_row "GPU" "$GPU_PIDS" "$GPU_MB"
print_row "WebContent" "$WEB_PIDS" "$WEB_MB"
print_row "Networking" "$NET_PIDS" "$NET_MB"
if [ -n "$OTHER_PIDS" ]; then
  print_row "Other" "$OTHER_PIDS" "$OTHER_MB"
fi
printf '%-12s %-28s %10s\n' "------------" "----------------------------" "----------"
print_row "Total" "" "$TOTAL_MB"

budget_display=$BUDGET_MB
within_budget=unknown
status=0
if [ -n "$BUDGET_MB" ]; then
  if [ "$TOTAL_MB" -gt "$BUDGET_MB" ]; then
    within_budget=false
    status=2
    printf 'Total %s MB exceeds the %s MB budget.\n' "$TOTAL_MB" "$BUDGET_MB" >&2
  else
    within_budget=true
  fi
fi
[ -n "$budget_display" ] || budget_display=none

printf '\nSUMMARY total_mb=%s main_mb=%s gpu_mb=%s webcontent_mb=%s networking_mb=%s other_mb=%s webkit_processes=%s excluded_webkit_processes=%s excluded_mb=%s budget_mb=%s within_budget=%s\n' \
  "$TOTAL_MB" "$main_mb" "$GPU_MB" "$WEB_MB" "$NET_MB" "$OTHER_MB" "$WEBKIT_COUNT" "$EXCLUDED_COUNT" "$EXCLUDED_MB" "$budget_display" "$within_budget"

exit "$status"
