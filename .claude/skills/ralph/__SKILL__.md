# Ralph Task Planner

Plan work and generate PRD files in `.ralph/` for autonomous execution by the Ralph daemon.

Ralph is a bash script (`.ralph/ralph.sh`) that runs as a long-lived daemon with parallel workers (default 3). It polls `.ralph/` for ready PRD files, dispatches them to workers by timestamp order, and each worker runs in its own **git worktree** for full isolation — no type-check, lint, or build conflicts between concurrent agents. Each PRD file drives a loop of AI coding iterations — one per user story. This skill creates the PRD file that the daemon picks up automatically.

---

## PRD Location: Always Root `.ralph/`

**PRD files MUST always be written to the root `.ralph/` directory** (the one containing `ralph.sh`). The ralph daemon only watches this single directory — it does not scan subdirectories or other `.ralph/` folders elsewhere in the repo.

Even when the task targets a standalone subproject (like `docs/`), the PRD goes in root `.ralph/`. The `workingDirectory` and `qualityChecks` fields in the PRD tell the ralph agent which project it's working on and how to verify the work.

---

## Multi-Project Repository

This repository contains multiple projects with different build systems and verification suites. **Every PRD must target exactly one project.** If work spans multiple projects, create separate PRDs for each.

### Identifying the Target Project

When the user describes a task, determine which project it targets:

1. **Check which files/directories the task affects**
2. **Check if that directory is a standalone subproject** — does it have its own `package.json` that is NOT in the root `workspaces` field? The root workspace only includes `platform/*`.
3. **If standalone**, read the subproject's `package.json` to discover its available scripts and construct the correct `qualityChecks` command
4. **If not standalone** (i.e., the work targets `platform/`, `e2e/`, or root configs), it targets the root monorepo — omit `workingDirectory` and `qualityChecks` to use defaults

### Setting PRD Fields for Each Project Type

**Root monorepo** (targets `platform/`, `e2e/`, root configs):

```json
{
  "project": "OpenTabs Platform",
  "userStories": [...]
}
```

No `workingDirectory` or `qualityChecks` — ralph uses the default suite.

**Docs site** (targets `docs/`):

```json
{
  "project": "OpenTabs Docs",
  "workingDirectory": "docs",
  "qualityChecks": "cd docs && bun run build && bun run type-check && bun run lint && bun run knip && bun run format:check",
  "userStories": [...]
}
```

**Plugins** (targets `plugins/<name>/`):

```json
{
  "project": "OpenTabs Plugin — <name>",
  "workingDirectory": "plugins/<name>",
  "qualityChecks": "cd plugins/<name> && bun run build && bun run type-check && bun run lint && bun run format:check",
  "userStories": [...]
}
```

**For any standalone subproject you haven't seen before:** read its `package.json` scripts to determine which checks are available. Only include checks that the subproject actually defines. Common scripts to look for: `build`, `type-check`, `lint`, `knip`, `test`.

### Acceptance Criteria Must Match the Target Project

Story acceptance criteria must reference the verification commands appropriate for the target project:

- **Root monorepo stories (`e2eCheckpoint: false`)**: `bun run build passes`, `bun run type-check passes`, `bun run lint passes`, `bun run knip passes`, `bun run test passes`
- **Root monorepo stories (`e2eCheckpoint: true`)**: `bun run build passes`, `bun run type-check passes`, `bun run lint passes`, `bun run knip passes`, `bun run test passes`, `bun run test:e2e passes`
- **Docs stories**: `cd docs && bun run build passes`, `cd docs && bun run type-check passes`, `cd docs && bun run lint passes`, `cd docs && bun run knip passes`, `cd docs && bun run format:check passes`
- **Plugin stories**: `cd plugins/<name> && bun run build passes`, `cd plugins/<name> && bun run type-check passes`, `cd plugins/<name> && bun run lint passes`, `cd plugins/<name> && bun run format:check passes`

