#!/bin/bash
# perfect-cli-user.sh — Test CLI from a fresh user's perspective and create PRD(s).
#
# Usage: bash .ralph/perfect-cli-user.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read -r -d '' PROMPT <<'PROMPT_EOF' || true
You are a QA engineer performing a fresh-user experience test of the OpenTabs CLI. Install and use the CLI exactly as a real new user would — someone who has never heard of OpenTabs before — identify every friction point, then use the ralph skill to create PRD(s) to fix them.

You are sensitive to UX for general people (not nitpicking, not a plugin developer). You are a normal user who wants to try OpenTabs for the first time.

## IMPORTANT: Skip source code reading — go straight to testing

Do NOT spend time reading source code, CLAUDE.md files, or exploring the codebase. A real user has zero knowledge of the source code. Your fresh perspective IS the test.

Read only these two files for orientation (30 seconds max):
1. README.md
2. docs/content/docs/quick-start.mdx

Then immediately proceed to Docker setup and testing.

## Step 1: Set up a clean Docker environment

Kill any stale container, then launch fresh:

```bash
docker kill opentabs-ux-test 2>/dev/null; docker rm opentabs-ux-test 2>/dev/null; true
```

```bash
docker run --rm -d \
  --name opentabs-ux-test \
  --init --ipc=host --shm-size=2g \
  --network host \
  -e "HOME=/home/testuser" \
  -v "$HOME/.npmrc:/tmp/staging/.npmrc:ro" \
  ralph-worker:latest \
  "mkdir -p /home/testuser && cp /tmp/staging/.npmrc /home/testuser/.npmrc 2>/dev/null; sleep 86400"
```

Record Node.js version. All commands via `docker exec opentabs-ux-test`.

### Debugging principle

Capture stdout and stderr separately for commands that might fail:
```bash
docker exec opentabs-ux-test bash -c 'COMMAND 1>/tmp/cmd-stdout.txt 2>/tmp/cmd-stderr.txt; echo "EXIT=$?"'
```

## Step 2: Walk through the COMPLETE new-user journey

### Phase 1: Installation and first impression
- `npm install -g @opentabs-dev/cli`
- `opentabs --version`, `opentabs --help`, `opentabs` with no args
- `opentabs strat` (typo — error handling)

### Phase 2: First run
- `opentabs doctor`, `opentabs status`, `opentabs logs` (before starting)
- `opentabs start --show-config` (before server ever started)
- `opentabs start` in foreground (capture output, analyze first-time experience)

### Phase 3: Server running — test ALL commands
**Status & diagnostics:** status, status --json, doctor, logs, logs --lines 5, logs --plugin nonexistent, audit, audit --json, audit --file, audit --since 1h, audit --limit 5, audit --since invalid

**Config management:** config show, config show --json, config show --show-secret, config path, config set port 8080/9515, config set invalidkey foo, config set prot 9515 (typo), config set port notanumber/0/99999, config set browser-tool.browser_execute_script disabled/enabled, config set browser-tool.nonexistent_tool disabled, config set localPlugins.add /tmp/nonexistent, config reset (without/with --confirm), config rotate-secret (without/with --confirm)

**Plugin management:** plugin, plugin search, plugin search slack, plugin search nonexistent, plugin list/list --json, plugin install slack, plugin list --verbose, plugin remove slack (without/with --confirm), plugin install slack again, plugin install nonexistent-plugin, plugin create test-plugin --domain .example.com, plugin configure slack (interactive instance URL setup)

**Tool interface (CLI mode):** tool, tool list, tool list --json, tool list --plugin slack, tool list --plugin nonexistent, tool schema slack_send_message, tool schema nonexistent_tool, tool call browser_list_tabs, tool call nonexistent_tool '{}', tool call with malformed JSON

**Server lifecycle:** start again (port conflict), stop, background mode (start --background, status, stop), stop when not running, custom port end-to-end (start --port 8888, status/doctor --port 8888)

**Other:** opentabs update, start --show-config (verify all three connection modes: full MCP, gateway MCP, CLI-only are shown), every --help flag

### Phase 4: Config reset and fresh re-start
config reset --confirm, config show, doctor, start again

### Phase 5: Server stopped — test offline behavior
status, doctor, audit, audit --file, logs, plugin list, config show

### Phase 6: Cleanup
`docker kill opentabs-ux-test`

## Step 3: Evaluate every interaction

For each command, evaluate as a NORMAL USER:
1. **Clarity**: Would a new user understand and know what to do next?
2. **Correctness**: Does output match reality? Are configs functional?
3. **Completeness**: Is important information missing?
4. **Error handling**: Do errors provide actionable guidance?
5. **Consistency**: Are patterns consistent across commands?

### Categories of friction:
- Broken flows, confusing output, missing information, excessive information
- Silent failures (exit non-zero with no output), poor error messages
- Discoverability gaps

### What NOT to report (domain-specific):
- Plugin ecosystem being WIP (limited plugins) — temporary
- `opentabs-plugin` CLI not globally available — WIP
- Docker/headless environment issues — OpenTabs is for headed mode
- `opentabs` with no args showing "Server not running" — intentional

## Step 4: Create PRD(s) using the ralph skill

Use the skill tool to load the "ralph" skill, then follow its instructions to create PRD(s).

Key parameters:
- Target project: "OpenTabs Platform" (root monorepo) unless fix is docs-only
- For docs-only fixes discovered through execution: project "OpenTabs Docs", workingDirectory "docs", qualityChecks "cd docs && npm run build && npm run type-check && npm run lint && npm run knip && npm run format:check"
- All stories: e2eCheckpoint: false (CLI changes are not browser-observable)

Severity triage (for prioritization, not filtering):
- **HIGH**: Broken flows, silent data loss, crashes
- **MEDIUM**: Confusing output, missing information, poor discoverability
- **LOW**: Minor inconsistencies, edge case polish
PROMPT_EOF

echo "=== perfect-cli-user.sh ==="
echo "Launching Claude to test CLI user experience and create PRD(s)..."
echo ""

echo "$PROMPT" | bash "$SCRIPT_DIR/run-prompt.sh"
