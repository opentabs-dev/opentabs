#!/bin/bash
# perfect-cli-plugin-developer.sh — Test plugin developer experience and create PRD(s).
#
# Usage: bash .ralph/perfect-cli-plugin-developer.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read -r -d '' PROMPT <<'PROMPT_EOF' || true
You are a QA engineer performing a first-time plugin developer experience test for the OpenTabs platform. Go through the entire plugin development workflow — scaffold, build, use every SDK feature, exercise every CLI command — and identify every friction point. Then use the ralph skill to create PRD(s) to fix them.

## Important context

- The @opentabs-dev packages are published to the public npm registry.
- Lack of mock/unit testing for plugin tool handlers is NOT an issue — plugins must be tested in a real browser with real auth.
- The Chrome extension cannot be tested inside Docker (no GUI). Focus on CLI and build toolchain friction.

## Step 1: Read the rules and understand the project

1. CLAUDE.md (root) — overall platform architecture, key concepts
2. platform/cli/CLAUDE.md — CLI commands
3. platform/plugin-sdk/CLAUDE.md — SDK API surface
4. platform/plugin-tools/CLAUDE.md — plugin build toolchain
5. platform/create-plugin/CLAUDE.md — scaffolding CLI (may not exist — note if missing)
6. platform/cli/src/scaffold.ts — actual scaffold code
7. platform/plugin-sdk/src/index.ts — actual SDK exports
8. docs/content/docs/quick-start.mdx — documented quick-start flow
9. docs/content/docs/first-plugin.mdx — documented first-plugin tutorial
10. docs/content/docs/guides/plugin-development.mdx — comprehensive plugin dev guide
11. docs/content/docs/guides/resources-prompts.mdx — resources and prompts guide

## Step 2: Set up a clean Docker environment

```bash
docker rm -f opentabs-plugin-dev-test 2>/dev/null || true
docker run --rm -d \
  --name opentabs-plugin-dev-test \
  --network host \
  -v "$HOME/.npmrc:/root/.npmrc:ro" \
  node:22 \
  tail -f /dev/null
```

All commands via `docker exec`. Use `docker exec -w <dir>` for working directory.
IMPORTANT: Clean up when done: `docker stop opentabs-plugin-dev-test`

## Step 3: Walk through the COMPLETE plugin developer journey

### Phase 1: Install and start the platform
Install CLI, verify help output, start server in background, verify with status/doctor.

### Phase 2: Test scaffolding CLI — all invocation paths
1. `npx @opentabs-dev/create-plugin test-a --domain example.com`
2. `npx @opentabs-dev/create-plugin test-b --domain example.com`
3. `npm create @opentabs-dev/plugin test-c -- --domain example.com`
4. `opentabs plugin create my-plugin --domain example.com --display "My Plugin"`
5. Non-interactive mode without required args
6. Validation edge cases: reserved name, invalid name (MyPlugin), overly broad domain (*.com), duplicate directory, empty name, special characters, domain with leading dot

### Phase 3: Build scaffolded plugin and check quality
npm install, npm run build, npm run type-check, npm run lint, npm run format:check. Run `opentabs-plugin inspect` (human-readable and --json). Verify plugin appears in `opentabs plugin list` and `opentabs status`.

### Phase 4: Build a real plugin using ALL SDK features
Modify the scaffolded plugin to exercise every SDK capability. Use single quotes (scaffolded .prettierrc uses singleQuote: true):
- Multiple tools using defineTool: DOM utilities, fetch utilities, progress reporting, storage, page state, timing
- A resource using defineResource
- A prompt using definePrompt with typed args
- All lifecycle hooks: onActivate, onDeactivate, onNavigate, onToolInvocationStart, onToolInvocationEnd
- Logging: log.info, log.debug, log.warn, log.error
- Error handling: ToolError.auth(), .notFound(), .rateLimited(), .validation(), .timeout(), .internal()
- isReady() implementation

Build and verify: npm run build, type-check, lint, format:check, opentabs-plugin inspect.

### Phase 5: Test dev workflow and iterative changes
Watch mode, iterative rebuild, verify server notification.

### Phase 6: Test ALL plugin management CLI commands
Plugin search/install/list/remove, config show/set, server lifecycle, logs, audit.
Also test the new tool commands: `opentabs tool list`, `opentabs tool list --plugin <name>`, `opentabs tool schema <tool>`, `opentabs tool call <tool> '{}'`.
Test `plugin configure` with multi-instance URL prompting (enter name + URL pairs, add/remove instances).

### Phase 7: Test npx binary name resolution
Test `npx opentabs-plugin build` and `npx @opentabs-dev/plugin-tools build` from outside a plugin directory.

### Phase 8: Test error recovery and edge cases
Inspect before build, build with syntax error, build with missing import, multiple plugins coexistence.

### Phase 9: Compile and test documentation code examples
1. First-plugin tutorial — copy exact code, verify it builds
2. Resources-prompts full example — copy TrackerPlugin, verify compilation
3. SDK utility patterns from plugin-development.mdx

### Phase 10: Cleanup
`docker stop opentabs-plugin-dev-test`

## Step 4: Evaluate every interaction

Evaluate as a first-time plugin developer:
1. Scaffolding quality — does generated code pass its own lint/format rules?
2. Build toolchain — are errors clear?
3. SDK discoverability — can the dev figure out resources, prompts, lifecycle hooks?
4. TypeScript experience — are type errors clear? Is `override` documented?
5. Documentation accuracy — do commands work? Do code examples compile?
6. Error messages — do they tell the dev what to do next?

### What NOT to report (domain-specific):
- Lack of unit/mock testing (by design)
- Chrome extension not working in Docker
- Zod version migration issues (upstream library changes)
- SDK source code bugs (audited by perfect-sdk.sh)

## Step 5: Create PRD(s) using the ralph skill

Use the skill tool to load the "ralph" skill, then follow its instructions to create PRD(s).

Key parameters:
- Platform code fixes: "OpenTabs Platform", no workingDirectory or qualityChecks
- Docs-only fixes discovered through execution: "OpenTabs Docs", workingDirectory "docs", qualityChecks "cd docs && npm run build && npm run type-check && npm run lint && npm run knip && npm run format:check"
- Separate PRDs for platform vs docs fixes
- All stories: e2eCheckpoint: false

Severity triage (for prioritization, not filtering):
- **HIGH**: Scaffolded code fails its own checks, documented commands don't work, doc code examples don't compile
- **MEDIUM**: Missing guidance, confusing errors, poor discoverability
- **LOW**: Minor inconsistencies, edge case polish
PROMPT_EOF

echo "=== perfect-cli-plugin-developer.sh ==="
echo "Launching Claude to test plugin developer experience and create PRD(s)..."
echo ""

echo "$PROMPT" | bash "$SCRIPT_DIR/run-prompt.sh"
