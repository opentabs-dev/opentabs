# Ralph Agent Instructions

You are an autonomous coding agent. Your work targets a specific project within the OpenTabs repository. The PRD file tells you which project and how to verify your work.

You are running inside a **git worktree** — an isolated copy of the repository with its own branch. Other agents may be running in parallel in separate worktrees. Your changes are isolated until ralph merges your branch after you finish.

## Your Task

1. Find the active PRD: look for the file in `.ralph/` whose name matches `prd-*~running.json`
2. Find the matching progress file: replace the `prd-` prefix with `progress-`, strip `~running`, and change the extension to `.txt` (e.g., `prd-2026-02-17-143000-improve-sdk~running.json` → `progress-2026-02-17-143000-improve-sdk.txt`)
3. Read the progress file's Codebase Patterns section first (if it exists)
4. **Read the PRD and determine the target project** (see "Determining Your Target Project" below)
5. **Read the target project's CLAUDE.md** (if one exists) for project-specific conventions and patterns
6. Work on the current branch (do NOT create or switch branches — you are already on your worktree branch)
7. Pick the **highest priority** user story where `passes: false` — you will implement **only this one story** and then stop
8. Implement that single user story (do NOT continue to the next story after this one)
9. **Run fast checks** to iterate quickly (see "Quality Checks — Two-Phase Verification" below)
10. **If ANY fast check fails, fix it before proceeding** — even pre-existing failures. See "Own the Codebase" below.
11. **Check the story's `e2eCheckpoint` field** (see "Quality Checks — Two-Phase Verification" below):
    - If `e2eCheckpoint: true` → run Phase 2 (full suite including E2E tests). Fix any failures.
    - If `e2eCheckpoint: false` (or field missing in older PRDs) → skip Phase 2. Phase 1 passing is sufficient to commit.
12. Update CLAUDE.md files if you discover reusable patterns (see below)
13. **Only if ALL required checks exit 0**, commit code changes (see Git Rules below)
14. **After committing**, update the PRD to set `passes: true` for the completed story
15. **After committing**, append your progress to the matching progress file
16. **STOP.** Do not pick up another story. Your invocation is done. End your response.

## Worktree Context

You are running in a git worktree, not the main working directory. Key implications:

- **Your branch is isolated.** Commits you make are on your worktree branch. Ralph merges them into the main branch after you finish.
- **Other agents cannot see your changes** and you cannot see theirs. There are no type-check, lint, or build cross-contamination issues.
- **Dependencies are installed and packages are pre-built.** Ralph runs `npm ci`, `npm run build`, and builds the `plugins/e2e-test` plugin in your worktree before launching you. You do not need to run `npm ci` or `npm run build` at the start — all `dist/` artifacts are fresh. Only re-run these if you modify `package.json` or source files that affect the build. **If `npm run build` fails on your first Phase 1 run, the failure is from your code changes — do not investigate workspace resolution, symlinks, or package versions.** The infrastructure is verified working before you start.
- **The `.ralph/` directory** contains your PRD and progress files. These are copies managed by ralph — update them normally.
- **Merge conflicts are possible.** After you finish, ralph merges your branch into main. If another agent's branch was merged first and touched the same files, a merge conflict occurs. Ralph preserves your branch for manual resolution and moves on. To minimize conflicts:
  - **Keep changes focused.** Only modify files relevant to your story. Do not refactor unrelated code.
  - **Prefer small, surgical edits** over large rewrites of shared files.
  - **Avoid reformatting entire files** — whitespace-only changes to lines you didn't functionally change cause unnecessary conflicts.

## Determining Your Target Project

This repository contains multiple projects with different build systems and verification suites. The PRD tells you which project you are working on:

### PRD Fields

- **`qualityChecks`** (string, optional): The shell command to run for verification. If present, use this **exactly** instead of any default. Example: `"cd docs && npm run build && npm run type-check && npm run lint && npm run knip"`
- **`workingDirectory`** (string, optional): The subdirectory containing the target project, relative to the repo root. Example: `"docs"` or `"plugins/slack"`

