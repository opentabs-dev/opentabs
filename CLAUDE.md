# Project Instructions for Claude

## Project Overview

**OpenTabs Platform** is a Chrome extension + MCP server with a plugin-based architecture. A plugin SDK allows anyone to create OpenTabs plugins as standalone npm packages. The MCP server discovers plugins at runtime, and the Chrome extension dynamically injects plugin adapters into matching tabs — giving AI agents access to web applications through the user's authenticated browser session.

### Architecture

```
┌─────────────┐  Streamable HTTP  ┌─────────────┐  WebSocket  ┌──────────────────┐
│ Claude Code │ ←───────────────→ │ MCP Server  │ ←─────────→ │ Chrome Extension │
│             │  /mcp             │ (localhost) │             │   (Background)   │
└─────────────┘                   └──────┬──────┘             └────────┬─────────┘
                                         │                             │
                                  ┌──────▼──────┐            ┌────────▼─────────┐
                                  │   Plugin    │            │  Adapter IIFEs   │
                                  │  Discovery  │            │  (per plugin,    │
                                  │ (npm + local│            │   injected into  │
                                  │  paths)     │            │   matching tabs) │
                                  └─────────────┘            └────────┬─────────┘
                                                                      │ Same-origin
                                                             ┌────────▼─────────┐
                                                             │   Web APIs       │
                                                             │ (user's session) │
                                                             └──────────────────┘
```

**MCP Server** (`platform/mcp-server`): Plugin discovery, tool/resource/prompt dispatch via WebSocket, browser tools, audit log. See `platform/mcp-server/CLAUDE.md` for details.

**Chrome Extension** (`platform/browser-extension`): Adapter injection, tool dispatch relay, React side panel UI. Published to npm as `@opentabs-dev/browser-extension` and bundled as a CLI dependency so `opentabs start` can auto-install it. See `platform/browser-extension/CLAUDE.md` for details.

**Plugin SDK** (`platform/plugin-sdk`): `OpenTabsPlugin` base class, `defineTool`/`defineResource`/`definePrompt` factories, SDK utilities, structured errors. See `platform/plugin-sdk/CLAUDE.md` for details.

**Plugin Tools** (`platform/plugin-tools`): Plugin developer CLI (`opentabs-plugin build`). See `platform/plugin-tools/CLAUDE.md` for details.

**CLI** (`platform/cli`): User-facing CLI (`opentabs`). See `platform/cli/CLAUDE.md` for details.

**create-plugin** (`platform/create-plugin`): Scaffolding CLI (`create-opentabs-plugin`) for new plugin projects.

### Tech Stack

- **Language**: TypeScript (strict, ES Modules)
- **Runtime**: Node.js 22+
- **Build**: `tsc --build` (composite project references)
- **Testing**: Vitest (unit), Playwright (E2E)
- **UI**: React 19, Tailwind CSS 4 (side panel only)
- **Chrome Extension**: Manifest V3

### Directory Structure

```
opentabs/
├── platform/                      # Core platform packages (npm workspaces)
│   ├── mcp-server/                # MCP server — plugin discovery, tool dispatch
│   ├── browser-extension/         # Chrome extension (MV3)
│   ├── plugin-sdk/                # Plugin authoring SDK
│   ├── plugin-tools/              # Plugin developer CLI (opentabs-plugin)
│   ├── cli/                       # User-facing CLI (opentabs)
│   └── create-plugin/             # Plugin scaffolding CLI
├── plugins/                       # Example plugins (fully standalone, NOT in npm workspaces)
├── e2e/                           # Playwright E2E tests
├── docs/                          # Documentation site (Next.js)
└── .ralph/                        # Parallel task daemon
```

Each subdirectory has its own `CLAUDE.md` with package-specific details.

### Key Concepts

**Tool and prompt name prefixing**: Plugin tools and prompts are exposed to MCP clients with a `<plugin>_<name>` prefix (e.g., `slack_send_message`). This prevents name collisions across plugins.

**Resource URI prefixing**: Plugin resource URIs are prefixed with `opentabs+<plugin>://` to make them globally unique across plugins.

**Tab state machine**: Each plugin has three tab states: `closed`, `unavailable`, and `ready`. The extension reports state changes to the MCP server.

**Authentication and secrets**: The WebSocket secret is stored in `~/.opentabs/extension/auth.json` as `{ "secret": "<hex>" }`. This is the single source of truth — `config.json` does not store the secret.

