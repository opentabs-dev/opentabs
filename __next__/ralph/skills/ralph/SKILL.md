---
name: ralph
description: "Convert PRDs to prd.json format for the Ralph autonomous agent system. Use when you have an existing PRD and need to convert it to Ralph's JSON format. Triggers on: convert this prd, turn this into ralph format, create prd.json from this, ralph json."
user-invocable: true
---

# Ralph PRD Converter

Converts existing PRDs to the prd.json format that Ralph uses for autonomous execution.

---

## The Job

Take a PRD (markdown file or text) and convert it to `ralph/prd.json` relative to the project root.

---

## Output Format

```json
{
  "project": "[Project Name]",
  "branchName": "ralph/[feature-name-kebab-case]",
  "description": "[Feature description from PRD title/intro]",
  "userStories": [
    {
      "id": "US-001",
      "title": "[Story title]",
      "description": "As a [user], I want [feature] so that [benefit]",
      "acceptanceCriteria": [
        "Criterion 1",
        "Criterion 2",
        "Typecheck passes"
      ],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
```

---

## Story Size: The Number One Rule

**Each story must be completable in ONE Ralph iteration (one context window).**

Ralph spawns a fresh Claude Code instance per iteration with no memory of previous work. If a story is too big, the LLM runs out of context before finishing and produces broken code.

### Right-sized stories:
- Add a TypeScript type definition and export it
- Add a new module with a single responsibility
- Update an existing handler with new logic
- Add a configuration option to an existing page

### Too big (split these):
- "Build the entire plugin system" — split into: types, loader, SDK, registration, tests
- "Add authentication" — split into: types, middleware, session handling, UI
- "Refactor the architecture" — split into one story per module or pattern

**Rule of thumb:** If you cannot describe the change in 2-3 sentences, it is too big.

---

## Story Ordering: Dependencies First

Stories execute in priority order. Earlier stories must not depend on later ones.

**Correct order:**
1. Type definitions and interfaces
2. Core logic and utilities
3. Service/controller implementations that use the core
4. MCP tool definitions that expose the service
5. UI components that configure or display

**Wrong order:**
1. UI component (depends on types that don't exist yet)
2. Type definitions

---

## Acceptance Criteria: Must Be Verifiable

Each criterion must be something Claude Code can CHECK, not something vague.

### Good criteria (verifiable):
- "Add `PluginManifest` interface with `name`, `version`, and `tools` fields"
- "Export the new type from the package barrel file"
- "Function returns an error object when input is invalid"
- "Typecheck passes"
- "Tests pass"

### Bad criteria (vague):
- "Works correctly"
- "User can do X easily"
- "Good UX"
- "Handles edge cases"

### Always include as final criterion:
```
"Typecheck passes"
```

For stories with testable logic, also include:
```
"Tests pass"
```

### For stories that change UI, also include:
```
"Verify in browser using dev-browser skill"
```

---

## Project-Specific Quality Checks

This project uses:
- `bun run build` — TypeScript project build (tsc --build)
- `bun run type-check` — TypeScript type checking (tsc --noEmit)

Every story's acceptance criteria should include "Typecheck passes" which maps to these commands.

---

## Conversion Rules

1. **Each user story becomes one JSON entry**
2. **IDs**: Sequential (US-001, US-002, etc.)
3. **Priority**: Based on dependency order, then document order
4. **All stories**: `passes: false` and empty `notes`
5. **branchName**: Derive from feature name, kebab-case, prefixed with `ralph/`
6. **Always add**: "Typecheck passes" to every story's acceptance criteria
7. **Output location**: `ralph/prd.json` relative to the project root

---

## Splitting Large PRDs

If a PRD has big features, split them:

**Original:**
> "Add plugin system"

**Split into:**
1. US-001: Define plugin manifest types and interfaces
2. US-002: Implement plugin loader module
3. US-003: Create plugin SDK with base classes
4. US-004: Register plugins in the MCP server
5. US-005: Add plugin configuration to options page
6. US-006: Add plugin validation and error handling

Each is one focused change that can be completed and verified independently.

---

## Archiving Previous Runs

**Before writing a new prd.json, check if there is an existing one from a different feature:**

1. Read the current `ralph/prd.json` if it exists
2. Check if `branchName` differs from the new feature's branch name
3. If different AND `ralph/progress.txt` has content beyond the header:
   - Create archive folder: `ralph/archive/YYYY-MM-DD-feature-name/`
   - Copy current `ralph/prd.json` and `ralph/progress.txt` to archive
   - Reset `ralph/progress.txt` with fresh header

**The ralph.sh script handles this automatically** when you run it, but if you are manually updating prd.json between runs, archive first.

---

## Checklist Before Saving

Before writing `ralph/prd.json`, verify:

- [ ] **Previous run archived** (if prd.json exists with different branchName, archive it first)
- [ ] Each story is completable in one iteration (small enough)
- [ ] Stories are ordered by dependency (types → core → services → tools → UI)
- [ ] Every story has "Typecheck passes" as criterion
- [ ] UI stories have "Verify in browser using dev-browser skill" as criterion
- [ ] Acceptance criteria are verifiable (not vague)
- [ ] No story depends on a later story