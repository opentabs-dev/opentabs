#!/bin/bash
# Ralph — Parallel PRD consumer daemon using git worktrees + Docker isolation
#
# Usage: .ralph/ralph.sh [--tool amp|claude] [--once] [--poll N] [--workers N]
#
# Watches .ralph/ for PRD files and processes them in parallel using git worktrees.
# Each PRD gets its own worktree so agents run in full isolation — no type-check,
# lint, or build conflicts between concurrent agents.
#
# Each worker runs inside a Docker container. When ralph needs to kill a worker,
# `docker kill` atomically destroys every process in the container via cgroups —
# no orphaned Chromium instances, no pattern-matching cleanup loops, no escaped
# process groups. This solves the fundamental problem that macOS has no kernel-
# level mechanism to atomically kill a process subtree.
#
# PRD file name state machine:
#   prd-YYYY-MM-DD-HHMMSS-objective~draft.json    — being written, ignored
#   prd-YYYY-MM-DD-HHMMSS-objective.json           — ready to be picked up
#   prd-YYYY-MM-DD-HHMMSS-objective~running.json   — currently being executed
#   prd-YYYY-MM-DD-HHMMSS-objective~done.json      — completed, pending archive
#   archived to .ralph/archive/                     — final resting place
#
# Multiple PRDs can be ~running simultaneously (one per worker).
#
# Log format — every line in ralph.log:
#   HH:MM:SS [W<slot>:<objective>] <message>
#   e.g. 14:32:05 [W0:fix-bugs] ▸ Read    platform/mcp-server/src/index.ts

# NOTE: set -e is intentionally NOT used. This is a long-running daemon that
# must be resilient to individual command failures (git operations, file copies,
# jq parsing). Each failure is handled explicitly with || guards. Using set -e
# in a daemon causes cascading failures where a single transient error (e.g.,
# a missing temp file) kills the entire process tree.

# --- Argument Parsing ---

TOOL="claude"
MODEL=""
ONCE=false
POLL_INTERVAL=5
MAX_WORKERS=3

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
    --workers)
      MAX_WORKERS="$2"
      shift 2
      ;;
    --workers=*)
      MAX_WORKERS="${1#*=}"
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

if ! [[ "$MAX_WORKERS" =~ ^[0-9]+$ ]] || [ "$MAX_WORKERS" -lt 1 ]; then
  echo "Error: --workers must be a positive integer (got '$MAX_WORKERS')."
  exit 1
fi

if ! [[ "$POLL_INTERVAL" =~ ^[0-9]+$ ]] || [ "$POLL_INTERVAL" -lt 1 ]; then
  echo "Error: --poll must be a positive integer (got '$POLL_INTERVAL')."
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
WORKTREE_BASE="$SCRIPT_DIR/worktrees"
mkdir -p "$ARCHIVE_DIR" "$WORKTREE_BASE"

# --- Docker Configuration ---
DOCKER_IMAGE="ralph-worker:latest"
CONTAINER_PREFIX="ralph-worker"

# --- Auto-Logging ---
# Always tee output to .ralph/ralph.log so diagnostics are never lost,
# regardless of how the script is launched (nohup, /dev/null, foreground).
# The re-exec guard (__RALPH_LOGGING) prevents infinite recursion.
# Appends to the existing log file so `tail -f ralph.log` survives daemon
# restarts (the file inode stays the same).

LOG_FILE="$SCRIPT_DIR/ralph.log"

if [ -z "${__RALPH_LOGGING:-}" ]; then
  # Re-exec with output tee'd to log file. Use exec so the PID stays the same.
  export __RALPH_LOGGING=1
  exec > >(tee -a "$LOG_FILE") 2>&1
fi

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

# --- Docker Prerequisite Check ---
# Verify Docker is available and the ralph-worker image exists.

if ! command -v docker &>/dev/null; then
  echo "Error: Docker is not installed or not in PATH."
  echo "Install Docker Desktop or OrbStack: https://orbstack.dev/"
  exit 1
fi

if ! docker info &>/dev/null; then
  echo "Error: Docker daemon is not running."
  echo "Start Docker Desktop or OrbStack, then retry."
  exit 1
fi

if ! docker image inspect "$DOCKER_IMAGE" &>/dev/null; then
  echo "Error: Docker image '$DOCKER_IMAGE' not found."
  echo "Build it first: bash .ralph/docker-build.sh"
  exit 1
fi

# --- Startup Orphan Cleanup ---
# If the previous ralph daemon was killed with SIGKILL (kill -9), the trap
# handler never runs and leftover containers may survive. With Docker, this
# is a simple container list + kill — no pgrep pattern matching, no process
# tree walking, no escaping via setsid(). Cgroups guarantee that killing a
# container destroys every process inside.