**Plugin discovery**: npm auto-discovery + local plugins from `~/.opentabs/config.json`. Four-phase pipeline: resolve → load → determine trust tier → build immutable registry. See `platform/mcp-server/CLAUDE.md` for details.

**Lifecycle hooks**: `onActivate`, `onDeactivate`, `onNavigate`, `onToolInvocationStart`, `onToolInvocationEnd`. See `platform/plugin-sdk/CLAUDE.md` for details.

**Progress reporting**: Tools report progress via `ToolHandlerContext.reportProgress()`. See `platform/mcp-server/CLAUDE.md` for the full dispatch pipeline.

### Commands

```bash
# Build
npm run build           # Build all packages (incremental tsc --build + extension bundle + icons)
npm run build:force     # Full clean rebuild (tsc --build --force + extension bundle + icons)
npm run build:plugins   # Build all plugins (install + build each)
npm run build:docs      # Build docs site (next build)

# Dev
npm run dev             # Full dev mode (tsc watch + MCP server + extension, colored output with startup banner)
npm run dev:mcp         # MCP server only with hot reload (lightweight alternative to full dev)
npm run dev:docs        # Docs dev server (next dev)

# Quality checks
npm run check           # Root checks: build + lint + format:check + knip + test
npm run check:everything # Everything: root checks + E2E + docs + plugins
npm run check:docs      # Docs checks (delegates to docs/package.json check script)
npm run check:plugins   # Plugin checks: type-check + lint + format:check (all plugins)
npm run type-check      # TypeScript check (tsc --build, incremental verification)
npm run lint            # ESLint check
npm run lint:fix        # ESLint auto-fix
npm run format          # Prettier format
npm run format:check    # Prettier check
npm run knip            # Unused code detection

# Docs (from root)
npm run lint:docs       # ESLint docs
npm run type-check:docs # TypeScript check docs

# Test
npm run test            # Unit tests (Vitest)
npm run test:e2e        # E2E tests (Playwright)

# Clean
npm run clean           # Remove build artifacts (dist/, tsbuildinfo, generated icons)
npm run clean:all       # clean + remove node_modules across all workspaces and plugins

# UI
npm run storybook       # Launch Storybook dev server (browser extension components)

# Setup
npm install             # Install dependencies
```

The `npm run` commands above are for **platform contributors** working in the monorepo. Normal users interact via the `opentabs` CLI, and plugin developers use `npm run build` / `npx create-opentabs-plugin`.

### Loading the Extension

1. `npm run build`
2. Open `chrome://extensions/`
3. Enable Developer mode
4. Load unpacked → select `~/.opentabs/extension` folder

### Reloading the Extension After Code Changes

The Chrome extension does NOT auto-reload. After building (`npm run build`), the extension must be manually reloaded:

1. `npm run build`
2. Open `chrome://extensions/`
3. Click the refresh icon on the "OpenTabs" card
4. Close and reopen the side panel if it was open

Plugin adapter changes are picked up via `POST /reload` (triggered by `opentabs-plugin build`) without extension reload.

### Starting the MCP Server

**Production mode** (default):

```bash
opentabs start
```

**Dev mode** — MCP server only, with hot reload:

```bash
npm run dev:mcp
```

**Full dev mode** — tsc watch + MCP server + extension build, with colored output and startup banner:

```bash
npm run dev
```

---

## Development Workflow

All development workflows below assume the MCP server is running in dev mode. Use `npm run dev` for full dev mode (tsc watch + MCP server + extension) or `npm run dev:mcp` for server-only work with hot reload. In production mode, restart the server after any changes.

### MCP Server Changes (Hot Reload)

```bash
# 1. Edit source files in platform/mcp-server/src/
# 2. Build
cd platform/mcp-server && npm run build
# 3. Done — the dev proxy detects the change and restarts the worker
```

### Chrome Extension Changes

```bash
# 1. Edit source files in platform/browser-extension/src/
# 2. Build
npm run build
# 3. Reload extension from chrome://extensions/
```

### Plugin Changes

```bash
# 1. Edit plugin source
# 2. Build the plugin
cd plugins/<name> && npm run build
# 3. Done — build notifies the server via POST /reload
```

---

## Code Quality Rules

### Core Principles

