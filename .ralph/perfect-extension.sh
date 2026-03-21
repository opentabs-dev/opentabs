#!/bin/bash
# perfect-extension.sh — Audit the Chrome extension and create PRD(s).
#
# Usage: bash .ralph/perfect-extension.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read -r -d '' PROMPT <<'PROMPT_EOF' || true
You are auditing the OpenTabs Chrome extension (platform/browser-extension/) to find bugs, resource leaks, missing error handling, and code quality issues with concrete consequences. Read every source file thoroughly, identify genuine problems, then use the ralph skill to create PRD(s) to fix them.

## Step 1: Read the rules and understand the codebase

1. Read CLAUDE.md (root) — overall platform architecture, key concepts, commands
2. Read platform/browser-extension/CLAUDE.md — extension-specific conventions, React rules, theme system, component guidelines

## Step 2: Thoroughly read all extension source code

Read every file in the Chrome extension source:

### Background service worker
- platform/browser-extension/src/background.ts
- platform/browser-extension/src/background-message-handlers.ts
- platform/browser-extension/src/side-panel-toggle.ts
- platform/browser-extension/src/confirmation-badge.ts
- platform/browser-extension/src/tab-state.ts
- platform/browser-extension/src/iife-injection.ts (includes resolvePerTabSettings for multi-instance per-tab config injection, instanceMap propagation through 4 injection paths)
- platform/browser-extension/src/network-capture.ts
- platform/browser-extension/src/rate-limiter.ts
- platform/browser-extension/src/message-router.ts (includes parseInstanceMap, instanceMap on ValidatedPluginPayload)
- platform/browser-extension/src/plugin-storage.ts

### Offscreen document
- platform/browser-extension/src/offscreen/index.ts

### Side panel React UI
- platform/browser-extension/src/side-panel/App.tsx
- platform/browser-extension/src/side-panel/bridge.ts
- platform/browser-extension/src/side-panel/hooks/*.ts
- platform/browser-extension/src/side-panel/components/*.tsx
- platform/browser-extension/src/side-panel/constants.ts

### Tool dispatch
- platform/browser-extension/src/tool-dispatch.ts
- platform/browser-extension/src/dispatch-helpers.ts

### Shared types, constants, and build
- platform/browser-extension/src/extension-messages.ts (includes PluginMeta with instanceMap, resolvedSettings as Record<string, unknown>)
- platform/browser-extension/src/constants.ts
- platform/browser-extension/src/tab-matching.ts
- platform/browser-extension/build-extension.ts
- platform/browser-extension/build-side-panel.ts

### What to look for:

- **Race conditions** between async operations, state desynchronization between UI and server
- **Resource leaks**: Maps/Sets/caches that grow unboundedly, timers not cleared, event listeners not removed, orphaned WebSocket connections
- **Missing error handling**: Unhandled promise rejections, silent error swallowing, missing .catch(), missing Chrome API guards
- **Missing cleanup**: useEffect hooks without cleanup returns, Chrome message listeners not removed, intervals not cleared on unmount
- **React anti-patterns**: Stale closures in useCallback/useEffect, missing dependencies in hooks, state that should be derived
- **Dead code**: Unreachable code paths, unused functions/variables/imports

## Step 3: Create PRD(s) using the ralph skill

Use the skill tool to load the "ralph" skill, then follow its instructions to create PRD(s).

Key parameters for extension PRDs:
- Target project: "OpenTabs Platform" (root monorepo)
- Do NOT set workingDirectory or qualityChecks (root monorepo defaults apply)
- Set e2eCheckpoint: true on the final story if any story touches browser-observable behavior
- Set e2eCheckpoint: false for purely internal fixes (error handling, resource leaks, dead code)
PROMPT_EOF

echo "=== perfect-extension.sh ==="
echo "Launching Claude to audit browser extension and create PRD(s)..."
echo ""

echo "$PROMPT" | bash "$SCRIPT_DIR/run-prompt.sh"