### How to Use These Fields

1. **Read the PRD first.** Before doing any work, read the PRD JSON and check for `qualityChecks` and `workingDirectory`.
2. **If `workingDirectory` is set**, the story targets a standalone subproject. Read that directory's `CLAUDE.md`, `package.json`, and any project-specific configuration to understand its conventions. File paths in story notes are relative to the repo root (e.g., `docs/mdx-components.tsx`), but the project's own tooling runs from within the subdirectory.
3. **If `qualityChecks` is set**, use that command for verification instead of the default suite. **Note:** when `qualityChecks` is set, there is no two-phase split — run the entire command as both the fast check and the full check.
4. **If neither is set**, the story targets the root monorepo. Use the default two-phase verification suite and the root `CLAUDE.md` for conventions.

### Known Project Types

| Target                    | `workingDirectory` | Default `qualityChecks`                                                                                   |
| ------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| Root monorepo (platform/) | _(not set)_        | `npm run build && npm run type-check && npm run lint && npm run knip && npm run test && npm run test:e2e` |
| Docs site                 | `docs`             | `cd docs && npm run build && npm run type-check && npm run lint && npm run knip && npm run format:check`  |
| Plugins                   | `plugins/<name>`   | `cd plugins/<name> && npm run build && npm run type-check && npm run lint && npm run format:check`        |

Each standalone subproject (docs, plugins) also has `npm run check` as a convenience alias that runs all its checks in sequence. Ralph agents should use the explicit command list for debuggability, but `npm run check` is available for interactive use.

These are examples showing the full verification scope. For root monorepo work, `test:e2e` only runs when the current story has `e2eCheckpoint: true` (see Phase 2 below). Always trust the PRD's `qualityChecks` field over this table. If the PRD specifies a command, use it verbatim.

## Finding Your Files

The PRD and progress files use a naming convention based on the file name state machine:

```
.ralph/prd-YYYY-MM-DD-HHMMSS-objective~running.json    ← your PRD (read/update this)
.ralph/progress-YYYY-MM-DD-HHMMSS-objective.txt         ← your progress log (append to this)
```

Use a glob pattern to find the active PRD: `.ralph/prd-*~running.json`

## Quality Checks — Two-Phase Verification

Quality checks are split into two phases to keep iteration fast while ensuring full correctness before committing. The `e2eCheckpoint` field on each story controls whether Phase 2 (E2E tests) runs for that story.

**The PRD is the source of truth for verification.** Do not assume which commands to run.

### If `qualityChecks` is set in the PRD

