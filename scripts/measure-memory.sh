#!/bin/bash
#
# Measure Nicole's idle memory footprint on macOS.
#
# The procedure, process attribution and cleanup rules are implemented here.
# The call contract and the baseline requirements are in
# docs/specs/performance.md.
#
# Requires the macOS system bash 3.2 (`/bin/bash`); do not use bash 4+ features.

set -u
set -o pipefail

PROGRAM=${0##*/}
WAIT_SECONDS=10
BUDGET_MB=
APP_PATH=

# How long to wait for the main process to appear, and for how long a single
# candidate without a visible launch token must remain alone before it is
# accepted. Detection and stabilization are timed separately.
DETECT_TIMEOUT_SECONDS=30
FALLBACK_STABLE_SECONDS=10

usage() {
  cat <<EOF
Usage: $PROGRAM [--app PATH] [--wait SECONDS] [--budget MB]

  --app PATH      .app bundle to launch (default: build/<os>-<arch>/Nicole.app)
  --wait SECONDS  stabilization delay after the app process appears (default: 10)
  --budget MB     exit with status 2 when the total exceeds this threshold
  -h, --help      print this help

Output: a table with the main process, GPU, WebContent, Networking and other
WebKit processes, followed by one machine-readable \`SUMMARY key=value ...\`
line. Footprints use the value that \`footprint\` prints in MB, the same
rounded-per-process convention as the recorded baselines. WebKit helpers are
matched to the app by resource coalition (using python3 when available).

Exit status: 0 success, 1 precondition or measurement failure, 2 over budget.
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

# `open -n` does not return a PID, and another instance of the same build can
# start at the same time. Every launch gets a random token in its environment;
# macOS exposes it through `ps -E`, so only the process carrying it is ours.
if command -v uuidgen >/dev/null 2>&1; then
  LAUNCH_TOKEN=$(uuidgen | tr -d '-')
else
  LAUNCH_TOKEN="$$-$(date +%s)-$RANDOM"
fi
LAUNCH_TOKEN_VAR=NICOLE_MEASURE_TOKEN

process_has_launch_token() {
  output=$(ps -Eww -p "$1" 2>/dev/null) || return 1
  case $output in
    *"$LAUNCH_TOKEN_VAR=$LAUNCH_TOKEN"*) return 0 ;;
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
# can spawn WebKit processes while this measurement runs. They are ignored by
# the token/coalition checks, but name them up front so the operator knows why
# a run may be noisy.
for pid in $(ps -axo pid=,comm= | awk '
    {
      pid = $1
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "")
      n = split($0, parts, "/")
      name = parts[n]
      if (name == "Nicole" || name == "Nicole Dev") print pid
    }'); do
  warn "another Nicole-family app is running (pid $pid: $(ps -o comm= -p "$pid" 2>/dev/null))"
  warn "its WebKit activity is ignored by the launch token and coalition checks"
done

# Snapshot state before launching. Existing main and WebKit processes are never
# touched; only PIDs that appear after this point belong to the new instance.
BEFORE_MAIN=" $(list_main_pids | tr '\n' ' ') "
BEFORE_WEBKIT=" $(list_webkit_processes | awk '{print $1}' | tr '\n' ' ') "

LAUNCHED_PID=
LAUNCHED_START=
MAIN_PID=
TOKEN_VERIFIED=0

# PIDs whose executable is the given app executable and that did not exist
# before the launch.
new_main_pids() {
  found=
  for pid in $(list_main_pids); do
    pid_list_contains "$BEFORE_MAIN" "$pid" && continue
    found="${found:+$found }$pid"
  done
  printf '%s' "$found"
}

# Record the start time first, then the PID: an interrupt between the two
# assignments leaves no PID behind. stop_launched_instance also accepts the
# launch token when a start time is missing.
select_launched_pid() {
  candidate_start=$(ps -o lstart= -p "$1" 2>/dev/null)
  [ -n "$candidate_start" ] || return 1
  LAUNCHED_START=$candidate_start
  LAUNCHED_PID=$1
  return 0
}

stop_launched_instance() {
  [ -n "$LAUNCHED_PID" ] || return 0

  if ! kill -0 "$LAUNCHED_PID" 2>/dev/null; then
    LAUNCHED_PID=
    return 0
  fi

  # Refuse to signal a reused PID. If the start time was not read yet, fall
  # back to the launch token, which only this instance's environment carries.
  if [ -n "$LAUNCHED_START" ]; then
    current_exe=$(ps -o comm= -p "$LAUNCHED_PID" 2>/dev/null)
    current_start=$(ps -o lstart= -p "$LAUNCHED_PID" 2>/dev/null)
    if [ "$current_exe" != "$APP_EXE" ] || [ "$current_start" != "$LAUNCHED_START" ]; then
      warn "refusing to stop pid $LAUNCHED_PID: it is no longer the instance this script launched"
      LAUNCHED_PID=
      return 1
    fi
  elif ! process_has_launch_token "$LAUNCHED_PID"; then
    warn "refusing to stop pid $LAUNCHED_PID: it does not carry the launch token"
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
printf 'Waiting %s seconds after the app process appears.\n' "$WAIT_SECONDS"

open -n --env "$LAUNCH_TOKEN_VAR=$LAUNCH_TOKEN" "$APP_PATH" ||
  fail "open -n failed for $APP_PATH"

# Detect the instance. A token match always wins; a single candidate without a
# visible token is accepted only after it has remained alone for a few seconds.
# Several candidates without a token abort without signaling anything.
launch_started=$(date +%s)
detect_deadline=$((launch_started + DETECT_TIMEOUT_SECONDS))
fallback_since=
fallback_pid=
while :; do
  now=$(date +%s)
  new_pids=$(new_main_pids)
  token_pid=
  for pid in $new_pids; do
    if process_has_launch_token "$pid"; then
      token_pid=$pid
      break
    fi
  done
  if [ -n "$token_pid" ]; then
    if select_launched_pid "$token_pid"; then
      TOKEN_VERIFIED=1
      break
    fi
    # The process vanished between the checks; keep waiting.
    new_pids=$(new_main_pids)
  fi

  candidate_count=0
  only_pid=
  for pid in $new_pids; do
    candidate_count=$((candidate_count + 1))
    only_pid=$pid
  done
  if [ "$candidate_count" -eq 1 ]; then
    if [ "$only_pid" != "$fallback_pid" ]; then
      fallback_pid=$only_pid
      fallback_since=$now
    fi
    if [ $((now - fallback_since)) -ge "$FALLBACK_STABLE_SECONDS" ]; then
      if select_launched_pid "$only_pid"; then
        TOKEN_VERIFIED=0
        break
      fi
    fi
  else
    fallback_pid=
    fallback_since=
  fi

  if [ "$now" -ge "$detect_deadline" ]; then
    # Re-check before failing. Stop only an instance confirmed by the token; a
    # lone candidate without the token is still the only possible match.
    late_pids=$(new_main_pids)
    late_pid=
    late_count=0
    for pid in $late_pids; do
      late_count=$((late_count + 1))
      if process_has_launch_token "$pid"; then
        late_pid=$pid
      fi
    done
    if [ -n "$late_pid" ]; then
      if select_launched_pid "$late_pid"; then
        stop_launched_instance || true
      fi
      LAUNCHED_PID=
      LAUNCHED_START=
      fail "the app did not start within ${DETECT_TIMEOUT_SECONDS}s; the late instance was stopped"
    fi
    if [ "$late_count" -eq 1 ]; then
      if select_launched_pid "$late_pids"; then
        stop_launched_instance || true
      fi
      LAUNCHED_PID=
      LAUNCHED_START=
      fail "the app did not start within ${DETECT_TIMEOUT_SECONDS}s; the late instance was stopped"
    fi
    LAUNCHED_PID=
    LAUNCHED_START=
    if [ "$late_count" -gt 1 ]; then
      fail "multiple new instances of $APP_PATH appeared and the launch token is not visible; refusing to guess (no signal sent; instances remain running)"
    fi
    fail "the app did not start within ${DETECT_TIMEOUT_SECONDS}s"
  fi
  sleep 0.2
done

# Stabilization is timed from process detection, separately from the detection
# timeout. The instance must still be alive when it ends.
settle_deadline=$(( $(date +%s) + WAIT_SECONDS ))
while [ "$(date +%s)" -lt "$settle_deadline" ]; do
  sleep 0.5
done
kill -0 "$LAUNCHED_PID" 2>/dev/null ||
  fail "the launched app exited during the ${WAIT_SECONDS}s stabilization window"

if [ "$TOKEN_VERIFIED" -eq 0 ]; then
  # Fallback mode: without a visible token another instance would be
  # indistinguishable, so abort rather than signal the wrong process.
  other_count=0
  for pid in $(new_main_pids); do
    [ "$pid" = "$LAUNCHED_PID" ] && continue
    other_count=$((other_count + 1))
  done
  if [ "$other_count" -gt 0 ]; then
    LAUNCHED_PID=
    LAUNCHED_START=
    fail "another instance of $APP_PATH appeared and the launch token is not visible; refusing to guess (no signal sent; instances may remain running)"
  fi
else
  for pid in $(new_main_pids); do
    [ "$pid" = "$LAUNCHED_PID" ] && continue
    warn "another instance of $APP_PATH appeared during the measurement (pid $pid); ignoring it"
  done
fi

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
# "pid:role:mb". In coalition mode, helpers of another app are skipped here; in
# fallback mode every new helper is a candidate and the survivor check decides.
CANDIDATES=
FOREIGN_COUNT=0
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
      FOREIGN_COUNT=$((FOREIGN_COUNT + 1))
      continue
    fi
    if [ "$candidate_coalition" != "$MAIN_COALITION" ]; then
      FOREIGN_COUNT=$((FOREIGN_COUNT + 1))
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

# Give WebKit a moment to reap the helpers, then note any that are still alive.
# With coalition attribution they are known to belong to the app, so a late
# exit must not remove them from the total; the PID-diff fallback has no such
# proof and excludes them.
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

SURVIVOR_COUNT=0
for record in $CANDIDATES; do
  pid=${record%%:*}
  pid_list_contains " $survivors " "$pid" && SURVIVOR_COUNT=$((SURVIVOR_COUNT + 1))
done
if [ -n "$survivors" ]; then
  if [ -n "$MAIN_COALITION" ]; then
    warn "$SURVIVOR_COUNT WebKit process(es) were still running shortly after the stop; kept in the total"
  else
    warn "$SURVIVOR_COUNT WebKit process(es) were still running after the stop; excluded from the total"
  fi
fi

GPU_MB=0
WEB_MB=0
NET_MB=0
OTHER_MB=0
GPU_PIDS=
WEB_PIDS=
NET_PIDS=
OTHER_PIDS=
WEBKIT_COUNT=0
SURVIVOR_EXCLUDED_MB=0

for record in $CANDIDATES; do
  pid=${record%%:*}
  rest=${record#*:}
  role=${rest%%:*}
  mb=${rest##*:}
  if [ -z "$MAIN_COALITION" ] && pid_list_contains " $survivors " "$pid"; then
    SURVIVOR_EXCLUDED_MB=$((SURVIVOR_EXCLUDED_MB + mb))
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

if [ -n "$MAIN_COALITION" ]; then
  attribution=coalition
else
  attribution=pid-diff
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

printf '\nSUMMARY total_mb=%s main_mb=%s gpu_mb=%s webcontent_mb=%s networking_mb=%s other_mb=%s webkit_processes=%s foreign_webkit_processes=%s survivor_webkit_processes=%s survivor_excluded_mb=%s attribution=%s budget_mb=%s within_budget=%s\n' \
  "$TOTAL_MB" "$main_mb" "$GPU_MB" "$WEB_MB" "$NET_MB" "$OTHER_MB" "$WEBKIT_COUNT" "$FOREIGN_COUNT" "$SURVIVOR_COUNT" "$SURVIVOR_EXCLUDED_MB" "$attribution" "$budget_display" "$within_budget"

exit "$status"