cleanup_orphans_from_previous_run() {
  local orphan_count=0

  # Find all ralph-worker containers (running or stopped)
  local containers
  containers=$(docker ps -a --filter "name=${CONTAINER_PREFIX}-" --format '{{.Names}}' 2>/dev/null) || true

  if [ -n "$containers" ]; then
    while IFS= read -r cname; do
      [ -z "$cname" ] && continue
      # Kill if running, then remove
      docker kill "$cname" 2>/dev/null || true
      docker rm -f "$cname" 2>/dev/null || true
      orphan_count=$((orphan_count + 1))
    done <<< "$containers"
  fi

  if [ "$orphan_count" -gt 0 ]; then
    echo -e "$(ts) ${YELLOW}Cleaned up $orphan_count orphaned container(s) from previous run.${RESET}"
  fi
}

cleanup_orphans_from_previous_run

# Colors
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# --- Timestamp helper ---
# Short PST timestamp for log lines.
ts() {
  TZ=America/Los_Angeles date +'%H:%M:%S'
}

# Check if there are any remaining ready PRDs to dispatch.
has_ready_prds() {
  local count
  count=$(find "$SCRIPT_DIR" -maxdepth 1 -name 'prd-*.json' -type f \
    ! -name '*~draft*' \
    ! -name '*~running*' \
    ! -name '*~done*' \
    2>/dev/null | wc -l | tr -d ' ')
  [ "$count" -gt 0 ]
}

# --- Worker Tracking ---
# Parallel arrays indexed by slot number (0..MAX_WORKERS-1).
# Empty string means the slot is free.
# WORKER_CONTAINERS holds Docker container names instead of PIDs.
# WORKER_LOG_PIDS holds the PID of the `docker logs -f` process that
# streams container output into ralph.log.

declare -a WORKER_CONTAINERS=()
declare -a WORKER_LOG_PIDS=()
declare -a WORKER_PRDS=()
declare -a WORKER_WORKTREES=()
declare -a WORKER_BRANCHES=()
declare -a WORKER_TAGS=()

for (( s=0; s<MAX_WORKERS; s++ )); do
  WORKER_CONTAINERS[$s]=""
  WORKER_LOG_PIDS[$s]=""
  WORKER_PRDS[$s]=""
  WORKER_WORKTREES[$s]=""
  WORKER_BRANCHES[$s]=""
  WORKER_TAGS[$s]=""
done

# --- Cleanup ---
# On exit, kill all running worker containers and remove worktrees.
# Docker containers are killed atomically via `docker kill` — cgroups
# guarantee every process inside (Chromium, Playwright, test servers)
# dies immediately. No three-phase kill, no process tree walking, no
# pattern matching.

cleanup() {
  echo ""
  echo -e "$(ts) ${YELLOW}Shutting down ralph...${RESET}"

  # Abort any in-progress git merge on the main worktree.
  # If SIGTERM arrives while reap_workers is running git merge, the main
  # worktree could be left in a partial merge state.
  git merge --abort 2>/dev/null || true

  for (( s=0; s<MAX_WORKERS; s++ )); do
    local container="${WORKER_CONTAINERS[$s]}"
    local log_pid="${WORKER_LOG_PIDS[$s]}"
    local wt="${WORKER_WORKTREES[$s]}"
    local br="${WORKER_BRANCHES[$s]}"
    local prd="${WORKER_PRDS[$s]}"

    if [ -n "$container" ]; then
      # Check if the container is still running
      if docker inspect --format='{{.State.Running}}' "$container" 2>/dev/null | grep -q true; then
        echo -e "$(ts) ${DIM}Killing container $container (worker $s)...${RESET}"
        # docker kill sends SIGKILL to PID 1 in the container, and cgroups
        # guarantee all processes inside die atomically.
        docker kill "$container" 2>/dev/null || true
      fi
      # Remove the stopped container
      docker rm -f "$container" 2>/dev/null || true
    fi

    # Kill the log-streaming process
    if [ -n "$log_pid" ] && kill -0 "$log_pid" 2>/dev/null; then
      kill "$log_pid" 2>/dev/null || true
      wait "$log_pid" 2>/dev/null || true
    fi

    # Sync PRD and progress from worktree back to main .ralph/ so the
    # agent's progress (which stories passed) survives the shutdown.
    if [ -n "$wt" ] && [ -d "$wt" ] && [ -n "$prd" ]; then
      local prd_bn progress_bn
      prd_bn=$(basename "$prd")
      progress_bn=$(basename "$(progress_file_for "$prd")")
      [ -f "$wt/.ralph/$prd_bn" ] && cp "$wt/.ralph/$prd_bn" "$prd" 2>/dev/null || true
      [ -f "$wt/.ralph/$progress_bn" ] && cp "$wt/.ralph/$progress_bn" "$(progress_file_for "$prd")" 2>/dev/null || true
    fi

    # Remove the worktree (ephemeral checkout) but preserve branches that
    # have unmerged commits — these contain completed story work from the
    # interrupted run. On restart, dispatch_prd creates a new worktree from
    # the preserved branch so the agent resumes where it left off.
    if [ -n "$wt" ] && [ -d "$wt" ]; then
      echo -e "$(ts) ${DIM}Removing worktree: $wt${RESET}"
      remove_worktree "$wt"
    fi
    if [ -n "$br" ]; then
      local unmerged
      unmerged=$(git rev-list --count "HEAD..$br" 2>/dev/null || echo "0")
      if [ "$unmerged" -gt 0 ]; then
        echo -e "$(ts) ${YELLOW}Preserving branch $br ($unmerged unmerged commit(s)).${RESET}"
      else
        git branch -D "$br" 2>/dev/null || true
      fi
    fi

    # Revert PRD from ~running back to ready so it's picked up on restart.
    if [ -n "$prd" ] && [ -f "$prd" ]; then
      local ready_prd="${prd/\~running.json/.json}"
      if [ "$prd" != "$ready_prd" ]; then
        mv "$prd" "$ready_prd" 2>/dev/null || true
        echo -e "$(ts) ${DIM}Reverted to ready: $(basename "$ready_prd")${RESET}"
      fi
    fi
  done

  # Prune stale worktree references
  git worktree prune 2>/dev/null || true

  rm -f "$PIDFILE"
  echo -e "$(ts) ${GREEN}Ralph stopped.${RESET}"
}