Each standalone subproject also has `bun run check` as a single command that runs all its checks in sequence. Use the explicit list for `qualityChecks` (debuggability), but `bun run check` is a convenient alternative for acceptance criteria shorthand.

Do NOT list checks that the target project doesn't have scripts for.

### Notes Must Use Repo-Root-Relative Paths

All file paths in story notes must be relative to the repo root (e.g., `docs/mdx-components.tsx`, not `mdx-components.tsx`), since the ralph agent always runs from the project root.

---

## PRD File Name State Machine

```
prd-objective~draft.json                       — being written (this skill), ralph ignores
prd-YYYY-MM-DD-HHMMSS-objective.json           — ready for pickup by ralph daemon (timestamp added at publish time)
prd-YYYY-MM-DD-HHMMSS-objective~running.json   — currently being executed by a worker
prd-YYYY-MM-DD-HHMMSS-objective~done.json      — completed, pending archive
archived to .ralph/archive/                     — final resting place
```

Multiple PRDs can be `~running` simultaneously (one per worker). This skill writes with `~draft` (no timestamp). At publish time, a **shell command** generates the real timestamp and renames the file. This ensures correct ordering — the timestamp reflects when the PRD was actually ready, not when writing started.

---

## The Job

1. Receive a feature description or task from the user
2. **Determine the target project** (see "Identifying the Target Project" above)
3. Ask 3-5 essential clarifying questions (with lettered options) if the request is ambiguous — do NOT ask about story size (always small) or single-vs-multiple PRDs (AI decides)
4. **Validate scope** — for quality/refactoring tasks, read the code and discard any candidate stories that are subjective preferences rather than genuine issues
5. **Decide PRD structure** — split into multiple PRDs if the work divides cleanly into independent groups (see "Single vs Multiple PRDs"); keep as one PRD if stories are tightly coupled
6. Generate PRD file(s) with `~draft` suffix and NO timestamp (safe from premature pickup)
7. Publish: use a shell command to rename with the current timestamp (ensures accurate ordering)

**Important:** Do NOT start implementing. Do NOT launch ralph. Just create the PRD file(s). The ralph daemon (`ralph.sh`) must already be running and will pick them up automatically.

---

## Step 1: Determine Target Project

Before asking questions or writing the PRD:

1. Identify which directories the task affects
2. Check if the target directory has its own `package.json` outside the root workspace
3. If standalone: read its `package.json` scripts to build the `qualityChecks` command
4. If root monorepo: no special fields needed

This step is mandatory. Getting the target project wrong means ralph will run the wrong verification suite.

---

## Step 2: Clarifying Questions

Ask only critical questions where the initial prompt is ambiguous. Skip this step entirely if the request is already specific enough (e.g., a concrete bug fix list). Focus on:

- **Scope:** What exactly should be done?
- **Boundaries:** What should it NOT do?
- **Success criteria:** How do we know it's done?

Do NOT ask about story size or single-vs-multiple PRDs — these are decided by the AI (see "Story Rules" and "Single vs Multiple PRDs" below).

### Format Questions Like This:

```
1. What is the primary goal?
   A. Option one
   B. Option two
   C. Option three

2. What should this NOT change?
   A. Option one
   B. Option two
```

This lets users respond with "1A, 2B" for quick iteration.

---

## Step 3: Validate Scope (Quality/Refactoring Tasks)

**This step is mandatory when the task is about improving code quality, modularization, or enforcing best practices** (rather than building a new feature). Skip this step for feature work.

Before writing any stories, **read the actual code** and verify that each planned story addresses a genuine, demonstrable problem — not a matter of stylistic preference or an alternative approach to something that already works correctly.

For each candidate story, ask:

- **Is this a real problem or a different opinion?** If the existing code follows a recognized, industry-standard pattern and is correct, do not create a story to rewrite it in a different-but-equivalent style. Two valid approaches to the same problem do not make one of them a bug.
- **Can you articulate the concrete harm?** Every story must identify a specific, observable issue: a bug, a maintainability hazard, a performance problem, dead code, a resource leak, a missing defensive guard, an architectural inconsistency with concrete consequences, a violation of the project's own documented conventions, or duplicated logic. "I would have written it differently" is not a valid justification. A valid justification names a concrete consequence — something that can happen at runtime or during maintenance: a resource that grows unboundedly, an unhandled error path that crashes, a missing cleanup that fires on stale state, a guard present in some code paths but absent in equivalent ones, data silently dropped or duplicated, a code path that is unreachable, etc.

**Do not create stories that:**

- Rewrite working, idiomatic code into a stylistically different but equivalent form
- Apply a "best practice" that the codebase intentionally and consistently does not follow (check if there's a documented reason)
- Rename things that already have clear, descriptive names just because you'd prefer a different name
- Restructure modules that are already well-organized just to match a different organizational preference

**Do create stories that:**

- Fix actual bugs or incorrect behavior
- Remove genuinely dead or unreachable code
- Eliminate real duplication (not just similar-looking code that handles different concerns)
- Address violations of the project's own documented conventions (in CLAUDE.md, ESLint config, etc.)
- Fix real maintainability hazards (e.g., a 500-line function, deeply nested logic, missing error handling)
- Fix resource leaks or missing cleanup (uncleaned timers, event listeners, unbounded maps/caches)
- Add missing defensive guards (e.g., API version checks, null checks that prevent crashes on edge cases)
- Fix architectural inconsistencies with concrete consequences (e.g., shared state protected by locks in some code paths but not others, leading to potential race conditions or redundant work)

**Discard any candidate story that fails this validation.** Only exclude stories that are purely stylistic preferences — a different-but-equivalent way to write working code. If a story has a concrete consequence (leaked resource, potential crash, inconsistent behavior, data loss), it is a legitimate fix regardless of severity.

---

## Step 4: Generate PRD File

### File Naming

Use a short kebab-case objective slug with NO timestamp:

```
.ralph/prd-objective-slug~draft.json
```

Example: `.ralph/prd-improve-sdk-error-handling~draft.json`

**Do NOT put a timestamp in the draft filename.** The timestamp is added by a shell command at publish time (Step 5). This prevents timestamp inaccuracies from AI model clock drift.

Keep the objective slug to 3-5 words max.

### Writing Sequence

1. **Write** the PRD to `.ralph/prd-objective-slug~draft.json` (no timestamp)
2. **Verify** the JSON is valid: `python3 -c "import json; json.load(open('.ralph/prd-objective-slug~draft.json')); print('Valid')"`
3. **Publish** via shell command (see Step 5)

### PRD Format

```json
{
  "project": "[Project Name]",
  "description": "[What this batch of work accomplishes]",
  "workingDirectory": "[Optional — subdirectory for standalone subprojects, e.g. 'docs' or 'plugins/slack'. Omit for root monorepo.]",
  "qualityChecks": "[Optional — shell command for verification. Omit for root monorepo to use default suite.]",
  "userStories": [
    {
      "id": "US-001",
      "title": "[Story title]",
      "description": "As a [user], I want [feature] so that [benefit]",
      "acceptanceCriteria": [
        "Specific verifiable criterion",
        "Another criterion",
        "[verification commands matching the target project]"
      ],
      "priority": 1,
      "passes": false,
      "e2eCheckpoint": false,
      "notes": "Context to help the agent implement this story"
    }
  ]
}
```

**Fields:**

- `workingDirectory` (optional): The subdirectory containing the target project, relative to the repo root (e.g., `"docs"`, `"plugins/slack"`). Omit for root monorepo work. The ralph agent uses this to know which project's conventions and CLAUDE.md to read.
- `qualityChecks` (optional): A shell command string that overrides the default verification suite. Must match the target project's available scripts. Omit for root monorepo work — the ralph agent uses two-phase verification: Phase 1 (fast checks) always runs, Phase 2 (including `test:e2e`) runs only at `e2eCheckpoint` stories.
- `passes`: MUST be the boolean `false`, not `null` or omitted. Ralph checks `passes == false` to find incomplete stories.
- `e2eCheckpoint` (boolean): Controls whether the agent runs E2E tests (Phase 2) after completing this story. Only meaningful for root monorepo PRDs — set to `false` for standalone subproject stories (docs, plugins) since they don't have separate E2E tests. See "E2E Checkpoint Strategy" below.

---

## Step 5: Publish (Rename with Timestamp)

After writing and validating the PRD, publish it using this exact shell command:

```bash
mv .ralph/prd-SLUG~draft.json ".ralph/prd-$(date '+%Y-%m-%d-%H%M%S')-SLUG.json"
```

Replace `SLUG` with your objective slug. Example:

```bash
mv .ralph/prd-improve-sdk-error-handling~draft.json ".ralph/prd-$(date '+%Y-%m-%d-%H%M%S')-improve-sdk-error-handling.json"
```

**This is critical.** The `$(date ...)` shell expansion generates the real wall-clock timestamp at the moment of publishing. Ralph processes PRDs in filename-timestamp order, so accurate timestamps ensure correct sequencing.

**Never hardcode a timestamp in the filename.** Always use `$(date '+%Y-%m-%d-%H%M%S')` in the mv command.

---

## Story Rules

### Size: Always Small

**Always create small, focused stories.** Each story must be completable in ONE iteration (one fresh AI session with no memory of previous work). Small stories have a dramatically higher success rate than medium or large ones. Never ask the user whether to use small or large stories — always default to small.

**Right-sized stories (1-3 files):**

- Fix a bug in a single module
- Add a new tool or endpoint
- Refactor one file or function
- Update types in one package and fix downstream compile errors
- Extract duplicated code into a shared helper

**Too big (split these):**

- "Refactor the entire module" — split by file or concern
- "Add a new service" — split into: scaffold, API client, individual endpoints, tests
- "Fix all lint errors" — split by package or error category

**Rule of thumb:** If you cannot describe the change in 2-3 sentences, it is too big.

### Ordering: Dependencies First

Stories execute in priority order (1 = first). Earlier stories must not depend on later ones.

**Correct order:**

1. Shared types / data model changes
2. Backend / server changes that consume shared types
3. Frontend / UI changes
4. Tests and documentation

### Single vs Multiple PRDs

The AI decides whether to create one PRD or multiple — do not ask the user. The decision is based on dependency structure:

- **One PRD** when stories are tightly coupled — they touch the same files, share types, or must be applied in strict sequence. Splitting tightly coupled work across PRDs risks merge conflicts and ordering issues. A single PRD ensures one worker handles them sequentially in the correct order.
- **Multiple PRDs** when the work can be cleanly divided into independent groups that touch different modules or files. Multiple PRDs let ralph dispatch them to separate workers in parallel, completing the batch faster. Split by module boundary (e.g., one PRD for `plugin-sdk/`, another for `mcp-server/`).

**Rule of thumb:** If splitting into two PRDs would cause both workers to edit the same files, keep it as one PRD. If the groups are independent, split them so workers run in parallel.

### Minimize Merge Conflicts Across PRDs

When creating multiple PRDs, merge conflicts are the main risk. Ralph merges completed branches sequentially into main. If two workers touched the same files, the second merge will conflict. Ralph preserves the conflicting branch for manual resolution and moves on.

**To reduce conflicts:**

- **Avoid overlapping file changes across PRDs.** If two PRDs both need to edit `platform/mcp-server/src/index.ts`, put those stories in the SAME PRD so one agent handles both.
- **Split by module boundary.** PRD-A touches `plugin-sdk/`, PRD-B touches `mcp-server/` — zero conflict risk.
- **If overlap is unavoidable**, order the PRDs by dependency — put the foundational changes first (lower timestamp = dispatched first = merged first).

### Acceptance Criteria: Must Be Verifiable

Each criterion must be something the agent can CHECK, not something vague.

**Good:** "saveConfig call includes secret field", "z.number() params have .min(1)", "Dropdown shows 3 options"
**Bad:** "Works correctly", "Handles edge cases", "Good UX"

**Always include the verification suite** as the final acceptance criteria for every story, using commands that match the target project (see "Acceptance Criteria Must Match the Target Project" above). For root monorepo stories with `e2eCheckpoint: false`, list only the fast checks (build, type-check, lint, knip, test) — do not list `bun run test:e2e`. For `e2eCheckpoint: true` stories, include `bun run test:e2e` as well.

### Notes Field

Use the `notes` field to give the agent implementation hints:

- Which file and approximate line number to edit
- What the current code looks like
- What pattern to follow
- What gotchas to watch for

Good notes dramatically increase success rate per iteration.

---

## E2E Checkpoint Strategy

E2E tests are expensive (3-5 minutes per run, spawning Chromium). Running them after every story wastes significant time when most stories don't affect browser behavior. The `e2eCheckpoint` field controls when the agent runs E2E tests.

**This section only applies to root monorepo PRDs** (where `qualityChecks` is not set). Standalone subprojects (docs, plugins) typically don't have E2E tests — their `qualityChecks` field defines the full verification suite.

### How It Works

- `e2eCheckpoint: true` — the agent runs Phase 1 (fast checks) AND Phase 2 (full suite including `bun run test:e2e`) before committing this story.
- `e2eCheckpoint: false` — the agent runs Phase 1 only (fast checks: build, type-check, lint, knip, unit tests). No E2E.
- **Safety net:** Ralph automatically runs the full verification suite (including `bun run test:e2e`) after all stories complete if the final story (last to execute) did not have `e2eCheckpoint: true`. This ensures E2E tests always run at least once per PRD, even if no story is marked as a checkpoint.

### When to Set `e2eCheckpoint: true`

Mark a story as an E2E checkpoint when:

1. **The story changes browser-observable behavior** — tool dispatch, side panel UI, adapter injection, WebSocket communication, or anything that Playwright E2E tests exercise.
2. **The story is the last in a group of behavioral changes** — if stories US-003 through US-006 all touch the browser extension, mark US-006 as the checkpoint. This batches E2E verification for the group.
3. **The story is the final story in a PRD that touches browser behavior** — mark the last story as a checkpoint so the branch is fully verified before ralph merges it. If no story in the PRD touches browser behavior, this is not needed — ralph's safety net handles it.

### When to Set `e2eCheckpoint: false`

Keep a story as a non-checkpoint when:

1. **The story is purely internal** — type changes, refactoring, lint fixes, documentation, SDK-internal changes that don't affect runtime behavior.
2. **The story only changes server-side logic verified by unit tests** — if `bun run test` covers the change, E2E adds no value.
3. **The story is early in a group of related changes** — batch the E2E run to the last story in the group instead.

### Grouping Guidelines

- **Group related behavioral stories together** and put a checkpoint on the last one. A typical group is 2-4 stories.
- **Don't go more than ~5 stories without a checkpoint** if any of them touch behavior — the longer you wait, the harder it is to diagnose which story caused an E2E failure.
- **Isolated high-risk stories** (e.g., changing WebSocket protocol, modifying tool dispatch) should be their own checkpoint — don't batch these with other changes.
- **If the PRD touches browser behavior, mark the final story as a checkpoint** — this is the last line of defense before merge.
- **If no story touches browser behavior** (pure server-side, SDK internals, type changes, refactoring, docs), all stories can have `e2eCheckpoint: false`. Ralph's safety net still runs E2E after all stories complete, so regressions are caught without wasting time on mid-PRD checkpoints.

### Example

```json
{
  "userStories": [
    {
      "id": "US-001",
      "title": "Add shared types for new feature",
      "e2eCheckpoint": false,
      "priority": 1,
      "passes": false
    },
    {
      "id": "US-002",
      "title": "Implement server-side handler",
      "e2eCheckpoint": false,
      "priority": 2,
      "passes": false
    },
    { "id": "US-003", "title": "Add browser extension adapter", "e2eCheckpoint": true, "priority": 3, "passes": false },
    { "id": "US-004", "title": "Refactor error messages", "e2eCheckpoint": false, "priority": 4, "passes": false },
    { "id": "US-005", "title": "Update side panel UI", "e2eCheckpoint": true, "priority": 5, "passes": false }
  ]
}
```

In this example, E2E runs twice: after US-003 (verifies the new adapter works end-to-end) and after US-005 (final story checkpoint, verifies UI changes). Because the final story is a checkpoint, ralph's safety net is skipped — the branch is already fully verified.

**Example: Internal-only PRD (no E2E checkpoints)**

```json
{
  "userStories": [
    {
      "id": "US-001",
      "title": "Extract shared type definitions",
      "e2eCheckpoint": false,
      "priority": 1,
      "passes": false
    },
    {
      "id": "US-002",
      "title": "Refactor error handling in SDK",
      "e2eCheckpoint": false,
      "priority": 2,
      "passes": false
    },
    {
      "id": "US-003",
      "title": "Remove dead code from server utils",
      "e2eCheckpoint": false,
      "priority": 3,
      "passes": false
    }
  ]
}
```

No story touches browser behavior, so no E2E checkpoints are needed mid-PRD. Ralph's safety net automatically runs the full verification suite (including E2E) after all stories complete.

---

## Step 6: Confirm and Monitor

After publishing the PRD file, tell the user:

1. **PRD file created:** the full path and story count
2. **Target project:** which project the PRD targets and what verification commands will be used
3. **Auto-pickup:** the ralph daemon will pick it up automatically (no manual launch needed)
4. **Monitoring commands:**
   - **Watch ralph daemon:** `tail -f .ralph/ralph.log`
   - **Check PRD state:** `ls -la .ralph/prd-*.json` (look for `~running` suffix)
   - **Check progress:** `cat .ralph/progress-*.txt`
   - **Check worktrees:** `git worktree list`
   - **Start ralph daemon** (if not running): `nohup bash .ralph/ralph.sh --workers 3 &`
   - **Start for a single batch:** `nohup bash .ralph/ralph.sh --workers 3 --once &`

---

## Git Rules

PRD files and progress files in `.ralph/` are gitignored and must NEVER be committed. They are ephemeral working files that change on every ralph run. If they are accidentally tracked, remove them from the index with `git rm --cached` without deleting from disk.

Ralph commits code changes only — never ralph's own state files.

---

## Checklist Before Publishing

- [ ] **Target project identified** — determined whether this is root monorepo, docs, or a plugin
- [ ] PRD is in root `.ralph/` (not in a subdirectory)
- [ ] **`workingDirectory` set** if targeting a standalone subproject (omitted for root monorepo)
- [ ] **`qualityChecks` set** if targeting a standalone subproject (omitted for root monorepo)
- [ ] **`qualityChecks` matches the subproject's actual available scripts** (verified by reading its `package.json`)
- [ ] **Acceptance criteria use the correct project's verification commands** (not the root monorepo's commands for a subproject, or vice versa)
- [ ] Each story completable in one iteration
- [ ] Stories ordered by dependency (no story depends on a later story)
- [ ] Acceptance criteria are verifiable (not vague)
- [ ] Notes field has implementation hints for non-trivial stories
- [ ] Notes use repo-root-relative file paths
- [ ] `passes` field is boolean `false` for every story
- [ ] `e2eCheckpoint` field is set on every story (`false` for standalone subprojects; see "E2E Checkpoint Strategy" for root monorepo)
- [ ] **For root monorepo PRDs that touch browser behavior: the final story has `e2eCheckpoint: true`** and checkpoints are placed at logical group boundaries
- [ ] **For root monorepo PRDs with no browser-observable changes: all stories can be `e2eCheckpoint: false`** (ralph's safety net runs E2E after completion)
- [ ] JSON is valid
- [ ] File written with `~draft` suffix and NO timestamp in filename
- [ ] Published via `mv` command with `$(date '+%Y-%m-%d-%H%M%S')` for accurate timestamp
