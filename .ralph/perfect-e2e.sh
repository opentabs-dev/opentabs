#!/bin/bash
# perfect-e2e.sh — Audit E2E test code and create PRD(s).
#
# Usage: bash .ralph/perfect-e2e.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read -r -d '' PROMPT <<'PROMPT_EOF' || true
You are auditing the OpenTabs E2E test suite (e2e/) to find flaky patterns, incorrect assertions, missing test coverage, resource leaks, and test infrastructure issues with concrete consequences. Read the test code thoroughly, identify genuine problems, then use the ralph skill to create PRD(s) to fix them.

## Step 1: Read the rules and understand the codebase

1. Read CLAUDE.md (root) — overall platform architecture, key concepts, commands, code quality rules
2. Read e2e/CLAUDE.md — E2E test conventions, fixtures, process cleanup rules
3. Read platform/mcp-server/CLAUDE.md — server architecture (tests exercise this)
4. Read platform/browser-extension/CLAUDE.md — extension architecture (tests exercise this)
5. Read platform/plugin-sdk/CLAUDE.md — SDK API surface (test plugin uses this)

## Step 2: Read the test infrastructure

Start with shared infrastructure that all tests depend on:

1. e2e/fixtures.ts — test fixtures (MCP server, extension, test server lifecycle)
2. e2e/helpers.ts — shared test helpers and utilities
3. e2e/test-server.ts — controllable test web server
4. e2e/test-server-utils.ts — test server utilities
5. e2e/strict-csp-test-server.ts — CSP test server
6. e2e/analyze-site-test-server.ts — site analysis test server
7. e2e/global-setup.ts — Playwright global setup
8. e2e/global-teardown.ts — Playwright global teardown
9. e2e/orphan-guard.ts — orphan process cleanup

Key recent test files to pay special attention to:
- e2e/multi-instance.e2e.ts — multi-instance plugin dispatch (uses localhost vs 127.0.0.1 as distinct instances)
- e2e/tool-http-api.e2e.ts — HTTP tool endpoints (GET /tools, POST /tools/:name/call)
- e2e/mcp-gateway.e2e.ts — MCP gateway endpoint (/mcp/gateway with 2 meta-tools)

## Step 3: Systematically audit all E2E test files

Read through ALL test files in e2e/. Do not skim — read every test case, every assertion, every setup/teardown block. Discover all *.e2e.ts files dynamically.

### What to look for:

- **Flaky patterns**: Race conditions in test code, missing waits, polling without proper timeouts, timing-dependent assertions, shared mutable state between tests
- **Incorrect assertions**: Tests that pass but verify the wrong thing, overly broad assertions, missing negative assertions
- **Missing error handling in tests**: Tests that swallow errors silently, missing try/finally for cleanup
- **Resource leaks**: Servers not shut down, browsers not closed, temp files not cleaned up on failure paths
- **Missing test coverage**: Features documented in CLAUDE.md files with no E2E coverage, edge cases mentioned in source code but not tested
- **Fragile selectors/assumptions**: Tests that depend on implementation details, hardcoded values
- **Duplicate or redundant tests**: Tests verifying the exact same behavior
- **Test isolation issues**: Tests depending on execution order, shared state leaking between files
- **Process cleanup issues**: Tests that could leave orphaned processes on failure

### What NOT to report (domain-specific):

- Test style preferences — different-but-equivalent assertion styles
- Test structure preferences — organizing tests differently
- Missing tests for internal implementation details — E2E verifies user-visible behavior
- Slow tests that are correct — slowness without flakiness is not a bug
- Docker environment issues — Docker-specific constraints are not test quality issues

## Step 4: Check for missing E2E coverage

Compare features described in CLAUDE.md files against existing tests. Only flag missing coverage if the feature is user-visible and the gap creates real risk.

## Step 5: Create PRD(s) using the ralph skill

Use the skill tool to load the "ralph" skill, then follow its instructions to create PRD(s).

Key parameters for E2E PRDs:
- Target project: "OpenTabs Platform" (root monorepo)
- Do NOT set workingDirectory or qualityChecks (root monorepo uses defaults)
- Group related fixes to avoid merge conflicts (fixes to the same test file go together)
- All stories: e2eCheckpoint: true for the final story (E2E test changes are browser-observable by definition)
- All other stories: e2eCheckpoint: false
PROMPT_EOF

echo "=== perfect-e2e.sh ==="
echo "Launching Claude to audit E2E test code and create PRD(s)..."
echo ""

echo "$PROMPT" | bash "$SCRIPT_DIR/run-prompt.sh"