trap cleanup EXIT

# --- Logging helpers ---
# Every log line gets:  HH:MM:SS [W<slot>:<objective>] <message>
# For daemon-level messages (no worker), the tag is omitted.

# Pipe filter: prepends "HH:MM:SS <tag> " to every line read from stdin.
# Usage: some_command 2>&1 | ts_prefix "W0:fix-bugs"
ts_prefix() {
  local tag="$1"
  while IFS= read -r line; do
    printf "%s ${CYAN}[%s]${RESET} %s\n" "$(ts)" "$tag" "$line"
  done
}

# --- Helper Functions ---

# Kill a Docker container by name. Sends SIGKILL via cgroups which
# atomically destroys every process inside — Chromium, Playwright workers,
# test servers, and all their children. No orphans, no pattern matching.
kill_container() {
  local container="$1"
  [ -z "$container" ] && return
  docker kill "$container" 2>/dev/null || true
  docker rm -f "$container" 2>/dev/null || true
}

# Robustly remove a git worktree directory.
# git worktree remove can fail when node_modules or other large trees have
# open file handles (Spotlight, FSEvents, lingering processes). Fall back to
# rm -rf, retrying once after a short sleep if the first attempt fails.
remove_worktree() {
  local wt="$1"
  [ -z "$wt" ] || [ ! -d "$wt" ] && return 0

  # Try git's own removal first (unregisters from .git/worktrees too).
  git worktree remove --force "$wt" >/dev/null 2>&1 && return 0

  # git failed — force-remove the directory.
  rm -rf "$wt" 2>/dev/null && { git worktree prune 2>/dev/null || true; return 0; }

  # If rm -rf failed (open file handles), wait and retry once.
  sleep 2
  rm -rf "$wt" 2>/dev/null || true
  git worktree prune 2>/dev/null || true
}

# Find ALL ready PRD files (sorted by timestamp, oldest first).
find_ready_prds() {
  find "$SCRIPT_DIR" -maxdepth 1 -name 'prd-*.json' -type f \
    ! -name '*~draft*' \
    ! -name '*~running*' \
    ! -name '*~done*' \
    2>/dev/null | sort
}

# Find all currently running PRD files.
find_running_prds() {
  find "$SCRIPT_DIR" -maxdepth 1 -name 'prd-*~running.json' -type f \
    2>/dev/null | sort
}

# Count active workers.
count_active_workers() {
  local count=0
  for (( s=0; s<MAX_WORKERS; s++ )); do
    [ -n "${WORKER_CONTAINERS[$s]}" ] && count=$((count + 1))
  done
  echo "$count"
}

# Find a free worker slot. Returns slot number or empty string if none.
find_free_slot() {
  for (( s=0; s<MAX_WORKERS; s++ )); do
    if [ -z "${WORKER_CONTAINERS[$s]}" ]; then
      echo "$s"
      return
    fi
  done
  echo ""
}

# Extract a full slug from a PRD filename for use in branch/worktree names.
# prd-2026-02-17-143000-improve-sdk.json -> 2026-02-17-143000-improve-sdk
prd_slug() {
  local prd_file="$1"
  local base
  base=$(basename "$prd_file" .json)
  # Strip state suffixes
  base="${base/~running/}"
  base="${base/~done/}"
  base="${base/~draft/}"
  # Strip "prd-" prefix
  echo "${base#prd-}"
}

# Extract short human-readable objective from a PRD filename.
# prd-2026-02-17-143000-improve-sdk.json -> improve-sdk
prd_objective() {
  local slug
  slug=$(prd_slug "$1")
  # The slug is YYYY-MM-DD-HHMMSS-objective (18 chars of date prefix).
  echo "${slug:18}"
}

# Build the worker tag: W<slot>:<objective>
# e.g. W0:fix-bugs, W2:security-fixes
make_worker_tag() {
  local slot="$1"
  local prd_file="$2"
  local obj
  obj=$(prd_objective "$prd_file")
  # Truncate objective to 20 chars for readability
  echo "W${slot}:${obj:0:20}"
}

