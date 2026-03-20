#!/usr/bin/env bash
# ============================================================================
# OpenTabs Windows E2E — Host-Side Orchestrator
#
# Runs on the Linux host (ssh pc). Starts the Windows VM via Docker Compose,
# waits for Windows to install and tests to complete, then collects results.
#
# Usage:
#   ssh pc "cd ~/workspace/opentabs && bash e2e/windows/run.sh"
#
# Options:
#   --fresh     Delete existing VM storage and start from scratch
#   --keep      Keep the VM running after tests complete
#   --timeout N Maximum wait time in minutes (default: 45)
#   --pull      Git pull before running
#
# Prerequisites:
#   - Linux host with KVM support (/dev/kvm)
#   - Docker with docker compose plugin
#   - dockur/windows image (pulled automatically)
#
# The VM is persistent by default — subsequent runs reuse the installed
# Windows, skipping the 10-15 minute install phase. Use --fresh to force
# a full reinstall.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
COMPOSE_FILE="$SCRIPT_DIR/compose.yml"

# Defaults
FRESH=false
KEEP=false
TIMEOUT_MINUTES=45
PULL=false

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --fresh) FRESH=true; shift ;;
        --keep) KEEP=true; shift ;;
        --timeout) TIMEOUT_MINUTES="$2"; shift 2 ;;
        --pull) PULL=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

TIMEOUT_SECONDS=$((TIMEOUT_MINUTES * 60))

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# --------------------------------------------------------------------------
# Setup
# --------------------------------------------------------------------------

if [[ "$PULL" == true ]]; then
    log "Pulling latest changes..."
    cd "$REPO_DIR" && git pull --rebase
fi

if [[ "$FRESH" == true ]]; then
    log "Cleaning up previous VM storage..."
    rm -rf "$SCRIPT_DIR/storage"
fi

# Clean results directory
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"

# --------------------------------------------------------------------------
# Start the Windows VM
# --------------------------------------------------------------------------

log "Starting Windows VM..."
docker compose -f "$COMPOSE_FILE" up -d

# Check if this is a fresh install or reboot of existing VM
if [[ -f "$SCRIPT_DIR/storage/windows.boot" ]]; then
    log "Reusing existing Windows installation (use --fresh for clean install)"
    INSTALL_PHASE=false
else
    log "Fresh Windows installation starting (this takes 10-15 minutes)..."
    INSTALL_PHASE=true
fi

# --------------------------------------------------------------------------
# Wait for tests to complete
# --------------------------------------------------------------------------

log "Waiting for tests to complete (timeout: ${TIMEOUT_MINUTES}m)..."
log "Web viewer available at http://localhost:8006"
log "RDP available at localhost:3389 (user: opentabs, pass: opentabs)"

START_TIME=$(date +%s)

while true; do
    ELAPSED=$(( $(date +%s) - START_TIME ))

    if [[ $ELAPSED -ge $TIMEOUT_SECONDS ]]; then
        log "TIMEOUT: Tests did not complete within ${TIMEOUT_MINUTES} minutes"

        # Dump whatever logs we have
        if [[ -f "$RESULTS_DIR/install.log" ]]; then
            log "=== Install Log (last 50 lines) ==="
            tail -50 "$RESULTS_DIR/install.log"
        fi

        if [[ "$KEEP" != true ]]; then
            log "Stopping VM..."
            docker compose -f "$COMPOSE_FILE" down
        fi
        exit 1
    fi

    # Check status file written by install.bat
    if [[ -f "$RESULTS_DIR/status.txt" ]]; then
        STATUS=$(cat "$RESULTS_DIR/status.txt" | tr -d '\r\n ')
        if [[ "$STATUS" == "DONE" ]]; then
            log "Tests completed!"
            break
        elif [[ "$STATUS" == "READY" ]]; then
            ELAPSED_MIN=$((ELAPSED / 60))
            log "Build complete, tests running... (${ELAPSED_MIN}m elapsed)"
        fi
    fi

    sleep 10
done

# --------------------------------------------------------------------------
# Collect and display results
# --------------------------------------------------------------------------

log ""
log "========================================="
log "RESULTS"
log "========================================="

if [[ -f "$RESULTS_DIR/results.log" ]]; then
    cat "$RESULTS_DIR/results.log"
else
    log "WARNING: No results.log found"
fi

log ""

if [[ -f "$RESULTS_DIR/results.json" ]]; then
    log "Machine-readable results: $RESULTS_DIR/results.json"

    # Parse pass/fail from JSON
    PASSED=$(python3 -c "import json; print(json.load(open('$RESULTS_DIR/results.json'))['passed'])" 2>/dev/null || echo "?")
    FAILED=$(python3 -c "import json; print(json.load(open('$RESULTS_DIR/results.json'))['failed'])" 2>/dev/null || echo "?")
    log "Summary: $PASSED passed, $FAILED failed"
fi

if [[ -f "$RESULTS_DIR/results-detail.log" ]]; then
    log "Detailed output: $RESULTS_DIR/results-detail.log"
fi

# --------------------------------------------------------------------------
# Cleanup
# --------------------------------------------------------------------------

if [[ "$KEEP" != true ]]; then
    log "Stopping VM..."
    docker compose -f "$COMPOSE_FILE" down
else
    log "VM kept running (--keep). Stop with: docker compose -f $COMPOSE_FILE down"
fi

# Exit with test result
if [[ -f "$RESULTS_DIR/results.json" ]]; then
    FAILED=$(python3 -c "import json; print(json.load(open('$RESULTS_DIR/results.json'))['failed'])" 2>/dev/null || echo "1")
    if [[ "$FAILED" != "0" ]]; then
        exit 1
    fi
fi

log "All tests passed!"
exit 0
