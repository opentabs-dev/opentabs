---
name: prd
description: "Generate a Product Requirements Document (PRD) for a new feature. Use when planning a feature, starting a new project, or when asked to create a PRD. Triggers on: create a prd, write prd for, plan this feature, requirements for, spec out."
user-invocable: true
---

# PRD Generator

Create detailed Product Requirements Documents that are clear, actionable, and suitable for implementation by autonomous AI agents (Ralph) or human developers.

---

## The Job

1. Receive a feature description from the user
2. Ask 3-5 essential clarifying questions (with lettered options)
3. Generate a structured PRD based on answers
4. Save to `tasks/prd-[feature-name].md`

**Important:** Do NOT start implementing. Just create the PRD.

---

## Step 1: Clarifying Questions

Ask only critical questions where the initial prompt is ambiguous. Focus on:

- **Problem/Goal:** What problem does this solve?
- **Core Functionality:** What are the key actions?
- **Scope/Boundaries:** What should it NOT do?
- **Success Criteria:** How do we know it's done?

### Format Questions Like This:

```
1. What is the primary goal of this feature?
   A. Improve user onboarding experience
   B. Increase user retention
   C. Reduce support burden
   D. Other: [please specify]

2. Who is the target user?
   A. New users only
   B. Existing users only
   C. All users
   D. Admin users only

3. What is the scope?
   A. Minimal viable version
   B. Full-featured implementation
   C. Just the backend/API
   D. Just the UI
```

This lets users respond with "1A, 2C, 3B" for quick iteration. Remember to indent the options.

---

## Step 2: PRD Structure

Generate the PRD with these sections:

### 1. Introduction/Overview
Brief description of the feature and the problem it solves.

### 2. Goals
Specific, measurable objectives (bullet list).

### 3. User Stories
Each story needs:
- **Title:** Short descriptive name
- **Description:** "As a [user], I want [feature] so that [benefit]"
- **Acceptance Criteria:** Verifiable checklist of what "done" means

Each story should be small enough to implement in one focused session (one Ralph iteration / one context window).

**Format:**
```markdown
### US-001: [Title]
**Description:** As a [user], I want [feature] so that [benefit].

**Acceptance Criteria:**
- [ ] Specific verifiable criterion
- [ ] Another criterion
- [ ] Typecheck passes (`bun run type-check`)
- [ ] **[UI stories only]** Verify in browser
```

**Important:**
- Acceptance criteria must be verifiable, not vague. "Works correctly" is bad. "Button shows confirmation dialog before deleting" is good.
- **For any story with UI changes:** Always include "Verify in browser" as acceptance criteria. This ensures visual verification of frontend work.

### 4. Functional Requirements
Numbered list of specific functionalities:
- "FR-1: The system must allow users to..."
- "FR-2: When a user clicks X, the system must..."

Be explicit and unambiguous.

### 5. Non-Goals (Out of Scope)
What this feature will NOT include. Critical for managing scope.

### 6. Design Considerations (Optional)
- UI/UX requirements
- Link to mockups if available
- Relevant existing components to reuse

### 7. Technical Considerations (Optional)
- Known constraints or dependencies
- Integration points with existing systems
- Performance requirements

### 8. Success Metrics
How will success be measured?
- "Reduce time to complete X by 50%"
- "Increase conversion rate by 10%"

### 9. Open Questions
Remaining questions or areas needing clarification.

---

## Writing for Autonomous Agents

The PRD reader may be an autonomous AI agent (Ralph) with no memory of previous iterations. Therefore:

- Be explicit and unambiguous
- Avoid jargon or explain it
- Provide enough detail to understand purpose and core logic
- Number requirements for easy reference
- Use concrete examples where helpful
- Reference specific file paths or modules when known
- Each user story must be completable independently in a single context window

---

## Project-Specific Context

This PRD skill is configured for the **OpenTabs Next** project (`__next__/` directory):

- **Language**: TypeScript (strict, ES Modules)
- **Runtime**: Bun
- **Build**: `bun run build` (tsc --build)
- **Type check**: `bun run type-check` (tsc --noEmit)
- **Structure**: `platform/*` (core packages) and `plugins/*` (service plugins)
- **Quality checks to include in acceptance criteria**: `bun run build && bun run type-check`

---

## Output

- **Format:** Markdown (`.md`)
- **Location:** `tasks/`
- **Filename:** `prd-[feature-name].md` (kebab-case)

---

## Example PRD

```markdown
# PRD: Plugin Lifecycle Hooks

## Introduction

Add lifecycle hooks to the plugin SDK so plugins can run setup/teardown logic when they are loaded or unloaded. This enables plugins to initialize resources (e.g., WebSocket connections, caches) on load and clean them up on unload.

## Goals

- Provide `onLoad` and `onUnload` hooks in the plugin SDK
- Ensure hooks are called reliably during plugin lifecycle transitions
- Keep the API minimal and easy to implement for plugin authors

## User Stories

### US-001: Define lifecycle hook types in plugin-sdk
**Description:** As a plugin author, I need TypeScript types for lifecycle hooks so I can implement them with type safety.

**Acceptance Criteria:**
- [ ] `OnLoadHook` and `OnUnloadHook` types exported from plugin-sdk
- [ ] Types are documented with JSDoc comments
- [ ] Typecheck passes (`bun run type-check`)

### US-002: Implement hook invocation in plugin-loader
**Description:** As the platform, I need the plugin-loader to call lifecycle hooks at the right time.

**Acceptance Criteria:**
- [ ] `onLoad` called after plugin is registered and before tools are available
- [ ] `onUnload` called before plugin is removed
- [ ] Errors in hooks are caught and logged without crashing the loader
- [ ] Typecheck passes (`bun run type-check`)

### US-003: Add lifecycle hooks to example Slack plugin
**Description:** As a plugin author, I want a reference implementation showing how to use lifecycle hooks.

**Acceptance Criteria:**
- [ ] Slack plugin implements `onLoad` that logs initialization
- [ ] Slack plugin implements `onUnload` that logs cleanup
- [ ] Build succeeds (`bun run build`)
- [ ] Typecheck passes (`bun run type-check`)

## Functional Requirements

- FR-1: Plugin SDK must export `OnLoadHook` and `OnUnloadHook` type definitions
- FR-2: Plugin-loader must invoke `onLoad` after successful plugin registration
- FR-3: Plugin-loader must invoke `onUnload` before plugin removal
- FR-4: Hook errors must be caught, logged, and must not prevent other plugins from loading

## Non-Goals

- No hot-reload of plugins at runtime
- No dependency injection into hooks
- No async hook chaining or ordering guarantees between plugins

## Technical Considerations

- Hooks are optional — plugins without hooks should work unchanged
- Hook functions may be async (return Promise)
- Plugin-loader already has the registration lifecycle; hooks attach to existing flow

## Success Metrics

- Plugin authors can add setup/teardown logic with zero boilerplate
- No regression in plugin load time

## Open Questions

- Should hooks receive a context object with logger/config access?
```

---

## Checklist

Before saving the PRD:

- [ ] Asked clarifying questions with lettered options
- [ ] Incorporated user's answers
- [ ] User stories are small and specific (completable in one context window)
- [ ] Acceptance criteria include `bun run type-check` / `bun run build`
- [ ] UI stories include browser verification criterion
- [ ] Functional requirements are numbered and unambiguous
- [ ] Non-goals section defines clear boundaries
- [ ] Saved to `tasks/prd-[feature-name].md`