# Transition a PRD file to ~running state by renaming it.
# Returns the new path on stdout. Returns 1 if the source file is missing.
mark_running() {
  local prd_file="$1"
  if [ ! -f "$prd_file" ]; then
    echo "$prd_file"
    return 1
  fi
  local base
  base=$(basename "$prd_file" .json)
  local running_file="$SCRIPT_DIR/${base}~running.json"
  mv "$prd_file" "$running_file" || { echo "$prd_file"; return 1; }
  echo "$running_file"
}

# Transition a PRD file from ~running to ~done state.
# Returns the new path on stdout. Returns 1 if the source file is missing.
mark_done() {
  local prd_file="$1"
  local done_file="${prd_file/~running/~done}"
  if [ ! -f "$prd_file" ]; then
    echo "$done_file"
    return 1
  fi
  mv "$prd_file" "$done_file" || { echo "$done_file"; return 1; }
  echo "$done_file"
}

# Strip state suffixes (~running, ~done) from a basename to get the clean name.
clean_name() {
  local name="$1"
  name="${name/~running/}"
  name="${name/~done/}"
  name="${name/~draft/}"
  echo "$name"
}

# Derive the progress.txt path from a PRD file (works with any state suffix).
progress_file_for() {
  local prd_file="$1"
  local base
  base=$(basename "$prd_file" .json)
  local cleaned
  cleaned=$(clean_name "$base")
  local progress_name="progress-${cleaned#prd-}"
  echo "$SCRIPT_DIR/${progress_name}.txt"
}

# Archive a ~done PRD and its progress file.
# Tolerates missing files — does not fail if PRD or progress file is gone.
archive_run() {
  local prd_file="$1"
  local progress_file="$2"
  local tag="$3"
  local base
  base=$(basename "$prd_file" .json)
  local archive_folder="$ARCHIVE_DIR/$base"

  mkdir -p "$archive_folder" || return 1

  [ -f "$prd_file" ] && mv "$prd_file" "$archive_folder/${base}.json" 2>/dev/null || true

  if [ -f "$progress_file" ]; then
    mv "$progress_file" "$archive_folder/progress.txt" 2>/dev/null || true
  fi

  echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${GREEN}Archived to: $archive_folder${RESET}"
}

# NOTE: stream_filter (extracts concise progress lines from claude's
# stream-json output) is defined in worker.sh and runs inside the Docker
# container. The host-side only needs ts_prefix to add timestamps/tags
# to the already-filtered docker logs output.