You are the best frontend React engineer, the best UI/UX designer, and the best software architect. Hold yourself to the highest standard — no lazy work, no half-measures, no excuses. Every line of code you write should reflect that standard.

**Honesty over agreement. Always.** Never default to agreeing with the user. If the user's approach, assumption, or design is wrong, say so directly and explain why. Do not compliment ideas that are mediocre. Do not validate decisions that are incorrect. Provide the honest, technically accurate answer — even when it contradicts what the user believes or wants to hear. Correct mistakes clearly and respectfully. The only exception is when the user explicitly insists on their approach after being informed of the tradeoffs.

**Correctness over speed. Always.** Never be lazy. Never take the easy path when the correct path exists. Always use the correct method and best practice, even if it takes more time. Doing the right thing and keeping code clean is the highest priority — never compromise on this.

- **Think deeply before proposing solutions** - when facing a design problem, do not jump to the first working approach. Step back, understand the full architecture, identify all constraints (CSP, runtime context, injection model, etc.), and reason from first principles to find the _correct_ solution. A quick fix that works is not the same as the right design. If the platform already solves an analogous problem (e.g., file-based injection bypasses CSP), the new solution should use the same proven pattern — not invent a weaker workaround. Propose one well-thought-out design, not a sequence of increasingly less-bad ideas.
- **Never cut corners** - if the correct approach requires more code, more refactoring, or more time, that is the right approach. Shortcuts create debt that compounds.
- **Always use the right abstraction** - do not inline logic that belongs in a helper, do not duplicate code that should be shared, do not stuff unrelated concerns into the same function. Use the correct pattern for the problem.
- **Do the full job** - when fixing something, fix it completely. Update all call sites. Update all tests. Update all types. Update all documentation. Do not leave partial work.
- **Read before writing** - before changing any code, read and understand the surrounding context, existing patterns, and conventions. Match them. Do not introduce a new pattern when an established one exists.
- **Check git history before reverting or "fixing" recent changes** - when something is broken, always run `git log` to understand _why_ the current code looks the way it does. If a recent commit introduced a change (e.g., renaming, restructuring, new convention), assume the change was intentional and fix the downstream code to match — do not revert the change. Reverting intentional work is destructive and lazy. The correct response to "tests broke after a rename" is to update the tests, not to undo the rename.
- **Think before acting** - step back and consider the broader design before making changes. Ask: "Is this the right place for this code? Is this the right level of abstraction? Will this be clear to the next person reading it?"
- **Decide component boundaries before coding** - when building UI, determine which component owns which state and which DOM elements before writing any JSX. If controls must appear on the same row, they must live in the same component's render output. Do not split a visual unit across component boundaries and then try to patch it back together with props, slots, or wrappers. If the first attempt creates a layout problem, do not patch the symptom — redesign the boundary.
- **Never iterate in circles** - if a fix introduces a new problem, stop. Do not apply another incremental patch. Instead, re-examine the root cause and identify the correct architectural solution. Two failed attempts at the same problem means the approach is wrong, not that it needs more tweaking.
- **Search for existing solutions before inventing your own** - when facing an unfamiliar problem (runtime behavior, library quirk, platform limitation), search online for similar issues before guessing at a fix. Check official documentation, GitHub issues, and community forums (Stack Overflow, etc.) for known solutions and workarounds. The correct fix is often already documented — inventing a workaround without researching first wastes time and risks introducing a worse solution than the established one.
- **No TODO/FIXME/HACK comments** - if something needs to be done, do it now. Do not leave markers for future work as an excuse to ship incomplete code.
- **Naming matters** - spend time choosing precise, descriptive names for variables, functions, types, and files. A good name eliminates the need for a comment.
- **Delete fearlessly** - if code is unused, remove it. If a file is obsolete, delete it. Dead code is noise that obscures intent.
- **Own the codebase** - if tests, lint, or build are failing when you start a session, fix them. Do not treat pre-existing failures as someone else's problem. If the codebase is broken, it is your responsibility to make it whole before moving on. You are not a guest — you are the engineer on duty.
- **Break freely, refactor fully** - this is an internal, self-contained tool with no external consumers. Never let backwards compatibility concerns hold back the correct design. If a change introduces breaking changes, refactor all affected call sites, tests, and types in the same change. There is no excuse for keeping a worse API or pattern alive just to avoid updating callers you fully control.

### Engineering Standards

