#!/bin/bash
# perfect-cli-platform-contributor.sh — Test platform contributor experience and create PRD(s).
#
# Usage: bash .ralph/perfect-cli-platform-contributor.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Kill the Docker test container on any exit (normal, error, or signal).
# This prevents container leaks when perfect.sh is interrupted (Ctrl+C).
cleanup_docker() {
  docker kill opentabs-platform-contributor-test 2>/dev/null || true
}
trap cleanup_docker EXIT SIGTERM SIGINT

read -r -d '' PROMPT <<'PROMPT_EOF' || true
You are a QA engineer performing a platform contributor experience test for the OpenTabs monorepo. Go through the entire contributor workflow — clone, install, build, run quality checks, make changes, run tests, exercise dev mode — and identify every friction point. Then use the ralph skill to create PRD(s) to fix them.

## Important context

- Platform contributors work on `platform/` (mcp-server, browser-extension, plugin-sdk, plugin-tools, cli, create-plugin, shared) and `e2e/`.
- Chrome extension UI cannot be interactively tested in Docker (no GUI). Focus on build, type-check, lint, knip, unit tests, E2E tests (headless Chromium via Playwright), and dev workflow friction.

## Step 1: Read the rules and understand the project

1. CLAUDE.md (root), CONTRIBUTING.md
2. platform/mcp-server/CLAUDE.md, platform/browser-extension/CLAUDE.md, platform/plugin-sdk/CLAUDE.md, platform/plugin-tools/CLAUDE.md, platform/cli/CLAUDE.md
3. e2e/CLAUDE.md
4. package.json (root), tsconfig.json (root)
5. .prettierignore, eslint.config.ts, knip.ts

## Step 2: Set up a clean Docker environment

```bash
docker run --rm -d \
  --name opentabs-platform-contributor-test \
  --network host --ipc=host --shm-size=2g \
  -v "$HOME/.npmrc:/root/.npmrc:ro" \
  -v "$(pwd):/repo:ro" \
  mcr.microsoft.com/playwright:v1.58.2-noble \
  tail -f /dev/null
```

Copy repo: `docker exec opentabs-platform-contributor-test bash -c "cp -r /repo /root/opentabs"`

All commands via `docker exec -w /root/opentabs opentabs-platform-contributor-test`.
IMPORTANT: Clean up when done: `docker stop opentabs-platform-contributor-test`

### Docker execution patterns

- **Port conflicts**: Uses `--network host`. Use non-default ports (e.g., PORT=19515) for dev servers.
- **Long-lived servers**: Use `timeout` to capture output without hanging.
- **Process cleanup**: Kill lingering processes between phases.
- **Exit codes**: Append `; echo EXIT: $?` (escaped as `\$?` in bash -c).

## Step 3: Walk through the COMPLETE contributor journey

### Phase 1: Initial setup
Clean artifacts, `npm install`, `npm run build`, `npm run build:force`.

### Phase 2: Run all quality checks individually
`npm run type-check`, `npm run lint`, `npm run format:check`, `npm run knip`, `npm run test`, install Playwright browsers, `npm run test:e2e`.

### Phase 3: Run combined check commands
`npm run check` — note which sub-step fails if any.

### Phase 4: Test incremental build performance
Trivial change to platform/shared/src/validation.ts, time `npm run build`, time `npx tsc --build`, time `npm run type-check`. Document fast path for TypeScript-only changes.

### Phase 5: Test dev workflow
Kill leftover processes first. Use PORT=19515 for all dev servers.
1. `npm run dev:mcp` (MCP server with hot reload)
2. `npm run dev` (full dev mode)
3. `npm run storybook`

### Phase 6: Error scenarios and edge cases
1. File with type errors — verify detection
2. E2E without building e2e-test plugin — check error message
3. Single E2E test execution
4. Clean + rebuild cycle
5. Clean:all + reinstall cycle
6. Checks after building docs (format:check still passes?)
7. Lint after generating storybook-static (eslint ignores it?)

### Phase 7: Test tsconfig coverage
Create .ts files outside src/, in src/ (test and non-test), verify tsc catches type errors.

### Phase 8: Test cross-package consistency
Workspace dependency resolution, type-check vs build equivalence, undocumented scripts.

### Phase 9: Skip
Documentation accuracy is audited by perfect-docs.sh.

### Phase 10: Test git hooks
Verify lefthook hooks are set up and execute correctly.

### Phase 11: Test CLI entrypoints
`npx opentabs --help`, `npx opentabs-plugin --help`.

### Phase 12: Cleanup
`docker stop opentabs-platform-contributor-test`

## Step 4: Evaluate every interaction (Phase 1 — Collect)

As you test each workflow, **append every friction point or issue to `/tmp/perfect-findings.md`** per the Audit Method above. Do not filter yet — just collect.

1. Does `npm install && npm run build` work cleanly on first try?
2. Do all six checks pass on a clean checkout?
3. Do E2E tests pass in Docker?
4. Is there a fast path for TypeScript-only changes?
5. Does dev mode work correctly?
6. Do errors tell the contributor what to do?
7. Do documented commands and workflows actually work when followed?
8. Do tooling exclusions cover generated artifacts?
9. Do workspace packages resolve correctly?
10. Do CLI entrypoints work after build?
11. Does clean + rebuild recover from bad states?

### What NOT to report (domain-specific):
- Chrome extension UI not working in Docker (no GUI)
- Build performance that is "slow" but correct (unless simple fix)
- Port conflicts caused by host environment
- Static documentation inaccuracies noticed by reading (audited by perfect-docs.sh)
- E2E test code quality (audited by perfect-e2e.sh)

## Step 5: Filter findings (Phase 2)

Read `/tmp/perfect-findings.md` in full. For each finding, apply the Validation Checklist from the shared guidelines. For each finding, write "KEEP: [reason]" or "DISCARD: [reason]" to force explicit justification. Delete discarded findings.

## Step 6: Create PRD(s) using the ralph skill (Phase 3)

Use the skill tool to load the "ralph" skill, then follow its instructions to create PRD(s) from the surviving findings.

Key parameters:
- Target project: "OpenTabs Platform" (root monorepo)
- Do NOT set workingDirectory or qualityChecks (root monorepo defaults)
- e2eCheckpoint: true ONLY for stories that change E2E test files or behavior
- For execution-discovered docs failures: project "OpenTabs Docs", workingDirectory "docs", qualityChecks "cd docs && npm run build && npm run type-check && npm run lint && npm run knip && npm run format:check". Create SEPARATE PRDs for docs vs platform.

Severity triage (for prioritization, not filtering):
- **HIGH**: Quality checks fail on clean checkout, documented commands don't work
- **MEDIUM**: Missing fast paths, confusing naming, Docker-specific test failures
- **LOW**: Minor inconsistencies, edge case polish
PROMPT_EOF

echo "=== perfect-cli-platform-contributor.sh ==="
echo "Launching Claude to test platform contributor experience and create PRD(s)..."
echo ""

echo "$PROMPT" | bash "$SCRIPT_DIR/run-prompt.sh"