# Dispatch a PRD to a free worker slot.
# Creates a worktree on the host (git operations), installs deps, builds,
# then launches a Docker container with the worktree bind-mounted at /workspace.
# The container runs worker.sh which executes the agent loop.
dispatch_prd() {
  local prd_file="$1"
  local slot="$2"

  local slug
  slug=$(prd_slug "$prd_file")
  local branch_name="ralph-$slug"
  local worktree_dir="$WORKTREE_BASE/$slug"
  local tag
  tag=$(make_worker_tag "$slot" "$prd_file")
  local container_name="${CONTAINER_PREFIX}-${slot}"

  echo ""
  echo -e "$(ts) ${BOLD}┌───────────────────────────────────────────────────────────┐${RESET}"
  echo -e "$(ts) ${BOLD}│  [${tag}] Dispatching: $(basename "$prd_file")${RESET}"
  echo -e "$(ts) ${BOLD}└───────────────────────────────────────────────────────────┘${RESET}"

  # Clean up any leftover container from a previous crashed run.
  docker rm -f "$container_name" 2>/dev/null || true

  # Mark PRD as running
  if ! prd_file=$(mark_running "$prd_file"); then
    echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${RED}Failed to mark PRD as running. File may have been moved.${RESET}"
    return 1
  fi

  local prd_project prd_desc
  prd_project=$(jq -r '.project // "unknown"' "$prd_file" 2>/dev/null)
  prd_desc=$(jq -r '.description // ""' "$prd_file" 2>/dev/null)
  echo -e "$(ts) ${CYAN}[${tag}]${RESET} Project: $prd_project"
  [ -n "$prd_desc" ] && echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${DIM}$prd_desc${RESET}"

  # Clean up any leftover worktree/branch from a previous crashed run.
  if [ -d "$worktree_dir" ]; then
    echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${DIM}Cleaning up stale worktree...${RESET}"
    remove_worktree "$worktree_dir"
  fi
  # Check if the branch exists with unmerged commits from a previous run.
  # If so, resume from that branch instead of starting fresh from HEAD.
  # The agent's PRD file tracks which stories already passed, so it will
  # skip completed stories and continue where it left off.
  local resume_branch=false
  if git rev-parse --verify "$branch_name" >/dev/null 2>&1; then
    local unmerged
    unmerged=$(git rev-list --count "HEAD..$branch_name" 2>/dev/null || echo "0")
    if [ "$unmerged" -gt 0 ]; then
      echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${GREEN}Resuming from branch $branch_name ($unmerged unmerged commit(s) from previous run).${RESET}"
      resume_branch=true
    else
      git branch -D "$branch_name" 2>/dev/null || true
    fi
  fi

  # Create worktree — either from the existing branch (resume) or a new
  # branch from HEAD (fresh start).
  echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${DIM}Creating worktree...${RESET}"
  if [ "$resume_branch" = true ]; then
    if ! git worktree add "$worktree_dir" "$branch_name" >/dev/null 2>&1; then
      echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${RED}Failed to create worktree from existing branch. Skipping PRD.${RESET}"
      mv "$prd_file" "${prd_file/\~running.json/.json}" 2>/dev/null || true
      return 1
    fi
  else
    if ! git worktree add "$worktree_dir" -b "$branch_name" HEAD >/dev/null 2>&1; then
      echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${RED}Failed to create worktree. Skipping PRD.${RESET}"
      mv "$prd_file" "${prd_file/\~running.json/.json}" 2>/dev/null || true
      return 1
    fi
  fi

  # Copy PRD and progress files into the worktree's .ralph/ directory.
  # The worktree has .ralph/RALPH.md (tracked) but not the PRD/progress (gitignored).
  mkdir -p "$worktree_dir/.ralph"
  cp "$prd_file" "$worktree_dir/.ralph/"

  local progress_file
  progress_file=$(progress_file_for "$prd_file")
  if [ -f "$progress_file" ]; then
    cp "$progress_file" "$worktree_dir/.ralph/"
  fi

  # Copy worker.sh into the worktree so the container can execute it.
  cp "$SCRIPT_DIR/worker.sh" "$worktree_dir/.ralph/worker.sh"

  # Install dependencies and build inside a Docker container.
  # Native binaries (esbuild, playwright) are platform-specific — bun install
  # on macOS produces darwin binaries that fail inside the Linux container.
  # Running install+build inside the container ensures Linux-native binaries.
  echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${DIM}Installing dependencies + building (in Docker)...${RESET}"
  local setup_script="cd $worktree_dir && bun install --frozen-lockfile 2>&1 | tail -1 && bun run build 2>&1 | tail -3"
  # Build e2e-test plugin if it exists
  if [ -f "$worktree_dir/plugins/e2e-test/package.json" ]; then
    local plugin_tmp_config="/tmp/opentabs-plugin-config-$$"
    setup_script="$setup_script && cd $worktree_dir/plugins/e2e-test && bun install --frozen-lockfile 2>&1 | tail -1 && OPENTABS_CONFIG_DIR=$plugin_tmp_config bun run build 2>&1 | tail -1"
  fi
  # Build common Docker args for setup and worker containers.
  #
  # IMPORTANT: Never mount files directly into /tmp/worker/ (the container
  # HOME). Docker creates parent directories as root when mounting into paths
  # that don't exist, making HOME unwritable by the non-root container user.
  # Instead, mount config files to /tmp/staging/ and copy them into HOME in
  # the CONTAINER_INIT command after creating the writable directory.
  local -a DOCKER_COMMON=()
  DOCKER_COMMON+=(--init --ipc=host --shm-size=2g)
  # Run as host user — Claude CLI refuses --dangerously-skip-permissions as
  # root, and file ownership in the bind-mounted worktree must match the host.
  DOCKER_COMMON+=(--user "$(id -u):$(id -g)")
  DOCKER_COMMON+=(-e "HOME=/tmp/worker")
  DOCKER_COMMON+=(-v "$worktree_dir:$worktree_dir")
  DOCKER_COMMON+=(-v "$PROJECT_DIR/.git:$PROJECT_DIR/.git")
  DOCKER_COMMON+=(--network host)
  # Stage host config files at /tmp/staging/ (read-only). These are copied
  # into the writable HOME by CONTAINER_INIT below.
  if [ -f "$HOME/.npmrc" ]; then
    DOCKER_COMMON+=(-v "$HOME/.npmrc:/tmp/staging/.npmrc:ro")
  fi
  if [ -f "$HOME/.claude/settings.json" ]; then
    DOCKER_COMMON+=(-v "$HOME/.claude/settings.json:/tmp/staging/claude-settings.json:ro")
  fi

  # Container init: create writable HOME and copy staged config files.
  # Runs before any other command in every container.
  local CONTAINER_INIT
  CONTAINER_INIT="mkdir -p /tmp/worker/.claude"
  CONTAINER_INIT="$CONTAINER_INIT && cp /tmp/staging/.npmrc /tmp/worker/.npmrc 2>/dev/null"
  CONTAINER_INIT="$CONTAINER_INIT; cp /tmp/staging/claude-settings.json /tmp/worker/.claude/settings.json 2>/dev/null"
  CONTAINER_INIT="$CONTAINER_INIT; true"

  if ! docker run --rm "${DOCKER_COMMON[@]}" \
    -w "$worktree_dir" \
    "$DOCKER_IMAGE" \
    "bash -c '$CONTAINER_INIT && $setup_script'"; then
    echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${RED}Setup (install+build) failed in Docker. Aborting worker.${RESET}"
    remove_worktree "$worktree_dir"
    if [ "$resume_branch" = false ]; then
      git branch -D "$branch_name" 2>/dev/null || true
    fi
    mv "$prd_file" "${prd_file/\~running.json/.json}" 2>/dev/null || true
    return 1
  fi

  # --- Launch Docker container ---
  # The container runs worker.sh with the worktree bind-mounted at /workspace.
  # All agent processes (claude, Playwright, Chromium, test servers) run inside
  # the container's cgroup. `docker kill` destroys them all atomically.

  local prd_basename
  prd_basename=$(basename "$prd_file")

  echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${DIM}Starting Docker container: $container_name${RESET}"

  # Collect environment variables for the Claude CLI.
  # The claude CLI reads auth/config from ~/.claude/ and ~/.claude.json.
  # The settings.json may contain env vars (ANTHROPIC_BASE_URL, etc.) that
  # claude reads at startup. We also pass them explicitly as container env
  # vars so claude and any subprocess can access them.
  local -a DOCKER_ENV_ARGS=()
  DOCKER_ENV_ARGS+=(-e "WORKER_TOOL=$TOOL")
  DOCKER_ENV_ARGS+=(-e "WORKER_MODEL=$MODEL")
  DOCKER_ENV_ARGS+=(-e "WORKER_PRD_FILE=$prd_basename")
  DOCKER_ENV_ARGS+=(-e "WORKER_RESULT_FILE=/tmp/worker-result.txt")
  # Prevent Claude Code from detecting a nested session
  DOCKER_ENV_ARGS+=(-e "CLAUDECODE=")

  # Forward Anthropic env vars from the host (set in ~/.claude/settings.json
  # or in the host shell). These are needed for the claude CLI to authenticate
  # against the correct API endpoint.
  for var in ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_AUTH_MODEL ANTHROPIC_API_KEY; do
    local val
    val=$(printenv "$var" 2>/dev/null) || true
    if [ -n "$val" ]; then
      DOCKER_ENV_ARGS+=(-e "$var=$val")
    fi
  done

  # Read env vars from claude settings.json and forward them.
  # This handles the case where the user configured env vars in settings
  # rather than in the shell (as in the current setup with ANTHROPIC_BASE_URL).
  local CLAUDE_SETTINGS="$HOME/.claude/settings.json"
  if [ -f "$CLAUDE_SETTINGS" ]; then
    local settings_envs
    settings_envs=$(jq -r '.env // {} | to_entries[] | .key + "=" + .value' "$CLAUDE_SETTINGS" 2>/dev/null) || true
    if [ -n "$settings_envs" ]; then
      while IFS= read -r kv; do
        [ -z "$kv" ] && continue
        DOCKER_ENV_ARGS+=(-e "$kv")
      done <<< "$settings_envs"
    fi
  fi

  # Build the docker run command.
  #
  # The container is self-contained — the only host mounts are the worktree
  # (read-write for git commits) and the main .git directory (for worktree
  # resolution). All other writes (HOME, .opentabs, .claude, node caches)
  # stay inside the container's filesystem and are discarded on exit.
  #
  # Key flags:
  #   --init      Tini as PID 1 to reap zombie processes (Chromium forks helpers)
  #   --ipc=host  Required for Chromium IPC (without it, Chrome crashes)
  #   --shm-size  Chromium uses /dev/shm heavily; default 64MB causes OOM crashes
  local -a DOCKER_ARGS=()
  DOCKER_ARGS+=(--name "$container_name")
  DOCKER_ARGS+=(--detach)
  DOCKER_ARGS+=("${DOCKER_COMMON[@]}")
  DOCKER_ARGS+=(-e "WORKER_WORKTREE_DIR=$worktree_dir")

  # Start the container. It runs worker.sh which executes the agent loop.
  # Container output (stdout+stderr) is captured by docker and streamed
  # via `docker logs -f` below.
  if ! docker run \
    "${DOCKER_ARGS[@]}" \
    "${DOCKER_ENV_ARGS[@]}" \
    -w "$worktree_dir" \
    "$DOCKER_IMAGE" \
    "$CONTAINER_INIT && bash $worktree_dir/.ralph/worker.sh" \
    >/dev/null 2>&1; then
    echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${RED}Failed to start Docker container. Aborting worker.${RESET}"
    remove_worktree "$worktree_dir"
    if [ "$resume_branch" = false ]; then
      git branch -D "$branch_name" 2>/dev/null || true
    fi
    mv "$prd_file" "${prd_file/\~running.json/.json}" 2>/dev/null || true
    return 1
  fi

  # Stream container logs in the background with timestamp prefix.
  # worker.sh runs stream_filter internally, so docker logs output is
  # already filtered — we only add the timestamp and worker tag here.
  (
    docker logs -f "$container_name" 2>&1 | ts_prefix "$tag"
  ) &
  local log_pid=$!

  WORKER_CONTAINERS[$slot]="$container_name"
  WORKER_LOG_PIDS[$slot]="$log_pid"
  WORKER_PRDS[$slot]="$prd_file"
  WORKER_WORKTREES[$slot]="$worktree_dir"
  WORKER_BRANCHES[$slot]="$branch_name"
  WORKER_TAGS[$slot]="$tag"

  echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${GREEN}Launched container: $container_name${RESET}"
  return 0
}

