#!/bin/bash
# perfect-cli-platform-contributor.sh — Invoke Claude to perform a platform contributor experience test and create PRD(s) for frictions found.
#
# Usage: bash .ralph/perfect-cli-platform-contributor.sh
#
# This script launches a single Claude session (default model) that:
#   1. Spins up a Docker container simulating a new platform contributor
#   2. Clones the repo, installs dependencies, builds, and runs all quality checks
#   3. Exercises the full development workflow: dev mode, incremental builds, tests, E2E
#   4. Identifies DX frictions: broken tooling, confusing errors, doc inaccuracies
#   5. Uses the ralph skill to generate PRD(s) targeting the root monorepo
#
# Prerequisites:
#   - Docker running (Docker Desktop or OrbStack)
#   - The repo must be in a clean, buildable state
#
# The ralph daemon (.ralph/ralph.sh) must be running to pick up the PRDs.
# This script does NOT start ralph — it only creates the PRD files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read -r -d '' PROMPT <<'PROMPT_EOF' || true
You are a QA engineer performing a platform contributor experience test for the OpenTabs monorepo. Your job is to go through the entire contributor development workflow exactly as a new contributor would — clone, install, build, run quality checks, make changes, run tests, exercise dev mode — and identify every friction point. Then use the ralph skill to create PRD(s) to fix them.

## Important context

- Platform contributors work on the code in `platform/` (mcp-server, browser-extension, plugin-sdk, plugin-tools, cli, create-plugin, shared) and `e2e/`.
- The Chrome extension UI cannot be interactively tested inside Docker (no GUI). Focus on build, type-check, lint, knip, unit tests, E2E tests (headless Chromium via Playwright), and dev workflow friction.
- The Playwright base image (`mcr.microsoft.com/playwright:v1.58.2-noble`) includes Chromium for headless E2E testing.
- E2E tests that spawn Chromium in headless mode ARE expected to work in Docker.

## Step 1: Read the rules and understand the project

Read these files to understand the intended contributor experience:

1. CLAUDE.md (root) — overall platform architecture, commands, quality rules
2. CONTRIBUTING.md — contributor guide, setup instructions, command reference
3. platform/mcp-server/CLAUDE.md — MCP server architecture
4. platform/browser-extension/CLAUDE.md — extension architecture
5. platform/plugin-sdk/CLAUDE.md — SDK API surface
6. platform/plugin-tools/CLAUDE.md — plugin build toolchain
7. platform/cli/CLAUDE.md — CLI commands
8. e2e/CLAUDE.md — E2E test infrastructure
9. package.json (root) — scripts, workspaces, dependencies
10. tsconfig.json (root) — project references structure
11. .prettierignore — what prettier excludes
12. .eslintignore or eslint.config.ts — what eslint excludes
13. knip.ts — unused code detection config

Understanding the source is critical — you need to know the intended behavior to evaluate whether the actual behavior matches contributor expectations.

## Step 2: Set up a clean Docker environment

Launch a Playwright container (needed for E2E tests with headless Chromium):

```bash
docker run --rm -d \
  --name opentabs-platform-contributor-test \
  --network host \
  --ipc=host \
  --shm-size=2g \
  -v "$HOME/.npmrc:/root/.npmrc:ro" \
  -v "$(pwd):/repo:ro" \
  mcr.microsoft.com/playwright:v1.58.2-noble \
  tail -f /dev/null
```

Copy the repo to a writable location (simulates a fresh clone):

```bash
docker exec opentabs-platform-contributor-test bash -c "cp -r /repo /root/opentabs"
```

All commands run via `docker exec`. Example:
```bash
docker exec -w /root/opentabs opentabs-platform-contributor-test npm install
docker exec -w /root/opentabs opentabs-platform-contributor-test npm run build
```

Use `docker exec -w <dir>` to set the working directory — never `cd && command`.

IMPORTANT: Clean up the container when done: `docker stop opentabs-platform-contributor-test`