- **Write modular, clean code** - never write hacky code
- **Step back before fixing** - when fixing bugs, always consider if there's a cleaner architectural solution rather than patching symptoms
- **Prefer refactoring over quick fixes** - if a fix requires hacky code, that's a signal the underlying design needs improvement
- **Component design** - keep components focused, reusable, and well-separated
- **User experience first** - every UI decision should prioritize clarity and usability
- **Clean up unused code** - always remove dead code, unused imports, outdated comments, and obsolete files; keep the codebase lean with only what is needed

### TypeScript Configuration

Every `.ts`/`.tsx` file in the repository must be covered by a tsconfig that `tsc --build` reaches. No file may exist in a type-checking blind spot.

- **Test files must be type-checked.** Each package has a `tsconfig.test.json` that includes `src/**/*.test.ts`.
- **Build scripts must be type-checked.** Standalone scripts (e.g., `build-*.ts`) that live outside `src/` have their own tsconfig.
- **Root config files must be type-checked.** Files like `eslint.config.ts`, `knip.ts`, and `playwright.config.ts` are covered by `tsconfig.configs.json`.
- **Never exclude files from type-checking to avoid fixing type errors.** If a file has type errors, fix the errors.
- **When adding a new `.ts` file**, verify it is covered by an existing tsconfig.

### Verification

Once a task is complete, **always run every one of these checks** to verify the change:

```bash
npm run build         # Verify production build
npm run type-check    # TypeScript check (must pass from clean checkout)
npm run lint          # Check for lint errors
npm run knip          # Check for unused code
npm run test          # Unit tests
npm run test:e2e      # E2E tests (Playwright)
```

**Every command must exit 0.** A task is not done until all six pass. No exceptions.

For full repository verification including docs and plugins, use `npm run check:everything`.

- If a check fails, **fix it** — even if the failure looks pre-existing or unrelated to your change. You own the codebase.
- Do not rationalize failures ("that's a known issue", "the build is the real type-check", "this was broken before I started"). If it fails, it is your problem. Fix it or explain to the user why you cannot.
- Do not skip a check because a different check covers "the same thing". Each command tests something distinct. Run all of them.

### ESLint

- **NEVER use `eslint-disable` comments** in source code. Always fix the underlying issue.
- **NEVER add file-specific rule overrides in eslint.config.ts** to suppress lint errors. Always fix the source code instead.
- If a rule violation occurs, investigate and fix the root cause.
- If a dependency uses deprecated APIs, update the code to use the recommended alternative.

### Code Style

- Follow all configured ESLint rules.

### Runtime Compatibility

All packages run on **Node.js 22+**. The monorepo uses **npm** workspaces for dependency management and **npm** for registry authentication and publishing.

**Production code** (`platform/*/src/`): Uses Node.js APIs directly (`node:fs/promises`, `node:child_process`, `node:crypto`, `process.env`, `process.argv`).

**Build scripts** (`build-*.ts`, `scripts/`): Use esbuild for bundling. Invoked via `npm run` or `npx tsx`. These are contributor-only and do not need to run in production.

**Tests** (`*.test.ts`): Use Vitest. Contributor-only — normal users and plugin developers do not run platform tests.

**E2E tests** (`e2e/`) run under Playwright's Node.js test runner.

### Comments

Comments should describe **current behavior**, not historical context. Write comments that state facts about what the code does now.

**Avoid:**

- Comments explaining what code "used to do" or "was changed from"
- Negative phrasing like "we don't do X" or "don't touch Y"
- Historical markers like "previously", "legacy", "deprecated", "removed"
- Comments that only make sense if you know what the code looked like before

**Prefer:**

- Factual descriptions of current behavior
- Explanations of why current code works the way it does
- Technical rationale for design decisions

---

## Keeping CLAUDE.md Up to Date

**Important**: This file should remain **plugin-agnostic**. Do not enumerate individual plugins or tools by name. The codebase grows by adding new plugins — documentation should describe patterns and conventions, not inventories.

Guidelines for updates:

- Keep additions **high-level** — avoid excessive detail that wastes context
- Focus on **architecture, patterns, and conventions** — not per-plugin details
- **Never list individual plugins** (e.g. "Slack, Datadog, ...") — use generic terms like "plugins" and reference the code structure for discovery
- Remove outdated information that no longer applies
- **Package-specific details belong in that package's CLAUDE.md** — not here