# Merge a worktree branch into the current branch.
# Returns 0 on success, 1 on conflict.
# On conflict, writes a breadcrumb file to .ralph/ with conflict details.
merge_worktree_branch() {
  local branch="$1"
  local tag="$2"
  local slug="$3"

  # Check if the branch has any commits beyond the fork point
  local commit_count
  commit_count=$(git rev-list --count "HEAD..$branch" 2>/dev/null || echo "0")

  if [ "$commit_count" -eq 0 ]; then
    echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${DIM}No commits to merge.${RESET}"
    return 0
  fi

  echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${DIM}Merging $commit_count commit(s) from $branch...${RESET}"

  local merge_output
  if merge_output=$(git merge --no-edit "$branch" 2>&1); then
    echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${GREEN}Merge successful.${RESET}"
    return 0
  else
    # Capture conflict details before aborting
    local conflicted_files
    conflicted_files=$(git diff --name-only --diff-filter=U 2>/dev/null)

    echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${RED}Merge conflict! Aborting merge.${RESET}"
    git merge --abort 2>/dev/null || true

    # Write a breadcrumb file so the user can easily find and resolve conflicts.
    local breadcrumb="$SCRIPT_DIR/${slug}.merge-conflict.txt"
    {
      echo "MERGE CONFLICT — Manual resolution required"
      echo "============================================"
      echo ""
      echo "Branch:    $branch"
      echo "Commits:   $commit_count"
      echo "Timestamp: $(date)"
      echo "Worker:    $tag"
      echo ""
      echo "To resolve:"
      echo "  git merge $branch"
      echo "  # Fix conflicts, then:"
      echo "  git add <resolved files>"
      echo "  git commit"
      echo "  git branch -D $branch"
      echo "  rm $(basename "$breadcrumb")"
      echo ""
      echo "Conflicted files:"
      if [ -n "$conflicted_files" ]; then
        echo "$conflicted_files" | while IFS= read -r f; do echo "  - $f"; done
      else
        echo "  (could not determine — run 'git merge $branch' to see)"
      fi
      echo ""
      echo "Merge output:"
      echo "$merge_output"
    } > "$breadcrumb"

    echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${YELLOW}Wrote conflict details to: $(basename "$breadcrumb")${RESET}"
    return 1
  fi
}

