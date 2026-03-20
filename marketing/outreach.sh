#!/usr/bin/env bash
#
# outreach.sh — Launch all *-outreach.sh scripts in parallel with merged output
#
# Automatically discovers and runs every <name>-outreach.sh script in this
# directory. Add a new platform by creating a new <name>-outreach.sh file —
# this launcher picks it up automatically.
#
# Usage:
#   ./marketing/outreach.sh                  # run all platforms
#   DRY_RUN=1 ./marketing/outreach.sh        # dry run all platforms
#   INTERVAL_MIN=60 INTERVAL_MAX=120 ./marketing/outreach.sh  # fast testing
#
# All environment variables (DRY_RUN, INTERVAL_MIN, INTERVAL_MAX) are
# forwarded to each child script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Discover all *-outreach.sh scripts (excluding this launcher)
SELF="$(basename "$0")"
SCRIPTS=()
for f in "$SCRIPT_DIR"/*-outreach.sh; do
  [ -f "$f" ] || continue
  [ "$(basename "$f")" = "$SELF" ] && continue
  SCRIPTS+=("$f")
done

if [ ${#SCRIPTS[@]} -eq 0 ]; then
  echo "No *-outreach.sh scripts found in $SCRIPT_DIR"
  exit 1
fi

# Print banner
echo "============================================"
echo "  OpenTabs Outreach Launcher"
echo "  Dry run:  ${DRY_RUN:-0}"
echo ""
for s in "${SCRIPTS[@]}"; do
  name=$(basename "$s" | sed 's/-outreach\.sh//')
  echo "    • $name"
done
echo ""
echo "  Ctrl-C to stop all"
echo "============================================"
echo ""

# Track child PIDs for cleanup
PIDS=()

cleanup() {
  echo ""
  echo "[$(date '+%H:%M:%S')] Stopping all outreach scripts..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "[$(date '+%H:%M:%S')] All stopped."
  exit 0
}

trap cleanup INT TERM

# Launch each script with a colored prefix tag
COLORS=(34 32 33 35 36 31)  # blue green yellow magenta cyan red
i=0

for script in "${SCRIPTS[@]}"; do
  name=$(basename "$script" | sed 's/-outreach\.sh//')
  color=${COLORS[$((i % ${#COLORS[@]}))]}
  tag="\033[${color}m[${name}]\033[0m"

  # Run script, prefix each line with the platform tag
  bash "$script" 2>&1 | while IFS= read -r line; do
    printf "${tag} %s\n" "$line"
  done &

  PIDS+=($!)
  i=$((i + 1))
done

# Wait for all children (blocks until Ctrl-C)
wait
