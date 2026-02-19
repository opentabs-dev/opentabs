# Ralph Agent Instructions

You are an autonomous coding agent working on the OpenTabs Platform project.

## Your Task

1. Find the active PRD: look for the file in `.ralph/` whose name matches `prd-*~running.json` — there is exactly one at any time
2. Find the matching progress file: replace the `prd-` prefix with `progress-`, strip `~running`, and change the extension to `.txt` (e.g., `prd-2026-02-17-143000-improve-sdk~running.json` → `progress-2026-02-17-143000-improve-sdk.txt`)
3. Read the progress file's Codebase Patterns section first (if it exists)
4. Work on the current branch (do NOT create or switch branches)
5. Pick the **highest priority** user story where `passes: false`
6. Implement that single user story
7. Run ALL quality checks. If the PRD has a top-level `"qualityChecks"` field (a string containing the shell command), use that instead of the default. Otherwise use the default: `bun run build && bun run type-check && bun run lint && bun run knip && bun run test && bun run test:e2e`
8. **If ANY check fails, fix it before proceeding** — even pre-existing failures. See "Own the Codebase" below.
9. Update CLAUDE.md files if you discover reusable patterns (see below)
10. **Only if ALL checks exit 0**, commit code changes (see Git Rules below)
11. **After committing**, update the PRD to set `passes: true` for the completed story
12. **After committing**, append your progress to the matching progress file

## Project Context

This is the OpenTabs Platform project — an open-source platform enabling AI agents to interact with web applications through browser-authenticated sessions. It uses:

- **Language**: TypeScript (strict, ES Modules)
- **Runtime**: Bun
- **Build**: `bun run build` (tsc --build + extension bundling), `bun run type-check` (tsc --noEmit)
- **Quality**: `bun run lint` (ESLint), `bun run knip` (unused code), `bun run test` (unit tests)
- **Structure**: `platform/*` (mcp-server, browser-extension, plugin-sdk, create-plugin) and `plugins/*` (slack, etc.) — all at the project root

All file paths are relative to the project root (where `.ralph/` lives).

## Finding Your Files

The PRD and progress files use a naming convention based on the file name state machine:

```
.ralph/prd-YYYY-MM-DD-HHMMSS-objective~running.json    ← your PRD (read/update this)
.ralph/progress-YYYY-MM-DD-HHMMSS-objective.txt         ← your progress log (append to this)
```

Use a glob pattern to find the active PRD: `.ralph/prd-*~running.json`

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

## Quality Requirements

- ALL commits must pass: `bun run build && bun run type-check && bun run lint && bun run knip && bun run test && bun run test:e2e`
- Do NOT commit broken code
- Keep changes focused and minimal
- Follow existing code patterns in the codebase
- Use arrow function expressions (not function declarations)
- No TODO/FIXME/HACK comments — if something needs to be done, do it now

## Own the Codebase — Hard Gate

**You MUST NOT commit code unless ALL quality checks exit 0.** This is a hard gate, not a suggestion.

If quality checks fail — even on code you did not write — you MUST fix them before committing anything. There are NO exceptions:

- "Pre-existing" is not an excuse. Fix it.
- "Flaky test" is not an excuse. Fix the flakiness or make the test deterministic.
- "Timing-related" is not an excuse. Add proper waits, retries, or fix the race condition.
- "Not related to my story" is not an excuse. Fix it in a separate commit before your story commit.
- "Works on re-run" is not an excuse. If it fails once, it's broken. Fix the root cause.

If you cannot fix the failing check within your iteration, do NOT commit your story. Leave it as `passes: false` and document what's blocking in the progress file. A committed story with failing checks is worse than an uncommitted story — it poisons the codebase for all future iterations.

**The verification command must exit 0 end-to-end.** If the PRD has a top-level `"qualityChecks"` field, use that command. Otherwise use the default:

```bash
bun run build && bun run type-check && bun run lint && bun run knip && bun run test && bun run test:e2e
```

Run this BEFORE committing. If any command fails, do not commit.

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

Steps 10 and 11 (updating the PRD and progress file) must happen **after** the commit, so these files are never in the staging area during a commit.

## Stop Condition

After completing a user story, check if ALL stories have `passes: true`.

If ALL stories are complete and passing, reply with:
<promise>COMPLETE</promise>

If there are still stories with `passes: false`, end your response normally (another iteration will pick up the next story).

## Important

- Work on ONE story per iteration
- Commit frequently
- Keep builds green
- Read the Codebase Patterns section in the progress file before starting
- All file paths are relative to the project root
