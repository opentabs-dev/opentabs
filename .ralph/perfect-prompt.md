# Perfect Audit — Shared Guidelines

This section applies to ALL perfect audit scripts. Read it carefully before starting your audit.

## Mindset

You are performing a one-time, final audit. Assume this is the **last chance** to find and fix every genuine issue in the code you are reviewing. Be thorough — read every function, every error path, every cleanup handler. Do not skim. Do not stop early because you found a few issues. Exhaust the search space.

At the same time, be **ruthlessly honest** about what constitutes an issue. Every issue you report will be implemented by an autonomous agent — if you report a non-issue, that agent will make an unnecessary change to working code, potentially introducing a real bug. False positives have a real cost. But so do missed bugs — they ship to users.

## Audit Method

Use a two-phase collect-then-filter approach. This prevents context loss (findings from early files forgotten after reading 20+ files) and prevents premature self-filtering (discarding borderline findings before seeing the full picture).

### Phase 1 — Collect

As you read each file, **immediately record every potential finding** using TaskCreate. Include the file path, a one-line description, and the suspected consequence. Do NOT evaluate whether it passes the Validation Checklist yet. Do NOT discard anything during this phase. Capture everything that looks like it might be an issue — you will filter later.

### Phase 2 — Filter

After you have finished reading **ALL files** in scope, review your complete todo list. For each finding, apply the Validation Checklist below. Discard findings that fail any of the four checks. The findings that survive become your PRD stories.

### Phase 3 — Create PRDs

Create PRDs from the surviving findings, following the PRD Creation Rules below.

## What Is an Issue

An issue is a concrete, demonstrable problem in the current code that has an **observable consequence**. Observable consequences include:

- **Runtime crash or exception** — unhandled error, null dereference, type mismatch at runtime
- **Data loss or corruption** — silent data drop, partial write, truncated output, incorrect calculation
- **Resource leak** — unbounded map/set/array growth, uncleaned timer/interval, unreleased listener, orphaned connection
- **Security vulnerability** — missing input validation, leaked secrets in errors, permission bypass
- **Race condition** — concurrent operations producing incorrect state, lost updates, stale closures
- **Silent wrong behavior** — function returns incorrect result without error, condition is always true/false
- **Missing cleanup on equivalent path** — cleanup runs on success but not on error (or vice versa)
- **Dead or unreachable code** — exports never imported, branches that can never execute, code after unconditional return
- **Unhelpful error that causes user confusion** — error message that doesn't tell the user what went wrong or how to fix it

Every issue you report must name one of these consequences specifically. "This could be improved" is not a consequence.

## What Is NOT an Issue

Do **not** report any of the following:

- **Style preferences** — you would write it differently, but the current code is correct and clear. Two valid approaches to the same problem do not make one of them a bug.
- **Equivalent alternatives** — using `for...of` vs `.forEach()`, `const` vs `let` when mutation doesn't occur, `===` vs `!==` with inverted logic, early return vs else block. If both forms are correct, neither is an issue.
- **Naming preferences** — the current name is descriptive and unambiguous, you just prefer a different word.
- **Module organization preferences** — moving code between files or reordering functions without fixing a concrete problem.
- **Cosmetic comment rewording** — rephrasing comments that accurately describe the current behavior.
- **Theoretical issues with no reachable execution path** — if no sequence of events can trigger it, it is not an issue.
- **Issues already handled by existing code** — always read the full function, the caller, and the surrounding module before reporting. If a guard, catch, cleanup, fallback, or retry already addresses the concern, it is not an issue.
- **Features you would add** — missing functionality is not a bug unless existing code promises it (via types, docs, or naming) and fails to deliver.

**The bright-line test:** Before reporting anything, ask: _"Is the current code incorrect, or would I just write it differently?"_ If the answer is "I'd write it differently," discard it. If the answer is "the current code has a concrete failure mode," report it.

## Validation Checklist (Apply to Every Finding)

For each candidate issue, verify ALL of the following before including it:

1. **Concrete consequence.** Can you name the specific observable harm from the list above? Write it down. If you cannot name it, discard the finding.
2. **Not a style preference.** Is the existing code functionally incorrect or hazardous — not just a different-but-equivalent approach? If it uses a recognized pattern and works correctly, discard the finding.
3. **Not already handled.** Have you read the full function and its callers to check for existing guards, catches, cleanup, or fallback logic that addresses this concern? If it is already handled, discard the finding.
4. **Reproducible trigger.** Does there exist a sequence of events (even if unlikely) that triggers the issue? If no path leads to the problem, discard the finding.

**Discard any finding that fails any of these four checks.** A comprehensive audit that reports 10 genuine issues alongside 1-2 borderline ones is far more valuable than an audit that only reports the 2 most obvious. The autonomous agent receiving these findings can cheaply discard a false positive — but a missed bug ships to users.

## Severity and Completeness

Report issues at **all severity levels** — critical bugs, minor edge cases, and everything in between. A minor issue (e.g., an error message that shows a raw exception instead of a user-friendly message) is still worth fixing if it has a concrete consequence. Do not filter by severity. Do filter by genuineness.

If after exhaustive review you find **zero genuine issues**, that is a valid outcome. Do not manufacture issues to fill a quota. But zero findings from a large, complex codebase should surprise you — double-check that you haven't been filtering too aggressively during Phase 2. Re-scan your discarded findings once more before concluding.

## Fix Quality — No Future Regressions

Every issue you report will be fixed by an autonomous agent. The fix must not introduce new problems. When writing story notes:

- **Describe the root cause**, not just the symptom. The agent needs to understand _why_ the current code is wrong to avoid writing a fix that breaks something else.
- **Identify related code paths.** If the same pattern exists in multiple places, mention all of them so the agent fixes them all at once.
- **Call out invariants.** If fixing this issue requires preserving a specific behavior or contract, state it explicitly. Example: "The cleanup must run in the finally block, but the return value from the try block must still be propagated."
- **Warn about traps.** If there is an obvious wrong fix that would seem correct but would break something, say so. Example: "Do NOT move this to an async callback — it must execute synchronously before the response is sent."

## PRD Creation Rules

After completing your audit, use the skill tool to load the "ralph" skill, then follow its instructions to create PRD(s).

These rules apply to all PRDs regardless of target project:

- **Small stories only** — 1-3 files per story. If a fix touches more than 3 files, split it.
- **Repo-root-relative file paths** in the notes field, with line numbers where helpful.
- **Concrete, verifiable acceptance criteria** — each criterion must be something the agent can CHECK, not something vague like "works correctly."
- **Skip clarifying questions** — these prompts provide all context needed.
- **Set `passes: false`** on every story (boolean, not null).
- **Set `model`** on every story — `"sonnet"` for straightforward fixes with clear instructions, `"opus"` for complex changes requiring cross-cutting reasoning.
- **Minimize merge conflicts** — stories touching the same files must be in the same PRD. Split PRDs by module boundary so workers can run in parallel.

## Cross-Script Scope Boundaries

Multiple perfect scripts audit different parts of the codebase. Stay in your lane:

- **Documentation accuracy** (static comparison of docs text vs source code) is exclusively audited by `perfect-docs.sh`. Other scripts must NOT create stories for stale docs text they notice while reading source code. The exception: CLI experiential scripts (user, plugin-developer, platform-contributor) MAY create docs PRDs for issues discovered through **execution** — "I followed the docs and it failed."
- **SDK source bugs** (platform/plugin-sdk/src/) are exclusively audited by `perfect-sdk.sh`. If you find an SDK issue while auditing plugins or extension code, note it for context but do not create a story targeting SDK source files.
- **E2E test code quality** (flaky patterns, wrong assertions, missing coverage in e2e/\*.e2e.ts) is exclusively audited by `perfect-e2e.sh`. Other scripts must not create stories for E2E test quality issues.
