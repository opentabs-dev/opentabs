# Ralph Task Planner

Plan work and generate PRD files for autonomous execution by distributed Ralph workers.

Ralph uses a **git-based distributed work queue** (`opentabs-prds` repo on GitHub). This skill writes PRD files to that queue repo, and distributed workers across the internet claim and execute them atomically. Each PRD file drives a loop of AI coding iterations — one per user story. Workers push completed work as branches to the code repo, and a consolidator merges them into main.

---

## PRD Location: The Queue Repo

**PRD files MUST be written to the `opentabs-prds` repo** (located at `~/workspace/src/opentabs-prds/` or wherever the user has it cloned). This is a separate git repo that serves as the distributed work queue. PRD files are committed and pushed to the remote, where workers fetch and claim them.

Even when the task targets a standalone subproject (like `docs/`), the PRD goes in the queue repo root. The `workingDirectory` and `qualityChecks` fields in the PRD tell the worker which project it's working on and how to verify the work.

The queue repo path can be configured. If `~/workspace/src/opentabs-prds/` does not exist, ask the user for the correct path.

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
  "qualityChecks": "cd docs && npm run build && npm run type-check && npm run lint && npm run knip && npm run format:check",
  "userStories": [...]
}
```

**Plugins** (targets `plugins/<name>/`):

```json
{
  "project": "OpenTabs Plugin — <name>",
  "workingDirectory": "plugins/<name>",
  "qualityChecks": "cd plugins/<name> && npm run build && npm run type-check && npm run lint && npm run format:check",
  "userStories": [...]
}
```

**For any standalone subproject you haven't seen before:** read its `package.json` scripts to determine which checks are available. Only include checks that the subproject actually defines. Common scripts to look for: `build`, `type-check`, `lint`, `knip`, `test`.

### Acceptance Criteria Must Be Behavioral, Not Mechanical

Acceptance criteria describe **what the code should do** — not whether it compiles. Build, lint, type-check, and test commands are already enforced by `qualityChecks` and the worker's verification suite. Listing "npm run build passes" in every story is boilerplate that dilutes the actual criteria the worker should focus on.

**Good acceptance criteria:**

- `parseConfigRecord reads record.permissions, not record.plugins`
- `savePluginPermissions writes 'permissions' key to JSON output`
- `Legacy migration blocks for tools/browserToolPolicy are deleted`
- `No references to 'skipConfirmation' remain in platform/mcp-server/src/`

**Bad acceptance criteria (do not include these):**

- `npm run build passes` — already enforced by qualityChecks
- `npm run type-check passes` — already enforced
- `All tests pass` — already enforced
- `Works correctly` — not verifiable
- `Handles edge cases` — not specific

### Notes Must Use Repo-Root-Relative Paths

All file paths in story notes must be relative to the repo root (e.g., `docs/mdx-components.tsx`, not `mdx-components.tsx`), since the ralph agent always runs from the project root.

---

## PRD File Name State Machine

```
prd-objective~draft.json                       — being written (this skill), not committed
prd-YYYY-MM-DD-HHMMSS-objective.json           — ready for pickup (committed + pushed to remote)
prd-YYYY-MM-DD-HHMMSS-objective~running.json   — claimed by a worker (atomic via git push)
prd-YYYY-MM-DD-HHMMSS-objective~done.json      — completed, pending archive
archived to archive/                            — final resting place
```

Multiple PRDs can be `~running` simultaneously (one per worker). This skill writes with `~draft` (no timestamp). At publish time, `producer.sh` renames the file with a real timestamp and a 6-character content hash, commits, and pushes to the remote. The timestamp ensures correct ordering, the hash ensures unique branch names even for PRDs with the same slug.

---

## The Job

1. Receive a feature description or task from the user
2. **Determine the target project** (see "Identifying the Target Project" above)
3. Ask 3-5 essential clarifying questions (with lettered options) if the request is ambiguous — do NOT ask about story size (always small) or single-vs-multiple PRDs (AI decides)
4. **Validate scope** — for quality/refactoring tasks, read the code and discard any candidate stories that are subjective preferences rather than genuine issues
5. **Read the code** — before writing any story notes, read every file the stories will touch. Collect actual function names, actual code snippets, and exhaustive file lists. This research goes directly into the notes. See "Notes: The Highest-Leverage Field" for the required structure.
6. **Decide PRD structure** — split into multiple PRDs if the work divides cleanly into independent groups (see "Single vs Multiple PRDs"); keep as one PRD if stories are tightly coupled
7. Generate PRD file(s) with `~draft` suffix and NO timestamp in the queue repo
8. Publish: run `producer.sh` to rename with timestamp, commit, and push to remote

**Important:** Do NOT start implementing. Just create and publish the PRD file(s). Distributed workers will claim them from the remote queue.

**Never ask for confirmation before publishing.** Always publish immediately after writing and validating. The user has already approved the task by requesting it — publishing is the final step, not a decision point. The only exception is **dependent PRDs** — these must be held as `~draft` until their dependencies land (see "Never Publish Dependent PRDs Together").

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

Every story you create will be implemented by an autonomous agent. If you create a story for a non-issue, the agent will make an unnecessary change to working code, potentially introducing a real bug. A false positive is worse than a missed issue.

### What qualifies as a genuine issue

A genuine issue has a **concrete, observable consequence**:

- **Runtime crash or exception** — unhandled error, null dereference, type mismatch at runtime
- **Data loss or corruption** — silent data drop, partial write, truncated output, incorrect calculation
- **Resource leak** — unbounded map/set/array growth, uncleaned timer/interval, unreleased listener, orphaned connection
- **Security vulnerability** — missing input validation, leaked secrets in errors, permission bypass
- **Race condition** — concurrent operations producing incorrect state, lost updates, stale closures
- **Silent wrong behavior** — function returns incorrect result without error, condition is always true/false
- **Missing cleanup on equivalent path** — cleanup runs on success but not on error (or vice versa)
- **Dead or unreachable code** — exports never imported, branches that can never execute, code after unconditional return
- **Unhelpful error that causes user confusion** — error message that doesn't tell the user what went wrong or how to fix it
- **Violation of the project's own documented conventions** (in CLAUDE.md, Biome config, etc.)
- **Real duplication** — identical logic copy-pasted (not just similar-looking code that handles different concerns)

Every story must name one of these consequences specifically.

### What does NOT qualify as an issue

- **Style preferences** — you would write it differently, but the current code is correct and clear
- **Equivalent alternatives** — `for...of` vs `.forEach()`, `const` vs `let` when mutation doesn't occur, early return vs else block
- **Naming preferences** — the current name is descriptive and unambiguous, you just prefer a different word
- **Module organization preferences** — moving code between files without fixing a concrete problem
- **Theoretical issues with no reachable execution path** — if no sequence of events can trigger it, skip it
- **Issues already handled by existing code** — always read the full function, the caller, and the surrounding module before reporting. If a guard, catch, cleanup, fallback, or retry already addresses the concern, skip it
- **Best practices the codebase intentionally does not follow** — check if there's a documented reason before reporting

### Validation checklist (apply to every candidate story)

Before including a story, verify ALL four:

1. **Concrete consequence.** Can you name the specific observable harm from the list above? If you cannot name it, discard.
2. **Not a style preference.** Is the existing code functionally incorrect or hazardous — not just a different-but-equivalent approach? If it works correctly using a recognized pattern, discard.
3. **Not already handled.** Have you read the full function and its callers to check for existing guards, catches, cleanup, or fallback logic? If already handled, discard.
4. **Reproducible trigger.** Does there exist a sequence of events (even if unlikely) that triggers the issue? If no path leads to the problem, discard.

**Discard any candidate story that fails any of these four checks.** It is better to create 2 genuine stories than 2 genuine stories plus 1 false positive.

**The bright-line test:** Before including any story, ask: _"Is the current code incorrect, or would I just write it differently?"_ If the answer is "I'd write it differently," discard it.

If you find **zero genuine issues** after validation, that is a valid outcome. Do not manufacture stories to fill a quota.

---

## Step 4: Read the Code

**This step is mandatory for all tasks** — features, refactoring, bug fixes, migrations.

Before writing any story's notes, read every file that the stories will touch. The goal is to collect concrete, quotable information that goes directly into the notes:

1. **Identify every file** that each planned story must modify
2. **Read each file** — find the actual function names, actual code snippets, actual identifiers
3. **Quote the current code** in your notes — the worker will grep for these snippets
4. **Identify negative constraints** — what must NOT change, what invariants must be preserved
5. **Spot traps** — non-obvious interactions, naming collisions, subtle dependencies the worker wouldn't know about

The research you do here is the raw material for the notes. If you skip this step, your notes will be vague ("update the config function") instead of precise (`change const plugins = parsePluginsConfig(record.plugins) to const permissions = parsePluginsConfig(record.permissions)`), and the worker will waste its first iteration re-discovering what you already know.

---

## Step 5: Generate PRD File

### File Naming

Use a short kebab-case objective slug with NO timestamp:

```
prd-objective-slug~draft.json
```

Written to the queue repo (e.g., `~/workspace/src/opentabs-prds/prd-improve-sdk-error-handling~draft.json`).

**Do NOT put a timestamp in the draft filename.** The timestamp is added by `producer.sh` at publish time (Step 6). This prevents timestamp inaccuracies from AI model clock drift.

Keep the objective slug to 3-5 words max.

### Writing Sequence

1. **Write** the PRD to `<queue-repo>/prd-objective-slug~draft.json` (no timestamp)
2. **Verify** the JSON is valid: `python3 -c "import json,sys; json.load(open(sys.argv[1])); print('Valid')" <queue-repo>/prd-objective-slug~draft.json`
3. **Publish** via `producer.sh` (see Step 6)

### PRD Format

```json
{
  "project": "[Project Name]",
  "description": "[What this batch of work accomplishes — serves as a contract: after all stories pass, what is true about the codebase that wasn't before?]",
  "workingDirectory": "[Optional — subdirectory for standalone subprojects, e.g. 'docs' or 'plugins/slack'. Omit for root monorepo.]",
  "qualityChecks": "[Optional — shell command for verification. Omit for root monorepo to use default suite.]",
  "userStories": [
    {
      "id": "US-001",
      "title": "[Story title]",
      "description": "[Direct statement of what code to change and why]",
      "acceptanceCriteria": [
        "Specific behavioral criterion (not build/lint commands)",
        "Another verifiable criterion"
      ],
      "priority": 1,
      "passes": false,
      "e2eCheckpoint": false,
      "model": "sonnet",
      "notes": "Context to help the agent implement this story"
    }
  ]
}
```

**Fields:**

- `description` (string): A direct statement of what code to change and why. Do NOT use the "As a [user], I want [feature] so that [benefit]" template — workers are autonomous agents, not product managers. Write a concise description of the change: `"Rename the 'plugins' config key to 'permissions' in OpentabsConfig, parseConfigRecord, and savePluginPermissions."` not `"As a platform developer, I want the config key renamed so that the schema is clearer."`
- `workingDirectory` (optional): The subdirectory containing the target project, relative to the repo root (e.g., `"docs"`, `"plugins/slack"`). Omit for root monorepo work. The ralph agent uses this to know which project's conventions and CLAUDE.md to read.
- `qualityChecks` (optional): A shell command string that overrides the default verification suite. Must match the target project's available scripts. Omit for root monorepo work — the ralph agent uses two-phase verification: Phase 1 (fast checks) always runs, Phase 2 (including `test:e2e`) runs only at `e2eCheckpoint` stories.
- `passes`: MUST be the boolean `false`, not `null` or omitted. Ralph checks `passes == false` to find incomplete stories.
- `e2eCheckpoint` (boolean): Controls whether the agent runs E2E tests (Phase 2) after completing this story. Only meaningful for root monorepo PRDs — set to `false` for standalone subproject stories (docs, plugins) since they don't have separate E2E tests. See "E2E Checkpoint Strategy" below.
- `model` (string): Which AI model to use for this story. Either `"sonnet"` or `"opus"`. The worker maps these to the configured model names (e.g., `claude-sonnet` or `claude-opus`). See "Model Selection" below for guidance.

---

## Step 6: Publish (via producer.sh)

After writing and validating the PRD, publish it using `producer.sh` in the queue repo:

```bash
cd ~/workspace/src/opentabs-prds && ./producer.sh prd-SLUG~draft.json
```

Replace `SLUG` with your objective slug. Example:

```bash
cd ~/workspace/src/opentabs-prds && ./producer.sh prd-improve-sdk-error-handling~draft.json
```

`producer.sh` handles everything atomically:

1. Validates the JSON
2. Renames with a real wall-clock timestamp (e.g., `prd-2026-02-26-143000-improve-sdk-error-handling.json`)
3. Commits to the queue repo
4. Pushes to the remote (with retry if concurrent workers are also pushing)

For multiple **independent** PRDs, pass them all at once:

```bash
cd ~/workspace/src/opentabs-prds && ./producer.sh prd-sdk-fixes~draft.json prd-docs-updates~draft.json
```

**Never hardcode a timestamp in the filename.** `producer.sh` generates it at publish time.

**Only publish PRDs that can run against the current state of main.** If some PRDs depend on others landing first, only publish the independent ones now. Leave dependent PRDs as `~draft` files and tell the user when to publish them (see "Never Publish Dependent PRDs Together").

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

### Never Publish Dependent PRDs Together

**Workers execute all published PRDs in parallel.** There is no sequencing between PRDs — once a PRD is pushed to the queue, a worker claims it immediately regardless of whether other PRDs have completed. This means:

- **If PRD-B depends on PRD-A's changes being merged into main first, do NOT publish both at the same time.** PRD-B's worker will start from main (which doesn't have PRD-A's changes yet), and the build will fail or the worker will waste time working against stale code.
- **Only publish PRDs that can run independently from the current state of main.** If later PRDs depend on earlier ones, publish only the foundational PRD. Tell the user to publish the dependent PRDs after the first one lands.
- **Write the dependent PRDs to disk with `~draft` suffix but do NOT run `producer.sh` on them.** This preserves the work for later publishing. Tell the user which draft files are waiting and what they depend on.

Example: If adding a new SDK field (PRD-A) and then using that field in all plugins (PRD-B, PRD-C, PRD-D):
1. Publish PRD-A immediately
2. Write PRD-B, PRD-C, PRD-D as `~draft` files
3. Tell the user: "PRD-A is published. After it lands, publish the plugin PRDs with: `cd ~/workspace/src/opentabs-prds && ./producer.sh prd-B~draft.json prd-C~draft.json prd-D~draft.json`"

### Minimize Merge Conflicts Across PRDs

When creating multiple independent PRDs, merge conflicts are the main risk. Ralph merges completed branches sequentially into main. If two workers touched the same files, the second merge will conflict. Ralph preserves the conflicting branch for manual resolution and moves on.

**To reduce conflicts:**

- **Avoid overlapping file changes across PRDs.** If two PRDs both need to edit `platform/mcp-server/src/index.ts`, put those stories in the SAME PRD so one agent handles both.
- **Split by module boundary.** PRD-A touches `plugin-sdk/`, PRD-B touches `mcp-server/` — zero conflict risk.
- **If overlap is unavoidable**, order the PRDs by dependency — put the foundational changes first (lower timestamp = dispatched first = merged first).

### Acceptance Criteria: Must Be Verifiable

Each criterion must be something the agent can CHECK — by reading code, grepping for identifiers, or checking command output. Never write vague criteria.

**Good:** `saveConfig call includes secret field`, `z.number() params have .min(1)`, `No references to 'oldName' remain in src/`
**Bad:** "Works correctly", "Handles edge cases", "Good UX"

**Do NOT include build/test/lint commands in acceptance criteria.** Those checks are already enforced automatically by the worker's verification suite (`qualityChecks` or the default phase-based suite). Including them in every story wastes tokens and obscures the behavioral criteria that actually matter.

### Notes: The Highest-Leverage Field

Notes are the single biggest determinant of whether a worker succeeds in one iteration or wastes three. The worker starts a fresh AI session with zero memory of your research — **if you researched the codebase to plan the story, put everything you learned into the notes.** The worker cannot see your research.

**Before writing any story's notes, read the files that story will modify.** This applies to all tasks — features, refactoring, bug fixes, migrations. Use actual identifiers, actual function names, and actual code content. Do not guess from memory.

#### Required Structure

Every story's notes must follow this structure:

```
Files:
- path/to/file.ts (what changes here)
- path/to/other.ts (what changes here)