### Docker execution patterns

The container uses `--network host`, which means it shares the host's network namespace. This has important implications:

1. **Port conflicts with host services**: Any service on the host occupying a port (e.g., ChromeDriver, OrbStack, another dev server) will conflict with the same port inside the container. If a command fails with `EADDRINUSE`, check the HOST for what's using that port (`lsof -i :<port>` on the host machine) and use `PORT=<alternate>` to override.

2. **Running long-lived dev servers**: Dev servers (`npm run dev`, `npm run dev:mcp`, `npm run storybook`) block forever. Use this pattern to capture output without hanging:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     PORT=<non-conflicting-port> timeout 12 <command> 2>&1
     echo EXIT: \$?
   "
   ```
   Always pick a port unlikely to conflict with host services (e.g., 19515 instead of 9515).

3. **Process cleanup between phases**: After running E2E tests or dev servers, leftover processes may occupy ports. Before starting dev server tests, kill any lingering processes:
   ```bash
   docker exec opentabs-platform-contributor-test bash -c "
     pkill -f 'node.*mcp-server' 2>/dev/null || true
     pkill -f 'node.*dev-proxy' 2>/dev/null || true
     pkill -f tsx 2>/dev/null || true
     sleep 2
   "
   ```

4. **Verifying exit codes**: Always append `; echo EXIT: $?` (escaped as `\$?` inside bash -c) to capture the real exit code. Commands like `tsc --build` report errors on stdout but the exit code is what matters.

## Step 3: Walk through the COMPLETE platform contributor journey

Act as a first-time platform contributor. Be thorough and methodical.

### Phase 1: Initial setup (simulating "git clone" + first build)

1. Clean any build artifacts from the copy (simulates fresh clone):
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "rm -rf node_modules platform/*/node_modules"
   ```
2. `npm install` — install all dependencies. Verify zero errors, note timing.
3. `npm run build` — full initial build. Verify zero errors, note timing and output steps (tsc + extension bundle + icons + install).
4. `npm run build:force` — full non-incremental rebuild. Verify it works and compare timing with incremental build.

### Phase 2: Run all quality checks individually

Run each check separately to isolate failures:

1. `npm run type-check` — TypeScript check
2. `npm run lint` — ESLint
3. `npm run format:check` — Prettier formatting check
4. `npm run knip` — unused code detection
5. `npm run test` — unit tests (Vitest)
6. Install Playwright browsers: `npx playwright install chromium`
7. `npm run test:e2e` — E2E tests (Playwright, includes building e2e-test plugin)

Record exit codes for every command. Note any that fail.

### Phase 3: Run the combined check commands

1. `npm run check` — build + lint + format:check + knip + test
2. If `check` fails, note which sub-step fails and why

### Phase 4: Test incremental build performance

1. Make a trivial change to `platform/shared/src/validation.ts` (add a comment)
2. Time `npm run build` — note it rebuilds everything including extension
3. Time `npx tsc --build` directly — note the difference
4. Time `npm run type-check` — compare with `tsc --build`
5. Undo the change
6. Document whether there's a fast path for TypeScript-only changes

### Phase 5: Test the dev workflow

**Before this phase**, kill any leftover processes from E2E tests to free ports:
```bash
docker exec opentabs-platform-contributor-test bash -c "
  pkill -f 'node.*mcp-server' 2>/dev/null || true
  pkill -f 'node.*dev-proxy' 2>/dev/null || true
  pkill -f tsx 2>/dev/null || true
  sleep 2
"
```

**Use a non-default port** (e.g., PORT=19515) for all dev server tests to avoid conflicts with host services on the default port:

1. Start `npm run dev:mcp` (MCP server only with hot reload):
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     PORT=19515 timeout 12 npm run dev:mcp 2>&1
     echo EXIT: \$?
   "
   ```
   Verify it starts, shows proxy URL, discovers plugins. Kill lingering processes afterward.

2. Start `npm run dev` (full dev mode):
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     pkill -f 'node.*dev-proxy' 2>/dev/null; pkill -f tsx 2>/dev/null; sleep 2
     PORT=19515 timeout 20 npm run dev 2>&1
     echo EXIT: \$?
   "
   ```
   Verify it starts tsc watch, builds extension, starts MCP server, shows startup banner. Kill lingering processes afterward.

3. Test `npm run storybook` briefly:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     pkill -f 'node.*dev-proxy' 2>/dev/null; pkill -f tsx 2>/dev/null; sleep 1
     timeout 15 npm run storybook 2>&1
   "
   ```

### Phase 6: Test error scenarios and edge cases

1. **Create a file with type errors** — verify `npm run type-check` catches them and returns non-zero:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     echo 'export const x: number = \"wrong\";' > platform/mcp-server/src/test-error.ts
     npx tsc --build 2>&1; echo EXIT: \$?
     rm platform/mcp-server/src/test-error.ts
     npx tsc --build 2>&1 > /dev/null
   "
   ```
   Confirm the exit code is non-zero (typically 2). Note: always clean up test files AND run `tsc --build` again to restore incremental state.

2. **Run E2E without building the e2e-test plugin** — check error message clarity:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     rm -rf plugins/e2e-test/dist
     npx playwright test --grep 'health' 2>&1 | tail -10
   "
   ```

3. **Run E2E for a single test** — check that targeted test execution works:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     cd plugins/e2e-test && npm ci && rm -f tsconfig.tsbuildinfo && OPENTABS_CONFIG_DIR=/tmp/opentabs-e2e-prebuild npm run build 2>&1 | tail -3
     cd /root/opentabs
     CI=1 npx playwright test e2e/health-endpoint.e2e.ts 2>&1 | tail -15
     echo EXIT: \$?
   "
   ```

4. **Clean + rebuild cycle** — verify `npm run clean` and full rebuild works:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     npm run clean 2>&1
     echo CLEAN EXIT: \$?
     npm run build 2>&1 | tail -10
     echo BUILD EXIT: \$?
   "
   ```

5. **Clean:all + reinstall cycle** — verify the nuclear option works:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     npm run clean:all 2>&1 | tail -5
     echo CLEAN_ALL EXIT: \$?
     npm install 2>&1 | tail -3
     npm run build 2>&1 | tail -5
     echo REBUILD EXIT: \$?
   "
   ```

6. **Run checks after building docs** — if docs/.next exists, check if format:check still passes:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     mkdir -p docs/.next && echo '{}' > docs/.next/test.json
     echo '{}' > docs/next-env.d.ts
     npm run format:check 2>&1 | tail -5; echo EXIT: \$?
     rm -rf docs/.next docs/next-env.d.ts
   "
   ```

7. **Run lint after generating storybook-static** — check if eslint ignores it:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     mkdir -p platform/browser-extension/storybook-static && echo 'var x = 1' > platform/browser-extension/storybook-static/test.js
     npm run lint 2>&1 | tail -5; echo EXIT: \$?
     rm -rf platform/browser-extension/storybook-static
   "
   ```

### Phase 7: Test tsconfig coverage

