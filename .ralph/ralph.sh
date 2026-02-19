#!/bin/bash
# Ralph — Continuous PRD consumer daemon
#
# Usage: .ralph/ralph.sh [--tool amp|claude] [--once] [--poll N]
#
# Watches .ralph/ for PRD files and processes them in timestamp order.
# Runs as a long-lived daemon by default; use --once to process one PRD and exit.
#
# PRD file name state machine:
#   prd-YYYY-MM-DD-HHMMSS-objective~draft.json    — being written, ignored
#   prd-YYYY-MM-DD-HHMMSS-objective.json           — ready to be picked up
#   prd-YYYY-MM-DD-HHMMSS-objective~running.json   — currently being executed
#   prd-YYYY-MM-DD-HHMMSS-objective~done.json      — completed, pending archive
#   archived to .ralph/archive/                     — final resting place
#
# At any given time there is at most ONE file with ~running in its name.

set -e

# --- Argument Parsing ---

TOOL="claude"
MODEL=""
ONCE=false
POLL_INTERVAL=5

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    --tool=*)
      TOOL="${1#*=}"
      shift
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --model=*)
      MODEL="${1#*=}"
      shift
      ;;
    --once)
      ONCE=true
      shift
      ;;
    --poll)
      POLL_INTERVAL="$2"
      shift 2
      ;;
    --poll=*)
      POLL_INTERVAL="${1#*=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ "$TOOL" != "amp" && "$TOOL" != "claude" ]]; then
  echo "Error: Invalid tool '$TOOL'. Must be 'amp' or 'claude'."
  exit 1
fi

# --- Setup ---

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Claude Code refuses to launch inside another Claude Code session.
# ralph.sh may be started from within a Claude Code session, so unset
# the environment variable that triggers the nested-session guard.
unset CLAUDECODE

ARCHIVE_DIR="$SCRIPT_DIR/archive"
mkdir -p "$ARCHIVE_DIR"

# --- Single Instance Lock ---
# Prevent multiple ralph.sh daemons from running simultaneously.

PIDFILE="$SCRIPT_DIR/.ralph.pid"

if [ -f "$PIDFILE" ]; then
  EXISTING_PID=$(cat "$PIDFILE")
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Error: ralph.sh is already running (PID $EXISTING_PID)."
    echo "Kill it first: kill $EXISTING_PID"
    exit 1
  fi
  # Stale PID file from a crashed process — clean up
  rm -f "$PIDFILE"
fi

echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

# Colors
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# --- Helper Functions ---

# Find the next ready PRD file (sorted by timestamp in filename, oldest first).
# Ready means: starts with "prd-", ends with ".json", does NOT contain
# "~draft", "~running", or "~done" in the name.
find_next_prd() {
  find "$SCRIPT_DIR" -maxdepth 1 -name 'prd-*.json' -type f \
    ! -name '*~draft*' \
    ! -name '*~running*' \
    ! -name '*~done*' \
    2>/dev/null | sort | head -1
}

# Find the currently running PRD file (should be at most one).
find_running_prd() {
  find "$SCRIPT_DIR" -maxdepth 1 -name 'prd-*~running.json' -type f \
    2>/dev/null | sort | head -1
}

# Transition a PRD file to ~running state by renaming it.
# Input:  prd-2026-02-17-143000-improve-sdk.json
# Output: prd-2026-02-17-143000-improve-sdk~running.json
mark_running() {
  local prd_file="$1"
  local base
  base=$(basename "$prd_file" .json)
  local running_file="$SCRIPT_DIR/${base}~running.json"
  mv "$prd_file" "$running_file"
  echo "$running_file"
}

# Transition a PRD file from ~running to ~done state.
# Input:  prd-2026-02-17-143000-improve-sdk~running.json
# Output: prd-2026-02-17-143000-improve-sdk~done.json
mark_done() {
  local prd_file="$1"
  local done_file="${prd_file/~running/~done}"
  mv "$prd_file" "$done_file"
  echo "$done_file"
}

# Strip state suffixes (~running, ~done) from a basename to get the clean name.
clean_name() {
  local name="$1"
  name="${name/~running/}"
  name="${name/~done/}"
  echo "$name"
}

# Derive the progress.txt path from a PRD file (works with any state suffix).
# prd-2026-02-17-143000-improve-sdk~running.json -> progress-2026-02-17-143000-improve-sdk.txt
progress_file_for() {
  local prd_file="$1"
  local base
  base=$(basename "$prd_file" .json)
  local cleaned
  cleaned=$(clean_name "$base")
  # Replace "prd-" prefix with "progress-"
  local progress_name="progress-${cleaned#prd-}"
  echo "$SCRIPT_DIR/${progress_name}.txt"
}

# Archive a ~done PRD and its progress file.
# The ~done suffix is preserved in both the folder name and the PRD file
# so the completed state is visible in the archive history.
archive_run() {
  local prd_file="$1"
  local progress_file="$2"
  local base
  base=$(basename "$prd_file" .json)
  local archive_folder="$ARCHIVE_DIR/$base"

  mkdir -p "$archive_folder"

  [ -f "$prd_file" ] && mv "$prd_file" "$archive_folder/${base}.json"

  if [ -f "$progress_file" ]; then
    mv "$progress_file" "$archive_folder/progress.txt"
  fi

  echo -e "${GREEN}  Archived to: $archive_folder${RESET}"
}