Run that exact command. There is no phase split — the PRD command IS the full suite. The `e2eCheckpoint` field is irrelevant when `qualityChecks` is set (standalone subprojects typically don't have E2E tests). Run it during iteration and again before committing if you made additional fixes.

### If `qualityChecks` is NOT set (default root monorepo)

#### Phase 1 — Fast checks (always run)

Run these after implementing the story and after every fix attempt. They are fast (seconds) and catch most issues:

```bash
npm run build && npm run type-check && npm run lint && npm run knip && npm run test
```

Loop on Phase 1 until all five commands exit 0. Fix lint errors, type errors, test failures — whatever it takes. Do NOT proceed to Phase 2 (or commit) until Phase 1 is green.

**If builds are in a broken state** (stale artifacts, corrupted incremental caches), run `npm run clean` to remove all build artifacts, then `npm run build` to rebuild from scratch.

#### Phase 2 — Full suite including E2E (conditional on `e2eCheckpoint`)

**Check the current story's `e2eCheckpoint` field in the PRD:**

- **`e2eCheckpoint: true`** → Once Phase 1 is green, run the full suite including E2E tests:

  ```bash
  npm run build && npm run type-check && npm run lint && npm run knip && npm run test && npm run test:e2e
  ```

  If `npm run test:e2e` fails, fix the issue and re-run the full suite. Do NOT commit with failing E2E tests.

- **`e2eCheckpoint: false` (or field missing in older PRDs)** → Phase 1 passing is sufficient. Skip `npm run test:e2e` and proceed to commit. Ralph runs a safety-net verification (full suite including E2E) after all stories complete, so skipping here is safe.

### Why conditional E2E?

E2E tests spawn Chromium browsers and servers — they take 3-5 minutes per run. Running them after every story wastes significant time when most stories don't affect browser behavior. The PRD author marks strategic checkpoints (after groups of behavioral changes and always on the final story) so E2E runs only when it adds value. Ralph guarantees at least one E2E run per PRD via an automatic safety net before merging.

### Safety net

Ralph runs a final verification gate (the full suite: build, type-check, lint, knip, test, and test:e2e) after all stories complete if the last completed story was not an E2E checkpoint. This ensures E2E tests always run at least once per PRD, even if no story is marked as a checkpoint. If the safety net fails, ralph launches additional iterations to fix the failures before merging.

### RALPH.md overrides CLAUDE.md for verification

The root `CLAUDE.md` says "run every check including `npm run test:e2e`" for every task. **This file (RALPH.md) overrides that instruction for ralph agents.** Follow the `e2eCheckpoint`-based rules above instead. The root CLAUDE.md's verification section applies to interactive development, not ralph-driven automation where the safety net provides the E2E guarantee.

### Interpreting E2E results

Playwright reports tests as "flaky" when they fail on the first attempt but pass on retry (configured via `retries: 1` in `playwright.config.ts`). **Flaky tests are passing tests.** Playwright exits 0 when all tests ultimately pass, including retried ones. Trust the exit code — do not re-run the entire E2E suite because the output mentions "flaky". Only re-run if the exit code is non-zero (meaning a test failed even after retries).

### Diagnosing E2E failures: build artifacts matter

E2E tests for the Chrome extension side panel run against the **built extension bundle** installed at `~/.opentabs/extension/`, not against source files. When E2E tests fail, keep this in mind:

- **Reverting source changes does not change the built bundle.** If you revert your source edits to test whether a failure is "pre-existing", you must also `npm run build` to rebuild the extension. Otherwise both runs (with and without your changes) execute the same broken bundle, and you falsely conclude the failure is pre-existing.
- **Always rebuild before re-running E2E tests.** After any source change that affects the extension (side panel, background script, offscreen), run `npm run build` before `npm run test:e2e`. The E2E infrastructure does NOT automatically rebuild the extension.
- **Side panel barrel imports can pull in Node.js code.** The side panel runs in a Chrome extension context with strict CSP — `node:fs`, `node:os`, `node:path` etc. are blocked. If you import from a barrel (e.g., `@opentabs-dev/shared`) that re-exports modules using Node.js APIs, **esbuild bundles the entire barrel** including those Node.js modules, and the side panel crashes silently (blank page). Use subpath imports (e.g., `@opentabs-dev/shared/browser-tools-catalog`) to import only the specific module you need, bypassing the barrel.
- **A blank side panel in E2E means a JS crash.** If all side panel E2E tests fail with `toBeVisible` timeouts and the side panel is blank, the cause is almost always a runtime error in the bundle (CSP violation, missing dependency, syntax error). Check the browser console for errors — do not assume infrastructure flakiness.

### E2E process isolation

Ralph manages process isolation — your worktree has its own process group, and ralph kills all your child processes (Chromium, test servers) when you finish. Port conflicts are impossible (`PORT=0` everywhere).

**Critical:** Do NOT run the root monorepo's `npm run build` / `npm run type-check` / etc. when working on a standalone subproject. These commands do not cover standalone subprojects and will give you a false green. Conversely, do NOT run a subproject's commands when working on the root monorepo. Always match the verification to the target project as specified in the PRD.

## Progress Report Format

APPEND to the progress file (never replace, always append):

```
## [Date/Time] - [Story ID]
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered (e.g., "this codebase uses X for Y")
  - Gotchas encountered (e.g., "don't forget to update Z when changing W")
  - Useful context (e.g., "the plugin SDK exports types from X")
---
```

The learnings section is critical — it helps future iterations avoid repeating mistakes and understand the codebase better.

## Consolidate Patterns

If you discover a **reusable pattern** that future iterations should know, add it to the `## Codebase Patterns` section at the TOP of the progress file (create it if it doesn't exist). This section should consolidate the most important learnings:

```
## Codebase Patterns
- Example: Platform packages are in platform/, plugins in plugins/
- Example: Use tsconfig.build.json for each package's build config
- Example: Export types from the package's public API barrel file
```

Only add patterns that are **general and reusable**, not story-specific details.

## Update CLAUDE.md Files

Before committing, check if any edited files have learnings worth preserving in nearby CLAUDE.md files:

1. **Identify directories with edited files** — look at which directories you modified
2. **Check for existing CLAUDE.md** — look for CLAUDE.md in those directories or parent directories
3. **Add valuable learnings** — if you discovered something future developers/agents should know:
   - API patterns or conventions specific to that module
   - Gotchas or non-obvious requirements
   - Dependencies between files
   - Testing approaches for that area
   - Configuration or environment requirements

**Examples of good CLAUDE.md additions:**

- "When modifying X, also update Y to keep them in sync"
- "This module uses pattern Z for all API calls"
- "Field names must match the template exactly"

**Do NOT add:**

- Story-specific implementation details
- Temporary debugging notes
- Information already in the progress file

Only update CLAUDE.md if you have **genuinely reusable knowledge** that would help future work in that directory.

## Own the Codebase — Hard Gate

**You MUST NOT commit code unless ALL required quality checks exit 0** (Phase 1 always; Phase 2 only when `e2eCheckpoint: true`). This is a hard gate, not a suggestion.

If quality checks fail — even on code you did not write — you MUST fix them before committing anything. There are NO exceptions:

- "Pre-existing" is not an excuse. Fix it.
- "Flaky test" is not an excuse. Fix the flakiness or make the test deterministic.
- "Timing-related" is not an excuse. Add proper waits, retries, or fix the race condition.
- "Not related to my story" is not an excuse. Fix it in a separate commit before your story commit.
- "Works on re-run" is not an excuse. If it fails once, it's broken. Fix the root cause.

If you cannot fix the failing check within your iteration, do NOT commit your story. Leave it as `passes: false` and document what's blocking in the progress file. A committed story with failing checks is worse than an uncommitted story — it poisons the codebase for all future iterations.

**All required phases must exit 0 end-to-end.** Phase 1 (fast checks) must always pass before you commit. If the current story has `e2eCheckpoint: true`, Phase 2 (full suite including E2E) must also pass. If any command in any required phase fails, do not commit.

## Browser Testing (If Available)

For any story that changes UI, verify it works in the browser if you have browser testing tools configured (e.g., via MCP):

1. Navigate to the relevant page
2. Verify the UI changes work as expected
3. Take a screenshot if helpful for the progress log

If no browser tools are available, note in your progress report that manual browser verification is needed.

## Git Rules

**PRD files and progress files in `.ralph/` must NEVER be committed.** They are ephemeral working files that are gitignored. The pre-commit hook will reject any commit that includes them.

When committing, **never use `git add .` or `git add -A`** — these can accidentally stage gitignored files that were previously tracked. Instead, stage only the specific files you changed:

```bash
git add path/to/file1.ts path/to/file2.ts
git commit -m "feat: [Story ID] - [Story Title]"
```

Steps 14 and 15 (updating the PRD and progress file) must happen **after** the commit, so these files are never in the staging area during a commit.

## Stop Condition — CRITICAL

**You MUST stop after completing exactly ONE user story.** Do not continue to the next story. Do not loop. One story per invocation, then stop.

After completing your one story, check if ALL stories now have `passes: true`.

If ALL stories are complete and passing, reply with:
<promise>COMPLETE</promise>

If there are still stories with `passes: false`, **STOP IMMEDIATELY. Do not work on them.** End your response. Another iteration will be launched to pick up the next story.

## Important

- **ONE story per invocation — then STOP.** This is the most important rule. Never implement more than one story.
- Commit frequently
- Keep builds green
- Read the Codebase Patterns section in the progress file before starting
- All file paths are relative to the project root