# Check for completed workers (Docker containers), merge results, clean up.
reap_workers() {
  for (( s=0; s<MAX_WORKERS; s++ )); do
    local container="${WORKER_CONTAINERS[$s]}"
    [ -z "$container" ] && continue

    # Check if the container is still running
    local running
    running=$(docker inspect --format='{{.State.Running}}' "$container" 2>/dev/null) || running="false"
    if [ "$running" = "true" ]; then
      continue
    fi

    # Container exited — collect results.
    # Get the container's exit code directly from Docker.
    local exit_code
    exit_code=$(docker inspect --format='{{.State.ExitCode}}' "$container" 2>/dev/null) || exit_code=1
    if ! [[ "$exit_code" =~ ^[0-9]+$ ]]; then
      exit_code=1
    fi

    # Kill the log-streaming process
    local log_pid="${WORKER_LOG_PIDS[$s]}"
    if [ -n "$log_pid" ] && kill -0 "$log_pid" 2>/dev/null; then
      kill "$log_pid" 2>/dev/null || true
      wait "$log_pid" 2>/dev/null || true
    fi

    # Remove the stopped container
    docker rm -f "$container" 2>/dev/null || true

    local prd_file="${WORKER_PRDS[$s]}"
    local worktree_dir="${WORKER_WORKTREES[$s]}"
    local branch_name="${WORKER_BRANCHES[$s]}"
    local tag="${WORKER_TAGS[$s]}"

    # Sync PRD and progress from worktree back to main .ralph/.
    # The container wrote these files via the bind-mounted worktree.
    if [ -n "$worktree_dir" ] && [ -d "$worktree_dir" ] && [ -n "$prd_file" ]; then
      local prd_bn progress_bn
      prd_bn=$(basename "$prd_file")
      progress_bn=$(basename "$(progress_file_for "$prd_file")")
      [ -f "$worktree_dir/.ralph/$prd_bn" ] && cp "$worktree_dir/.ralph/$prd_bn" "$prd_file" 2>/dev/null || true
      [ -f "$worktree_dir/.ralph/$progress_bn" ] && cp "$worktree_dir/.ralph/$progress_bn" "$(progress_file_for "$prd_file")" 2>/dev/null || true
    fi

    echo ""
    if [ "$exit_code" -eq 0 ]; then
      echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${GREEN}Worker completed successfully.${RESET}"
    else
      echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${YELLOW}Worker finished with errors (exit $exit_code).${RESET}"
    fi

    # Merge worktree branch into current branch.
    local slug
    slug=$(prd_slug "$prd_file")
    local merge_failed=false
    if ! merge_worktree_branch "$branch_name" "$tag" "$slug"; then
      merge_failed=true
      echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${RED}Could not merge. Commits remain on branch $branch_name.${RESET}"
      echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${YELLOW}Manual resolution needed: git merge $branch_name${RESET}"
    fi

    # Remove the worktree (always — it's just a checkout, commits live on the branch).
    remove_worktree "$worktree_dir"

    # Delete the branch only if merge succeeded (or had no commits).
    if [ "$merge_failed" = false ]; then
      git branch -D "$branch_name" 2>/dev/null || true
    fi

    # Transition PRD: ~running -> ~done -> archive
    local progress_file
    progress_file=$(progress_file_for "$prd_file")

    if [ "$exit_code" -eq 0 ]; then
      local done_prd
      done_prd=$(mark_done "$prd_file") || true
      echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${GREEN}Marked done: $(basename "$done_prd")${RESET}"
      archive_run "$done_prd" "$progress_file" "$tag"
    else
      echo -e "$(ts) ${CYAN}[${tag}]${RESET} ${YELLOW}Incomplete — marking done and archiving.${RESET}"
      local done_prd
      done_prd=$(mark_done "$prd_file") || true
      archive_run "$done_prd" "$progress_file" "$tag"
    fi

    # Free the slot
    WORKER_CONTAINERS[$s]=""
    WORKER_LOG_PIDS[$s]=""
    WORKER_PRDS[$s]=""
    WORKER_WORKTREES[$s]=""
    WORKER_BRANCHES[$s]=""
    WORKER_TAGS[$s]=""
  done
}