1. Create a new `.ts` file OUTSIDE of `src/` in a platform package — check if directories mentioned by tsconfig globs actually exist:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     # Find packages that have scripts/ or other non-src/ directories
     ls -d platform/*/scripts/ 2>/dev/null
     ls platform/browser-extension/build-*.ts 2>/dev/null
   "
   ```
   Then for each real non-src location, create a test file with a type error and verify tsc catches it.

2. Create a test file in `src/` and verify it IS covered by `tsconfig.test.json`:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     echo 'export const x: number = \"wrong\";' > platform/mcp-server/src/test-coverage.test.ts
     npx tsc --build 2>&1 | grep test-coverage || echo 'NOT COVERED'
     rm -f platform/mcp-server/src/test-coverage.test.ts
     npx tsc --build 2>&1 > /dev/null
   "
   ```

3. Create a non-test `.ts` file in `src/` and verify it IS covered by the main tsconfig:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     echo 'export const x: number = \"wrong\";' > platform/mcp-server/src/test-coverage-main.ts
     npx tsc --build 2>&1 | grep test-coverage-main || echo 'NOT COVERED'
     rm -f platform/mcp-server/src/test-coverage-main.ts
     npx tsc --build 2>&1 > /dev/null
   "
   ```

### Phase 8: Test cross-package consistency

1. **Verify workspace dependency resolution** — imports between workspace packages resolve correctly:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     # Check that workspace packages can import from each other
     node -e \"require('@opentabs-dev/shared')\" 2>&1; echo SHARED: \$?
     node -e \"require('@opentabs-dev/plugin-sdk')\" 2>&1; echo SDK: \$?
   "
   ```

2. **Verify `npm run type-check` and the tsc step of `npm run build` are equivalent** — compare what they produce:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     # Both are 'tsc --build' — verify they reference the same tsconfig
     grep 'type-check' package.json
     grep '\"build\"' package.json
   "
   ```

3. **Check for undocumented scripts** — find scripts in package.json that exist but are NOT listed in CONTRIBUTING.md's command reference table:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     node -e \"
       const pkg = require('./package.json');
       const scripts = Object.keys(pkg.scripts);
       console.log('All scripts:', scripts.join(', '));
     \"
   "
   ```
   Compare this list against the CONTRIBUTING.md table. Note any missing.

### Phase 9: Test documentation vs source code accuracy

This is critical. Documentation claims must be verified against the actual source code.

1. **Verify documented file paths exist** — every file path mentioned in CLAUDE.md / CONTRIBUTING.md should actually exist:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     # Sample check: verify key files mentioned in docs exist
     ls platform/mcp-server/src/index.ts platform/mcp-server/src/dev-proxy.ts \
        platform/mcp-server/src/config.ts platform/mcp-server/src/discovery.ts 2>&1
   "
   ```

2. **Verify documented behavior matches source** — for any behavior documented in CLAUDE.md (e.g., where secrets are stored, how auth works, what dev mode does), read the source code and confirm it matches. Specifically:
   - Read the scripts that implement documented commands (e.g., `scripts/dev.ts`, `scripts/dev-mcp.ts`, `scripts/clean.ts`) and verify they do what the docs say
   - Check that file paths mentioned in docs for configuration/secrets match the paths used in source code
   - Verify that hook descriptions in CONTRIBUTING.md match `.husky/pre-commit` and `.husky/pre-push` content

3. **Check CONTRIBUTING.md command reference accuracy**:
   - Does each script description match the actual `package.json` script definition?
   - Are there scripts in package.json not mentioned in the table?
   - Does `npm run type-check` use `--noEmit` as some docs may claim, or is it `tsc --build`?

4. **Check for stale cross-references** — do CLAUDE.md files reference functions, files, or patterns that no longer exist?

### Phase 10: Test git hooks (if possible)

1. Initialize git in the copy and verify husky hooks are set up:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     git init 2>/dev/null || true
     git config user.email 'test@test.com'
     git config user.name 'Test'
     ls .husky/ 2>&1
     cat .husky/pre-commit
     cat .husky/pre-push
   "
   ```

2. Verify the hook content matches what CONTRIBUTING.md describes.

### Phase 11: Test CLI entrypoints

Verify that the built CLI commands are wirable and produce help output:

```bash
docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
  # Test that the CLI binary resolves via workspace
  npx opentabs --help 2>&1 | head -10; echo EXIT: \$?
  npx opentabs-plugin --help 2>&1 | head -10; echo EXIT: \$?
"
```

### Phase 12: Cleanup

```bash
docker stop opentabs-platform-contributor-test
```

## Step 4: Evaluate every interaction for friction

For each step, evaluate from a first-time platform contributor's perspective:

1. **Setup experience**: Does `npm install && npm run build` work cleanly on first try?
2. **Quality checks**: Do all six checks (build, type-check, lint, format:check, knip, test) pass on a clean checkout?
3. **E2E tests**: Do they pass in Docker? Are flaky tests documented?
4. **Incremental workflow**: Is there a fast path for TypeScript-only changes?
5. **Dev mode**: Does `npm run dev` and `npm run dev:mcp` work correctly?
6. **Error messages**: When things fail, do errors tell the contributor what to do?
7. **Documentation accuracy**: Does CONTRIBUTING.md match reality? Do CLAUDE.md files match the actual source code?
8. **Build pipeline**: Is it clear which commands to run and when?
9. **Tooling exclusions**: Does .prettierignore/.eslintignore cover all generated artifacts?
10. **Cross-package imports**: Do workspace packages resolve each other correctly?
11. **CLI entrypoints**: Do the bin commands work after build?
12. **Recovery paths**: Does clean + rebuild (and clean:all + reinstall) recover from bad states?

## Step 5: Create PRD(s) using the ralph skill

After completing all testing, compile your findings and use the skill tool to load the "ralph" skill, then create PRD(s).

Key parameters:
- Target project: "OpenTabs Platform" (root monorepo)
- Do NOT set workingDirectory or qualityChecks (root monorepo uses defaults)
- Group related fixes into the same PRD to avoid merge conflicts (fixes to the same file go together)
- E2E checkpoint strategy: set e2eCheckpoint: true ONLY for stories that change E2E test files or behavior
- Always use small stories (1-3 files per story)
- Include repo-root-relative file paths and approximate line numbers in the notes field
- Every story must have concrete, verifiable acceptance criteria
- Skip clarifying questions — this prompt provides all the context needed

Severity triage (for prioritization, not for filtering):
- **HIGH**: Quality checks that fail on clean checkout, documented commands that don't work, source code contradicts documentation
- **MEDIUM**: Missing fast paths, confusing naming, Docker-specific test failures
- **LOW**: Minor inconsistencies, edge case polish, undocumented scripts

Create PRDs for ALL severity levels — HIGH, MEDIUM, and LOW. Every genuine issue deserves a fix. Use severity to order stories (HIGH first) and to decide model (opus for complex HIGH issues, sonnet for straightforward fixes).

However, ruthlessly distinguish genuine issues from style preferences. Before filing any issue, ask: "Is this a real problem with a concrete consequence, or just a different way to write the same thing?" A different-but-equivalent approach is NOT an issue. Only file issues where you can articulate a specific harm: broken build, contributor confusion, wasted time, misleading documentation, or incorrect behavior.

Do NOT create stories for:
- Chrome extension UI not working in Docker (expected — no GUI)
- Stylistic preferences about CLI output formatting
- Features that work correctly but you would design differently
- Build performance that is "slow" but correct (unless there's a simple fix)
- Port conflicts caused by the host environment (not a project issue)

DO create stories for:
- Quality checks that fail on clean checkout or after building docs
- Documentation inaccuracies (CONTRIBUTING.md, CLAUDE.md) — including file paths, command descriptions, and behavioral claims that don't match the source code
- Source code that contradicts documented architecture (e.g., reading config from the wrong file, using the wrong API)
- E2E tests that consistently fail in Docker
- Missing .prettierignore / .eslintignore entries for generated files
- Error messages that don't help the contributor fix the problem
- Tooling that produces confusing output
- CLI entrypoints that fail or produce wrong help text
- Workspace resolution issues between packages
PROMPT_EOF

echo "=== perfect-cli-platform-contributor.sh ==="
echo "Launching Claude to test platform contributor experience and create PRD(s)..."
echo ""

echo "$PROMPT" | bash "$SCRIPT_DIR/run-prompt.sh"
