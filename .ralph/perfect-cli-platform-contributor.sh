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

## Step 3: Walk through the COMPLETE platform contributor journey

Act as a first-time platform contributor. Be thorough and methodical.

### Phase 1: Initial setup (simulating "git clone" + first build)

1. Clean any build artifacts from the copy (simulates fresh clone):
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "rm -rf node_modules platform/*/node_modules"
   ```
2. `npm install` — install all dependencies
3. `npm run build` — full initial build
4. Time the build and note what it does (tsc + extension bundle + icons + install)

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

1. Start `npm run dev:mcp` (MCP server only with hot reload):
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "timeout 15 npm run dev:mcp 2>&1"
   ```
   Verify it starts, shows proxy URL, discovers plugins.

2. Start `npm run dev` (full dev mode):
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "timeout 20 npm run dev 2>&1"
   ```
   Verify it starts tsc watch, builds extension, starts MCP server, shows startup banner.

3. Test `npm run storybook` briefly:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "timeout 15 npm run storybook 2>&1"
   ```

### Phase 6: Test error scenarios and edge cases

1. **Create a file with type errors** — verify `npm run type-check` catches them and returns non-zero:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     echo 'export const x: number = \"wrong\";' > platform/mcp-server/src/test-error.ts
     npx tsc --build; echo EXIT: \$?
     rm platform/mcp-server/src/test-error.ts
   "
   ```

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
     CI=1 npx playwright test e2e/health-endpoint.e2e.ts 2>&1 | tail -15
   "
   ```

4. **Clean + rebuild cycle** — verify `npm run clean` and full rebuild works:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     npm run clean 2>&1
     npm run build 2>&1 | tail -10
   "
   ```

5. **Run checks after building docs** — if docs/.next exists, check if format:check still passes:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     mkdir -p docs/.next && echo '{}' > docs/.next/test.json
     echo '{}' > docs/next-env.d.ts
     npm run format:check 2>&1 | tail -5; echo EXIT: \$?
     rm -rf docs/.next docs/next-env.d.ts
   "
   ```

### Phase 7: Test tsconfig coverage

1. Create a new `.ts` file OUTSIDE of `src/` in a platform package and verify it's type-checked:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     echo 'export const x: number = \"wrong\";' > platform/mcp-server/scripts/test-coverage.ts
     npx tsc --build 2>&1 | grep test-coverage || echo 'NOT COVERED'
     rm -f platform/mcp-server/scripts/test-coverage.ts
   "
   ```

2. Create a test file in `src/` and verify it IS covered:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     echo 'export const x: number = \"wrong\";' > platform/mcp-server/src/test-coverage.test.ts
     npx tsc --build 2>&1 | grep test-coverage || echo 'NOT COVERED'
     rm -f platform/mcp-server/src/test-coverage.test.ts
   "
   ```

### Phase 8: Test documentation accuracy

Compare what you experienced against CONTRIBUTING.md:

1. Does the command reference table accurately describe what each script does?
2. Does `npm run type-check` description match reality (check for --noEmit claim)?
3. Are the E2E test instructions clear and accurate?
4. Does the debugging section cover all relevant tools?
5. Is the pre-commit/pre-push hook description accurate?

### Phase 9: Test git hooks (if possible)

1. Initialize git in the copy and verify husky hooks are set up:
   ```bash
   docker exec -w /root/opentabs opentabs-platform-contributor-test bash -c "
     git init 2>/dev/null || true
     git config user.email 'test@test.com'
     git config user.name 'Test'
     ls .husky/ 2>&1
   "
   ```

### Phase 10: Cleanup

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
7. **Documentation accuracy**: Does CONTRIBUTING.md match reality?
8. **Build pipeline**: Is it clear which commands to run and when?
9. **Tooling exclusions**: Does .prettierignore/.eslintignore cover all generated artifacts?

### Known friction categories from prior testing:

These are frictions that HAVE been observed. Verify they still exist and add any new ones:

1. **`.prettierignore` missing docs build artifacts** — When `docs/.next/`, `docs/.content-collections/`, or `docs/next-env.d.ts` exist, `npm run format:check` fails because these generated files aren't in `.prettierignore`. This breaks `npm run check` for any contributor who has built or run the docs site.

2. **CONTRIBUTING.md type-check description is wrong** — Line 102 says `npm run type-check` uses `--noEmit` (no file emission), but the actual script is `tsc --build` which DOES emit files. This confuses contributors about the build pipeline.

3. **dev-proxy SIGTERM E2E test fails in Docker** — The `e2e/dev-proxy.e2e.ts` "SIGTERM kills worker and proxy exits cleanly" test consistently fails in Docker. It waits only 500ms for worker processes to die after SIGTERM, but Docker's process cleanup is slower than native macOS.

4. **`npm run build` always rebuilds extension bundle** — Even for TypeScript-only changes, `npm run build` regenerates the extension esbuild bundle (~2s), icons (~0.3s), and installs the extension (~0.2s). There's no `npm run build:ts` for fast TypeScript-only builds. The `npm run type-check` command does just `tsc --build` but the name implies checking not building.

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

Severity triage:
- **HIGH**: Quality checks that fail on clean checkout, documented commands that don't work
- **MEDIUM**: Missing fast paths, confusing naming, Docker-specific test failures
- **LOW**: Cosmetic issues, minor inconsistencies

Only create PRDs for HIGH and MEDIUM issues. Document LOW issues in the PRD description field as known minor issues but do not create stories for them.

Do NOT create stories for:
- Chrome extension UI not working in Docker (expected — no GUI)
- Stylistic preferences about CLI output formatting
- Features that work correctly but you would design differently
- Build performance that is "slow" but correct (unless there's a simple fix)

DO create stories for:
- Quality checks that fail on clean checkout or after building docs
- Documentation inaccuracies (CONTRIBUTING.md, CLAUDE.md)
- E2E tests that consistently fail in Docker
- Missing .prettierignore / .eslintignore entries for generated files
- Error messages that don't help the contributor fix the problem
- Tooling that produces confusing output
PROMPT_EOF

echo "=== perfect-cli-platform-contributor.sh ==="
echo "Launching Claude to test platform contributor experience and create PRD(s)..."
echo ""

echo "$PROMPT" | bash "$SCRIPT_DIR/run-prompt.sh"
