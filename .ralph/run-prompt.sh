#!/bin/bash
# run-prompt.sh — Run a prompt through Claude with streaming progress output.
#
# Usage:
#   echo "$PROMPT" | bash .ralph/run-prompt.sh
#   bash .ralph/run-prompt.sh < prompt.md
#   bash .ralph/run-prompt.sh -p "do something"
#
# Reads a prompt from stdin (or -p argument), pipes it to claude with
# --dangerously-skip-permissions and --output-format stream-json, then
# filters the JSON stream into readable progress lines showing tool
# invocations and text responses.
#
# Options:
#   -p <prompt>   Pass prompt as argument instead of stdin
#   --model <m>   Override the default model

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Prevent Claude Code from detecting a nested session.
unset CLAUDECODE

# --- Argument parsing ---
PROMPT=""
MODEL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -p)
      PROMPT="$2"
      shift 2
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --model=*)
      MODEL="${1#*=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# If no -p argument, read prompt from stdin.
if [ -z "$PROMPT" ]; then
  PROMPT=$(cat)
fi

if [ -z "$PROMPT" ]; then
  echo "Error: No prompt provided. Use -p or pipe via stdin." >&2
  exit 1
fi

# --- Prepend shared perfect audit guidelines ---
PERFECT_PROMPT_FILE="$SCRIPT_DIR/perfect-prompt.md"
if [ -f "$PERFECT_PROMPT_FILE" ]; then
  PROMPT="$(cat "$PERFECT_PROMPT_FILE")

---

$PROMPT"
fi

# Use a per-invocation unique findings file to prevent race conditions when
# multiple audit scripts run in parallel and write to the same file.
FINDINGS_FILE="/tmp/perfect-findings-$$.md"
PROMPT="${PROMPT//\/tmp\/perfect-findings.md/$FINDINGS_FILE}"

# --- Stream filter ---
# Extracts readable progress lines from claude's stream-json output.
# Shows tool invocations (Read, Write, Edit, Bash, etc.) and text responses.

stream_filter() {
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
            printf "▸ %-8s %s\n" "$tool_name" "$tool_detail"
          done <<< "$tool_uses"
        fi
        local text_content
        text_content=$(echo "$line" | jq -r '
          [.message.content[]? | select(.type == "text") | .text] | join("")
        ' 2>/dev/null)
        if [ -n "$text_content" ] && [ "$text_content" != "null" ]; then
          printf "✦ %.120s\n" "$text_content"
        fi
        ;;
      result)
        local duration_s cost num_turns
        duration_s=$(echo "$line" | jq -r '((.duration_ms // 0) / 1000 | floor)' 2>/dev/null)
        cost=$(echo "$line" | jq -r '.total_cost_usd // 0' 2>/dev/null)
        num_turns=$(echo "$line" | jq -r '.num_turns // 0' 2>/dev/null)
        printf "⏱  %ss  │  %s turns  │  \$%s\n" "$duration_s" "$num_turns" "$cost"
        ;;
    esac
  done
}

# --- Run claude ---
CLAUDE_ARGS=(--dangerously-skip-permissions --output-format stream-json --verbose)
[ -n "$MODEL" ] && CLAUDE_ARGS+=(--model "$MODEL")

cd "$REPO_ROOT"
claude "${CLAUDE_ARGS[@]}" < <(echo "$PROMPT") | stream_filter
