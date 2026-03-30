#!/bin/bash
# perfect.sh — Run all perfect-*.sh scripts in parallel with streamed output.
#
# Usage: bash .ralph/perfect.sh
#
# Discovers all scripts matching .ralph/perfect-*.sh and launches them
# in parallel. Each script runs its own Claude session to audit a different
# area of the codebase and produce PRDs via the ralph skill.
#
# Output from all scripts is interleaved on stdout with each line prefixed
# by a timestamp and the script name, e.g.:
#   14:32:05 [backend]   ▸ Read    platform/mcp-server/src/index.ts
#   14:32:06 [extension]  ▸ Glob    platform/browser-extension/src/**/*.ts

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Log directory and timestamped log file.
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/perfect-$(TZ=America/Los_Angeles date +'%Y-%m-%d-%H%M%S').log"

# Tee all stdout+stderr to both terminal and log file.
# The log file gets ANSI codes stripped for readability.
exec > >(tee >(sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_FILE")) 2>&1

# Colors
CYAN='\033[36m'
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# Short PST timestamp for log lines.
ts() {
  TZ=America/Los_Angeles date +'%H:%M:%S'
}

# Pipe filter: prepends "HH:MM:SS [tag] " to every line read from stdin.
ts_prefix() {
  local tag="$1"
  while IFS= read -r line; do
    printf "%s ${CYAN}[%s]${RESET} %s\n" "$(ts)" "$tag" "$line"
  done
}

# Find all perfect-*.sh scripts (excluding this file)
SCRIPTS=()
for f in "$SCRIPT_DIR"/perfect-*.sh; do
  [ -f "$f" ] || continue
  SCRIPTS+=("$f")
done

if [ ${#SCRIPTS[@]} -eq 0 ]; then
  echo "No perfect-*.sh scripts found in $SCRIPT_DIR"
  exit 0
fi

echo -e "$(ts) ${BOLD}Launching ${#SCRIPTS[@]} perfect scripts in parallel:${RESET}"
echo -e "$(ts) ${DIM}  Log: $LOG_FILE${RESET}"
echo ""

PIDS=()
NAMES=()
for f in "${SCRIPTS[@]}"; do
  # Strip "perfect-" prefix and ".sh" suffix for a clean tag.
  name=$(basename "$f" .sh)
  short="${name#perfect-}"
  NAMES+=("$short")

  echo -e "$(ts) ${DIM}  Starting: $short${RESET}"

  # Launch script, pipe stdout+stderr through ts_prefix for live streaming.
  bash "$f" 2>&1 | ts_prefix "$short" &
  PIDS+=($!)
done

echo ""
echo -e "$(ts) ${BOLD}All ${#SCRIPTS[@]} scripts launched. Output streaming below.${RESET}"
echo ""

# Kill all child processes on SIGINT/SIGTERM so claude sessions don't orphan.
cleanup() {
  echo ""
  echo -e "$(ts) ${YELLOW}Interrupted — killing all scripts...${RESET}"
  # Kill entire process group of each background pipeline.
  for pid in "${PIDS[@]}"; do
    kill -TERM -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  done
  # Belt-and-suspenders: kill all children of this shell.
  kill 0 2>/dev/null || true
  wait 2>/dev/null || true
  echo -e "$(ts) ${YELLOW}All scripts killed.${RESET}"
  exit 130
}
trap cleanup SIGINT SIGTERM

# Wait for all background pipelines and track failures.
FAILED=0
for i in "${!PIDS[@]}"; do
  pid=${PIDS[$i]}
  short="${NAMES[$i]}"
  if wait "$pid"; then
    echo -e "$(ts) ${GREEN}[${short}] completed successfully.${RESET}"
  else
    echo -e "$(ts) ${RED}[${short}] failed (exit $?).${RESET}"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo -e "$(ts) ${GREEN}${BOLD}All ${#SCRIPTS[@]} scripts completed successfully.${RESET}"
else
  echo -e "$(ts) ${RED}${BOLD}$FAILED of ${#SCRIPTS[@]} scripts failed.${RESET}"
  exit 1
fi