Context:
[Why this change is needed, how the current code works]

Changes:
[Specific changes to make, with quoted current code]

Constraints:
[What NOT to change, invariants to preserve]
```

#### What Good Notes Contain

- **An exhaustive file list.** Every file the worker must modify, with a parenthetical explaining what changes in each. If you say "update all consumers" but don't list them, the worker will miss some.
- **Quoted current code.** Not "around line 221" — the actual line content: `const plugins = parsePluginsConfig(record.plugins);`. Line numbers drift across stories in the same PRD. A quoted snippet is grep-able and unambiguous.
- **Before/after examples.** For mechanical changes, show a before/after for at least one instance. The worker pattern-matches from there.
- **Explicit negative constraints.** What the worker must NOT change. Example: "Do NOT rename `state.pluginPermissions` — only the config JSON key changes." Workers over-apply renames unless told where to stop.
- **Related code the worker should read but not modify.** If understanding function X is necessary to correctly modify function Y, say so.
- **Trap warnings.** If there's an obvious wrong approach that would seem correct, call it out: "Do NOT add a legacy fallback — this is a hard rename with no backwards compatibility."

---

## Why Stories Fail

These are the most common reasons workers waste iterations. Avoid them by writing better PRDs.

### 1. Vague notes force the worker to re-discover the codebase

The planner already read the code, found the relevant files, identified the functions to change. But the notes say "update the config parsing function" instead of quoting the actual code. The worker spends its first 5 minutes reading files the planner already read. Fix: dump your research into the notes.

### 2. "Update all X" without an exhaustive list

The notes say "update all consumers of config.plugins" but don't list them. The worker finds 8 out of 12 and the build breaks. Fix: always enumerate every file that must change.

### 3. Missing negative constraints cause over-eager changes

A rename story says "rename plugins to permissions" and the worker also renames the unrelated `state.pluginPermissions` field, breaking the entire server. Fix: explicitly state what must NOT change.

### 4. Story is too broad for one iteration

The story says "refactor the permission system" — a 15-file change. The worker makes partial progress, hits the iteration limit, and leaves the codebase in a half-migrated state. Fix: split into smaller stories.

### 5. Acceptance criteria are vague or mechanical

Criteria like "works correctly" or "npm run build passes" give the worker no signal about what to verify behaviorally. The worker thinks it's done when the build passes, but the actual requirement (e.g., "legacy migration blocks are deleted") was never checked. Fix: write specific behavioral criteria.

### 6. No trap warnings for non-obvious gotchas

The codebase has a subtle invariant the worker doesn't know about (e.g., "the old `permissions` key with `trustedDomains` is a different thing that also gets parsed here"). The worker introduces a collision or regression. Fix: warn about every non-obvious interaction.

---

## Model Selection

Each story specifies which AI model the worker should use. Choose based on complexity:

**Use `"sonnet"` ONLY for truly mechanical tasks:**

- Search-and-replace migrations (e.g., rename API, update imports across files)
- Documentation updates
- Config file changes
- Deleting dead code that is clearly unused (no judgment calls about what's dead)
- Adding a single test case to an existing test file with a clear pattern to follow
- Simple additions where the notes give exact code to write and exact location

**Use `"opus"` for everything else**, including but not limited to:

- **Bug fixes** — even "simple" ones. Bug fixes require understanding why the code is wrong, what the correct fix is, and what side effects the fix might have. Sonnet often fixes the symptom without understanding the root cause.
- **Race conditions, concurrency, and state synchronization** — anything involving async operations, caches, optimistic updates, or message ordering. These require reasoning about interleaving and timing.
- **Cross-module changes** — any story that touches more than one module or requires understanding how modules interact (e.g., background script + side panel, server + extension).
- **Adding new functionality** — new functions, new message handlers, new API endpoints, new components.
- **Refactoring** — extracting helpers, changing data flow, restructuring code.
- **Test writing** — except trivially copying an existing test pattern. Writing good tests requires understanding what the code does, what edge cases exist, and what assertions are meaningful.
- **Architectural changes** — anything that changes how components communicate, what data flows where, or how state is managed.
- **E2E tests** — always opus. E2E tests interact with process management, browser APIs, timing, and complex fixtures.
- **Any story where getting it wrong introduces a subtle bug** — if a naive implementation would pass the build but be incorrect at runtime, use opus.

**The default is `"opus"`.** Only downgrade to `"sonnet"` when the task is purely mechanical with zero judgment required. A failed sonnet iteration wastes more time and money than running opus from the start. When in doubt, use opus.

---

## E2E Checkpoint Strategy

E2E tests are expensive (3-5 minutes per run, spawning Chromium). Running them after every story wastes significant time when most stories don't affect browser behavior. The `e2eCheckpoint` field controls when the agent runs E2E tests.

**This section only applies to root monorepo PRDs** (where `qualityChecks` is not set). Standalone subprojects (docs, plugins) typically don't have E2E tests — their `qualityChecks` field defines the full verification suite.

### How It Works

- `e2eCheckpoint: true` — the agent runs Phase 1 (fast checks) AND Phase 2 (full suite including `npm run test:e2e`) before committing this story.
- `e2eCheckpoint: false` — the agent runs Phase 1 only (fast checks: build, type-check, lint, knip, unit tests). No E2E.
- **Safety net:** Ralph automatically runs the full verification suite (including `npm run test:e2e`) after all stories complete if the final story (last to execute) did not have `e2eCheckpoint: true`. This ensures E2E tests always run at least once per PRD, even if no story is marked as a checkpoint.

### When to Set `e2eCheckpoint: true`

Mark a story as an E2E checkpoint when:

1. **The story changes browser-observable behavior** — tool dispatch, side panel UI, adapter injection, WebSocket communication, or anything that Playwright E2E tests exercise.
2. **The story is the last in a group of behavioral changes** — if stories US-003 through US-006 all touch the browser extension, mark US-006 as the checkpoint. This batches E2E verification for the group.
3. **The story is the final story in a PRD that touches browser behavior** — mark the last story as a checkpoint so the branch is fully verified before ralph merges it. If no story in the PRD touches browser behavior, this is not needed — ralph's safety net handles it.

### When to Set `e2eCheckpoint: false`

Keep a story as a non-checkpoint when:

1. **The story is purely internal** — type changes, refactoring, lint fixes, documentation, SDK-internal changes that don't affect runtime behavior.
2. **The story only changes server-side logic verified by unit tests** — if `npm run test` covers the change, E2E adds no value.
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

## Step 7: Confirm and Monitor

After publishing the PRD file, tell the user:

1. **PRD file published:** the filename, story count, and that it was pushed to the remote
2. **Target project:** which project the PRD targets and what verification commands will be used
3. **Auto-pickup:** distributed workers polling the queue will claim it automatically
4. **Deferred PRDs** (if any): list the `~draft` files that were written but not published, explain what they depend on, and provide the exact `producer.sh` command to publish them later
5. **Monitoring commands:**
   - **Check queue state:** `cd ~/workspace/src/opentabs-prds && git pull && ls prd-*.json` (look for `~running` suffix)
   - **Check progress:** `cd ~/workspace/src/opentabs-prds && git pull && cat progress-*.txt`
   - **Check code branches:** `git ls-remote origin 'refs/heads/ralph-*'`
   - **Start a consumer** (if none running): `./consumer.sh --code-repo https://github.com/opentabs-dev/opentabs.git --workers 2`
   - **Start consolidator** (to merge branches): `./consolidator.sh --code-repo https://github.com/opentabs-dev/opentabs.git`
   - **Single batch run:** `./consumer.sh --code-repo https://github.com/opentabs-dev/opentabs.git --once`