# --- Main ---

echo ""
echo -e "$(ts) ${BOLD}╔═══════════════════════════════════════════════════════════╗${RESET}"
echo -e "$(ts) ${BOLD}║  Ralph — Parallel PRD Consumer (Docker isolation)        ║${RESET}"
echo -e "$(ts) ${BOLD}╚═══════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "$(ts)   Tool:     ${CYAN}${TOOL}${RESET}"
[ -n "$MODEL" ] && echo -e "$(ts)   Model:    ${CYAN}${MODEL}${RESET}"
echo -e "$(ts)   Workers:  ${CYAN}${MAX_WORKERS}${RESET}"
echo -e "$(ts)   Image:    ${CYAN}${DOCKER_IMAGE}${RESET}"
echo -e "$(ts)   Mode:     ${CYAN}$([ "$ONCE" = true ] && echo "single batch" || echo "daemon (poll every ${POLL_INTERVAL}s)")${RESET}"
echo -e "$(ts)   Watching: ${CYAN}${SCRIPT_DIR}${RESET}"
echo ""

DISPATCHED_ANY=false

# Recovery: resume any ~running PRDs from a previous crash.
RUNNING_PRDS=$(find_running_prds)
if [ -n "$RUNNING_PRDS" ]; then
  echo -e "$(ts) ${YELLOW}Recovering interrupted PRDs:${RESET}"
  while IFS= read -r rprd; do
    [ -z "$rprd" ] && continue
    echo -e "$(ts) ${YELLOW}  - $(basename "$rprd")${RESET}"
    # dispatch_prd expects a non-running file and calls mark_running itself,
    # so rename ~running back to ready. If a slot is free, dispatch now;
    # otherwise the main loop will pick it up when a slot opens.
    local_ready="${rprd/\~running.json/.json}"
    mv "$rprd" "$local_ready" 2>/dev/null || true
    SLOT=$(find_free_slot)
    if [ -n "$SLOT" ]; then
      dispatch_prd "$local_ready" "$SLOT" && DISPATCHED_ANY=true || true
    else
      echo -e "$(ts) ${YELLOW}  (no free slots — will dispatch when a slot opens)${RESET}"
    fi
  done <<< "$RUNNING_PRDS"
fi

while true; do
  # Reap completed workers first
  reap_workers

  # Count active workers
  ACTIVE=$(count_active_workers)

  # In --once mode, exit only when all workers are done AND no more ready PRDs
  # remain. Without the has_ready_prds check, ralph exits prematurely if all
  # current workers complete in one reap cycle but more PRDs are still queued
  # (e.g., 5 PRDs with 3 workers — when the first 3 finish simultaneously,
  # the exit check would fire before the remaining 2 get dispatched).
  if [ "$ONCE" = true ] && [ "$DISPATCHED_ANY" = true ] && [ "$ACTIVE" -eq 0 ]; then
    if ! has_ready_prds; then
      echo ""
      echo -e "$(ts) ${DIM}--once mode: all PRDs complete. Exiting.${RESET}"
      exit 0
    fi
  fi

  # Dispatch new PRDs to free slots
  if [ "$ACTIVE" -lt "$MAX_WORKERS" ]; then
    READY_PRDS=$(find_ready_prds)

    if [ -n "$READY_PRDS" ]; then
      while IFS= read -r prd; do
        [ -z "$prd" ] && continue

        SLOT=$(find_free_slot)
        [ -z "$SLOT" ] && break  # All slots full

        dispatch_prd "$prd" "$SLOT" && DISPATCHED_ANY=true || true
      done <<< "$READY_PRDS"
    fi
  fi

  # In --once mode with nothing dispatched and no active workers, exit
  if [ "$ONCE" = true ] && [ "$DISPATCHED_ANY" = false ]; then
    ACTIVE=$(count_active_workers)
    if [ "$ACTIVE" -eq 0 ]; then
      echo -e "$(ts) ${DIM}No PRD files found. Exiting (--once mode).${RESET}"
      exit 0
    fi
  fi

  sleep "$POLL_INTERVAL"
done