# Stream filter: extracts concise progress lines from claude's stream-json output.
stream_filter() {
  local result_file="$1"

  while IFS= read -r line; do
    [ -z "$line" ] && continue

    local msg_type
    msg_type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null) || continue

    case "$msg_type" in
      assistant)
        local tool_uses
        tool_uses=$(echo "$line" | jq -r '
          .message.content[]? |
          select(.type == "tool_use") |
          .name + "\t" + (
            if .name == "Read" then (.input.file_path // "")
            elif .name == "Write" then (.input.file_path // "")
            elif .name == "Edit" then (.input.file_path // "")
            elif .name == "Bash" then ((.input.description // .input.command // "") | .[0:80])
            elif .name == "Glob" then (.input.pattern // "")
            elif .name == "Grep" then (.input.pattern // "") + " " + (.input.path // "")
            elif .name == "Task" then (.input.description // "")
            elif .name == "Skill" then (.input.skill // "")
            else (.input | tostring | .[0:60])
            end
          )
        ' 2>/dev/null)

        if [ -n "$tool_uses" ]; then
          while IFS=$'\t' read -r tool_name tool_detail; do
            [ -z "$tool_name" ] && continue
            printf "${CYAN}    ▸ %-8s${RESET} ${DIM}%s${RESET}\n" "$tool_name" "$tool_detail"
          done <<< "$tool_uses"
        fi

        local text_content
        text_content=$(echo "$line" | jq -r '
          [.message.content[]? | select(.type == "text") | .text] | join("")
        ' 2>/dev/null)

        if [ -n "$text_content" ] && [ "$text_content" != "null" ]; then
          printf "${GREEN}    ✦ %.120s${RESET}\n" "$text_content"
          if echo "$text_content" | grep -q "<promise>COMPLETE</promise>" 2>/dev/null; then
            echo "$text_content" >> "$result_file"
          fi
        fi
        ;;

      result)
        local result_text duration_s cost num_turns
        result_text=$(echo "$line" | jq -r '.result // ""' 2>/dev/null)
        duration_s=$(echo "$line" | jq -r '((.duration_ms // 0) / 1000 | floor)' 2>/dev/null)
        cost=$(echo "$line" | jq -r '.total_cost_usd // 0' 2>/dev/null)
        num_turns=$(echo "$line" | jq -r '.num_turns // 0' 2>/dev/null)

        echo "$result_text" >> "$result_file"

        printf "\n${YELLOW}    ⏱  %ss  │  %s turns  │  \$%s${RESET}\n" "$duration_s" "$num_turns" "$cost"
        ;;
    esac
  done
}

# Execute all stories in a single PRD file.
# Returns 0 if all stories pass, 1 otherwise.
execute_prd() {
  local prd_file="$1"
  local progress_file="$2"

  # Auto-calculate iterations from remaining stories
  local remaining total buffer max_iterations
  remaining=$(jq '[.userStories[] | select(.passes != true)] | length' "$prd_file" 2>/dev/null || echo "0")
  total=$(jq '.userStories | length' "$prd_file" 2>/dev/null || echo "?")

  if [ "$remaining" -eq 0 ]; then
    echo -e "${GREEN}  All stories already pass. Nothing to do.${RESET}"
    return 0
  fi

  buffer=$(( (remaining + 2) / 3 ))
  [ "$buffer" -lt 1 ] && buffer=1
  max_iterations=$(( remaining + buffer ))

  echo -e "  ${DIM}Stories: $remaining remaining (of $total total), $max_iterations iterations max${RESET}"

  # Initialize progress file
  if [ ! -f "$progress_file" ]; then
    echo "# Ralph Progress Log" > "$progress_file"
    echo "PRD: $(basename "$prd_file")" >> "$progress_file"
    echo "Started: $(date)" >> "$progress_file"
    echo "---" >> "$progress_file"
  fi

  for i in $(seq 1 $max_iterations); do
    # Check if all stories pass before each iteration
    remaining=$(jq '[.userStories[] | select(.passes != true)] | length' "$prd_file" 2>/dev/null || echo "0")
    if [ "$remaining" -eq 0 ]; then
      echo ""
      echo -e "  ${GREEN}All stories pass!${RESET} Completed before iteration $i."
      return 0
    fi

    echo ""
    echo -e "  ${BOLD}── Iteration $i/$max_iterations — $remaining stories remaining ──${RESET}"

    RESULT_FILE=$(mktemp)
    STDERR_FILE=$(mktemp)

    if [[ "$TOOL" == "amp" ]]; then
      OUTPUT=$(cat "$SCRIPT_DIR/RALPH.md" | amp --dangerously-allow-all 2>&1 | tee /dev/stderr) || true
      echo "$OUTPUT" > "$RESULT_FILE"
    else
      CLAUDE_ARGS=(--dangerously-skip-permissions --print --output-format stream-json --verbose)
      [ -n "$MODEL" ] && CLAUDE_ARGS+=(--model "$MODEL")
      claude "${CLAUDE_ARGS[@]}" \
        < "$SCRIPT_DIR/RALPH.md" 2>"$STDERR_FILE" \
        | stream_filter "$RESULT_FILE" || true
    fi

    # Detect empty iterations: if claude produced no output at all, it likely
    # crashed or errored. Log stderr and abort the PRD to avoid burning
    # through all iterations with no work done.
    RESULT_SIZE=$(wc -c < "$RESULT_FILE" 2>/dev/null | tr -d ' ')
    if [ "${RESULT_SIZE:-0}" -eq 0 ]; then
      echo ""
      echo -e "  ${RED}Empty iteration — claude produced no output.${RESET}"
      if [ -s "$STDERR_FILE" ]; then
        echo -e "  ${RED}stderr:${RESET}"
        head -20 "$STDERR_FILE" | while IFS= read -r errline; do
          echo -e "    ${DIM}$errline${RESET}"
        done
      fi
      rm -f "$RESULT_FILE" "$STDERR_FILE"
      echo -e "  ${YELLOW}Aborting PRD to avoid burning iterations.${RESET}"
      return 1
    fi

    rm -f "$STDERR_FILE"

    if [ -f "$RESULT_FILE" ] && grep -q "<promise>COMPLETE</promise>" "$RESULT_FILE" 2>/dev/null; then
      echo ""
      echo -e "  ${GREEN}All tasks complete!${RESET}"
      rm -f "$RESULT_FILE"
      return 0
    fi

    rm -f "$RESULT_FILE"
    sleep 2
  done

  echo ""
  echo -e "  ${YELLOW}Reached max iterations ($max_iterations) without completing all stories.${RESET}"
  return 1
}

# --- Main ---

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║  Ralph — Continuous PRD Consumer                         ║${RESET}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Tool:     ${CYAN}${TOOL}${RESET}"
[ -n "$MODEL" ] && echo -e "  Model:    ${CYAN}${MODEL}${RESET}"
echo -e "  Mode:     ${CYAN}$([ "$ONCE" = true ] && echo "single PRD" || echo "daemon (poll every ${POLL_INTERVAL}s)")${RESET}"
echo -e "  Watching: ${CYAN}${SCRIPT_DIR}${RESET}"
echo ""

# Recovery: if there is already a ~running PRD from a previous crash, resume it.
RUNNING_PRD=$(find_running_prd)
if [ -n "$RUNNING_PRD" ]; then
  echo -e "${YELLOW}  Resuming interrupted PRD: $(basename "$RUNNING_PRD")${RESET}"
fi

while true; do
  # Pick up a running PRD (from recovery) or find the next ready one
  if [ -z "$RUNNING_PRD" ]; then
    RUNNING_PRD=$(find_next_prd)
  fi

  if [ -z "$RUNNING_PRD" ]; then
    if [ "$ONCE" = true ]; then
      echo -e "${DIM}  No PRD files found. Exiting (--once mode).${RESET}"
      exit 0
    fi
    sleep "$POLL_INTERVAL"
    continue
  fi

  # Transition to ~running state if not already
  if [[ "$RUNNING_PRD" != *"~running"* ]]; then
    echo ""
    echo -e "${BOLD}┌───────────────────────────────────────────────────────────┐${RESET}"
    echo -e "${BOLD}│  Picked up: $(basename "$RUNNING_PRD")${RESET}"
    echo -e "${BOLD}└───────────────────────────────────────────────────────────┘${RESET}"
    RUNNING_PRD=$(mark_running "$RUNNING_PRD")
  fi

  PROGRESS_FILE=$(progress_file_for "$RUNNING_PRD")

  # Print project info
  local_project=$(jq -r '.project // "unknown"' "$RUNNING_PRD" 2>/dev/null)
  local_desc=$(jq -r '.description // ""' "$RUNNING_PRD" 2>/dev/null)
  echo -e "  ${CYAN}Project:${RESET} $local_project"
  [ -n "$local_desc" ] && echo -e "  ${DIM}$local_desc${RESET}"

  # Execute
  if execute_prd "$RUNNING_PRD" "$PROGRESS_FILE"; then
    # Transition: ~running -> ~done -> archive
    DONE_PRD=$(mark_done "$RUNNING_PRD")
    echo -e "${GREEN}  Marked done: $(basename "$DONE_PRD")${RESET}"
    archive_run "$DONE_PRD" "$PROGRESS_FILE"
  else
    # Even on failure, mark done and archive so we do not re-run forever
    echo -e "${YELLOW}  Incomplete — marking done and archiving.${RESET}"
    DONE_PRD=$(mark_done "$RUNNING_PRD")
    archive_run "$DONE_PRD" "$PROGRESS_FILE"
  fi

  # Clear running reference — loop will pick up the next ready PRD
  RUNNING_PRD=""

  if [ "$ONCE" = true ]; then
    echo ""
    echo -e "${DIM}  --once mode: exiting after single PRD.${RESET}"
    exit 0
  fi

  # Brief pause before checking for next PRD
  sleep 2
done