---

## Git Rules

PRD files in the queue repo (`opentabs-prds`) ARE tracked by git — they are the queue's state and must be committed and pushed. `producer.sh` handles this automatically.

PRD and progress files in a worker's local `.ralph/` directory (inside the code repo worktree) are gitignored and must NEVER be committed to the code repo. Workers commit code changes only — never ralph's state files.

---

## Checklist Before Publishing

### Structure
- [ ] **No cross-PRD dependencies in the publish batch** — if PRD-B depends on PRD-A landing first, only publish PRD-A now; leave PRD-B as `~draft`
- [ ] **Target project identified** — determined whether this is root monorepo, docs, or a plugin
- [ ] PRD is in the queue repo root (e.g., `~/workspace/src/opentabs-prds/`)
- [ ] **`workingDirectory` set** if targeting a standalone subproject (omitted for root monorepo)
- [ ] **`qualityChecks` set** if targeting a standalone subproject (omitted for root monorepo)
- [ ] **`qualityChecks` matches the subproject's actual available scripts** (verified by reading its `package.json`)

### Stories
- [ ] Each story completable in one iteration (1-3 files)
- [ ] Stories ordered by dependency (no story depends on a later story)
- [ ] `description` uses direct statements, not "As a [user]" template
- [ ] `passes` field is boolean `false` for every story
- [ ] `model` field is set on every story — `"opus"` by default, `"sonnet"` only for purely mechanical tasks
- [ ] `e2eCheckpoint` field is set on every story (`false` for standalone subprojects)
- [ ] **For root monorepo PRDs that touch browser behavior: the final story has `e2eCheckpoint: true`**
- [ ] **For root monorepo PRDs with no browser-observable changes: all stories can be `e2eCheckpoint: false`**

### Acceptance Criteria
- [ ] Every criterion is behavioral and verifiable (not "works correctly")
- [ ] No build/lint/test commands in criteria (enforced automatically by qualityChecks)

### Notes Quality (the highest-leverage check)
- [ ] **Code was read before writing notes** — actual function names, actual code snippets, not guesses
- [ ] **Every note has a `Files:` section** listing every file the worker must modify
- [ ] **Quoted current code** in notes — not "around line 221" but the actual content
- [ ] **Explicit negative constraints** — what must NOT change
- [ ] **Trap warnings** for non-obvious gotchas and wrong approaches
- [ ] All file paths are repo-root-relative

### Publish
- [ ] JSON is valid
- [ ] File written with `~draft` suffix and NO timestamp in filename
- [ ] Published via `producer.sh` (handles timestamp, commit, and push atomically)
