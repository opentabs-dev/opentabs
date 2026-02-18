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

**MCP Server** (`platform/mcp-server`): Discovers plugins, registers their tools as MCP tools, dispatches tool calls to the Chrome extension via WebSocket, and serves health/config endpoints.

**Chrome Extension** (`platform/browser-extension`): Receives plugin definitions from the MCP server via `sync.full`, dynamically registers content scripts for URL patterns, injects adapter IIFEs into matching tabs, and dispatches tool calls to the correct tab's adapter.

**Plugin SDK** (`platform/plugin-sdk`): Provides the `OpenTabsPlugin` base class, `defineTool` factory, and `opentabs build` CLI. Plugins extend `OpenTabsPlugin` and define tools with Zod schemas; the CLI bundles the adapter into an IIFE and generates `opentabs-plugin.json`.

**create-plugin** (`platform/create-plugin`): Scaffolding CLI (`create-opentabs-plugin`) for new plugin projects.

### Tech Stack

- **Language**: TypeScript (strict, ES Modules)
- **Runtime**: Bun (monorepo with workspaces)
- **Build**: `tsc --build` (composite project references)
- **Testing**: Playwright (E2E)
- **UI**: React 19, Tailwind CSS 4 (side panel only)
- **Chrome Extension**: Manifest V3

### Directory Structure

```
opentabs/
├── platform/                      # Core platform packages (bun workspaces)
│   ├── mcp-server/                # MCP server — plugin discovery, tool dispatch
│   │   └── src/
│   │       ├── index.ts           # Entry point (HTTP + WebSocket server, hot reload)
│   │       ├── config.ts          # ~/.opentabs/config.json management
│   │       ├── discovery.ts       # Plugin discovery (npm + local paths)
│   │       ├── extension-protocol.ts  # JSON-RPC protocol with Chrome extension
│   │       ├── mcp-setup.ts       # MCP tool registration from discovered plugins
│   │       ├── state.ts           # In-memory server state
│   │       ├── file-watcher.ts    # Watches local plugins for changes
│   │       └── version-check.ts   # npm update checks for installed plugins
│   ├── browser-extension/         # Chrome extension (MV3)
│   │   ├── src/
│   │   │   ├── background.ts      # Service worker — WebSocket, adapter injection, tool dispatch
│   │   │   ├── offscreen/         # Persistent WebSocket (MV3 workaround)
│   │   │   └── side-panel/        # React side panel UI
│   │   ├── manifest.json          # Extension manifest
│   │   └── build-side-panel.ts    # Bun.build script for side panel
│   ├── plugin-sdk/                # Plugin authoring SDK
│   │   └── src/
│   │       ├── index.ts           # OpenTabsPlugin, defineTool exports
│   │       └── cli.ts             # `opentabs build` CLI
│   └── create-plugin/             # Plugin scaffolding CLI
│       └── src/
│           └── index.ts           # `create-opentabs-plugin` CLI
├── plugins/                       # Example plugins (fully standalone, NOT in bun workspaces)
│   ├── slack/                     # Slack plugin
│   │   ├── src/
│   │   │   ├── index.ts           # Plugin class extending OpenTabsPlugin
│   │   │   └── tools/             # One file per tool
│   │   └── opentabs-plugin.json   # Generated manifest
│   └── e2e-test/                  # Test plugin for E2E tests
├── e2e/                           # Playwright E2E tests
│   ├── fixtures.ts                # Test fixtures (MCP server, extension, test server)
│   ├── tool-dispatch.e2e.ts       # Full-stack tool dispatch tests
│   ├── lifecycle.e2e.ts           # Hot reload and reconnection tests
│   └── test-server.ts             # Controllable test web server
├── eslint.config.ts               # ESLint flat config
├── knip.ts                        # Knip unused code detection config
├── playwright.config.ts           # Playwright config
└── tsconfig.json                  # Root tsconfig with project references
```

### Key Concepts

**Plugin discovery**: The MCP server reads `~/.opentabs/config.json` for local plugin paths and scans `node_modules` for packages matching `opentabs-plugin-*` or with the `opentabs-plugin` keyword. Each plugin must have an `opentabs-plugin.json` manifest and a `dist/adapter.iife.js` bundle.

**Tool prefixing**: Plugin tools are exposed to MCP clients with a `<plugin>_<tool>` prefix (e.g., `slack_send_message`). This prevents name collisions across plugins.

**Tab state machine**: Each plugin has three tab states: `closed` (no matching tab), `unavailable` (tab exists but `isReady()` returns false), and `ready` (tab exists and authenticated). The extension reports state changes to the MCP server.

**Hot reload**: The MCP server runs under `bun --hot`. On file changes, Bun re-evaluates the module while preserving `globalThis`. The server uses a `globalThis`-based cleanup pattern to tear down the previous instance (close WebSocket, stop file watchers, free the port) and reinitialize cleanly.

### Commands

```bash
bun install           # Install dependencies
bun run build         # Build all packages (tsc --build + side panel)
bun run type-check    # TypeScript check (tsc --noEmit)
bun run lint          # ESLint check
bun run lint:fix      # ESLint auto-fix
bun run format        # Prettier format
bun run format:check  # Prettier check
bun run knip          # Unused code detection
bun run test:e2e      # E2E tests (Playwright)
```

### Loading the Extension

1. `bun run build`
2. Open `chrome://extensions/`
3. Enable Developer mode
4. Load unpacked → select `platform/browser-extension` folder

### Reloading the Extension After Code Changes

The Chrome extension does NOT auto-reload. After building (`bun run build`), the extension must be manually reloaded for changes to take effect:

1. `bun run build` (builds TypeScript + side panel)
2. Open `chrome://extensions/`
3. Find the "OpenTabs" extension card
4. Click the circular refresh/reload icon on the card
5. Close and reopen the side panel if it was open (it reconnects automatically via the offscreen document's WebSocket)

**Important**: The MCP server supports hot reload (`bun --hot`) so server-side changes take effect automatically after `bun run build`. But browser extension changes (background script, side panel, adapter injection logic) always require the manual reload step above. Plugin adapter changes are picked up via the file watcher — no extension reload needed for plugin-only changes.

### Starting the MCP Server

```bash
bun --hot platform/mcp-server/dist/index.js
```

### Adding a New Plugin

Each plugin follows the same pattern:

1. **Create the plugin** (`plugins/<name>/`): Extend `OpenTabsPlugin` from `@opentabs-dev/plugin-sdk`
2. **Define tools** (`plugins/<name>/src/tools/`): One file per tool using `defineTool()` with Zod schemas
3. **Build**: `cd plugins/<name> && bun install && bun run build` (runs `tsc` then `opentabs build`)
4. **Register**: Add the plugin path to `~/.opentabs/config.json` plugins array

### Plugin Isolation

Plugins in `plugins/` are **fully standalone projects** — exactly as if created by an external developer using `create-opentabs-plugin`. They:

- Have their own `package.json`, `tsconfig.json`, `.prettierrc`, and `.gitignore`
- Depend on published `@opentabs-dev/*` npm packages (not `file:` or `workspace:` links)
- Have their own `node_modules/` and `bun.lock`
- Are **excluded** from root `eslint`, `prettier`, `knip`, and `tsc --build`
- Must build and type-check independently: `cd plugins/<name> && bun run build`

The root tooling (`bun run build`, `bun run lint`, etc.) does NOT cover plugins. When changing platform packages that plugins depend on (`shared`, `plugin-sdk`, `cli`), publish new versions to npm and update plugin dependencies.

### Publishing Platform Packages

The platform packages `@opentabs-dev/shared`, `@opentabs-dev/plugin-sdk`, and `@opentabs-dev/cli` are published as private packages to the npm registry under the `@opentabs-dev` org.

**Authentication**: npm requires two separate tokens:

- **Session token** (`~/.npmrc`): Created by `npm login --scope=@opentabs-dev`. Used for reading/installing private packages. Expires after 2 hours.
- **Granular token** (`~/.npmrc.publish`): Created at npmjs.com/settings/tokens/create with Read+Write + Bypass 2FA. Used for publishing without OTP prompts.

**Setup (one-time)**:

```bash
# 1. Create session token for reading
npm login --scope=@opentabs-dev

# 2. Create publish token file with your granular access token
echo '//registry.npmjs.org/:_authToken=<GRANULAR_TOKEN>' > ~/.npmrc.publish
chmod 600 ~/.npmrc.publish
```

**Publishing** (uses `scripts/publish.sh` which handles token switching automatically):

```bash
./scripts/publish.sh 0.0.3
# Then update plugin deps and rebuild:
# cd plugins/<name> && bun install && bun run build
```

---

## Development Workflow

### MCP Server Changes (Hot Reload)

The MCP server runs as `bun --hot dist/index.js`. When compiled files change, Bun re-evaluates all modules while keeping the process alive. The extension reconnects automatically.

```bash
# 1. Edit source files in platform/mcp-server/src/
# 2. Build
cd platform/mcp-server && bun run build
# 3. Done — bun --hot detects the change and reinitializes
```

### Chrome Extension Changes

Extension changes require building and manually reloading from `chrome://extensions/`.

```bash
# 1. Edit source files in platform/browser-extension/src/
# 2. Build
bun run build
# 3. Reload extension from chrome://extensions/
```

### Plugin Changes (File Watcher)

The MCP server watches local plugin directories for changes to `opentabs-plugin.json` and `dist/adapter.iife.js`. On change, it re-reads the files and sends a `plugin.update` notification to the extension.

```bash
# 1. Edit plugin source
# 2. Build the plugin
cd plugins/slack && bun run build
# 3. Done — file watcher detects changes automatically
```

---

## Code Quality Rules

### Core Principles

You are the best frontend React engineer, the best UI/UX designer, and the best software architect. Hold yourself to the highest standard — no lazy work, no half-measures, no excuses. Every line of code you write should reflect that standard.

**Correctness over speed. Always.** Never be lazy. Never take the easy path when the correct path exists. Always use the correct method and best practice, even if it takes more time. Doing the right thing and keeping code clean is the highest priority — never compromise on this.

- **Think deeply before proposing solutions** - when facing a design problem, do not jump to the first working approach. Step back, understand the full architecture, identify all constraints (CSP, runtime context, injection model, etc.), and reason from first principles to find the _correct_ solution. A quick fix that works is not the same as the right design. If the platform already solves an analogous problem (e.g., file-based injection bypasses CSP), the new solution should use the same proven pattern — not invent a weaker workaround. Propose one well-thought-out design, not a sequence of increasingly less-bad ideas.
- **Never cut corners** - if the correct approach requires more code, more refactoring, or more time, that is the right approach. Shortcuts create debt that compounds.
- **Always use the right abstraction** - do not inline logic that belongs in a helper, do not duplicate code that should be shared, do not stuff unrelated concerns into the same function. Use the correct pattern for the problem.
- **Do the full job** - when fixing something, fix it completely. Update all call sites. Update all tests. Update all types. Update all documentation. Do not leave partial work.
- **Read before writing** - before changing any code, read and understand the surrounding context, existing patterns, and conventions. Match them. Do not introduce a new pattern when an established one exists.
- **Think before acting** - step back and consider the broader design before making changes. Ask: "Is this the right place for this code? Is this the right level of abstraction? Will this be clear to the next person reading it?"
- **Decide component boundaries before coding** - when building UI, determine which component owns which state and which DOM elements before writing any JSX. If controls must appear on the same row, they must live in the same component's render output. Do not split a visual unit across component boundaries and then try to patch it back together with props, slots, or wrappers. If the first attempt creates a layout problem, do not patch the symptom — redesign the boundary.
- **Never iterate in circles** - if a fix introduces a new problem, stop. Do not apply another incremental patch. Instead, re-examine the root cause and identify the correct architectural solution. Two failed attempts at the same problem means the approach is wrong, not that it needs more tweaking.
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

### React Best Practices

This project uses **React 19** (`^19.2.4`) with the automatic JSX runtime (`react-jsx`). Prefer modern React features and patterns, but **only when they fit the problem** — do not adopt a feature just because it is new. Every API choice should have a clear justification rooted in the current code, not in novelty.

- **Lift state to the right level** - if state needs to persist across component mount/unmount cycles, lift it to the parent rather than introducing complex patterns.
- **Minimize `useEffect`** - prefer derived state (inline computation) over effects that sync state. Effects are for external system synchronization (Chrome APIs, event listeners), not for state derivation.
- **`useRef` for non-rendering values** - timers, previous values, and DOM references belong in refs, not state.
- **`useMemo`/`useCallback` only when justified** - do not wrap trivial computations (array filters, string formatting) in `useMemo`. Reserve memoization for genuinely expensive calculations or when a stable reference is required (e.g., effect dependencies, context values).

### MCP Tools

When working on new or existing MCP tools (via plugins):

- **Tool descriptions must be accurate and informative** - descriptions are shown to AI agents, so clarity is critical for proper tool usage
- **Keep parameter descriptions clear** - explain what each parameter does and provide examples where helpful
- **Update descriptions when behavior changes** - if a tool's functionality changes, update its description immediately
- **Design for usefulness** - think about how AI agents and engineers will actually use the tool; make it intuitive and powerful
- **Design for composability** - consider how tools can work together; tools should complement each other to make this MCP server the most powerful toolset for engineers
- **Return actionable data** - tool responses should include IDs, references, and context that enable follow-up actions with other tools

### Zod Schemas and JSON Schema Serialization

Plugin tool schemas are serialized to JSON Schema (via `z.toJSONSchema()`) for the MCP protocol and plugin manifests. Keep schemas serialization-compatible:

- **Never use `.transform()` in tool input/output schemas** - Zod transforms cannot be represented in JSON Schema. If input needs normalization (e.g., stripping colons from emoji names), do it in the tool's `handle` function, not in the schema. The schema defines the wire format; the handler implements business logic.
- **Avoid Zod features that don't map to JSON Schema** - `.transform()`, `.pipe()`, `.preprocess()`, and effects produce runtime-only behavior that `z.toJSONSchema()` cannot serialize. If the serializer throws, the build breaks. Keep schemas declarative (primitives, objects, arrays, unions, literals, enums, refinements with standard validations).
- **Fix the source, not the serializer** - when a schema feature conflicts with JSON Schema serialization, the correct fix is always to simplify the schema and move logic to the handler. Do not work around serialization limitations with options like `io: 'input'` — that hides the problem and produces a schema that doesn't match the handler's actual behavior.
- **`.refine()` callbacks must never throw** - Zod 4 runs `.refine()` callbacks even when the preceding validator has already failed (e.g., `z.url().refine(fn)` calls `fn` even on non-URL strings). If the callback calls a function that can throw on invalid input (like `new URL()`), wrap it in try-catch and return `false`. Never assume the refine callback only receives values that passed the base validator.

### TypeScript Configuration

Every `.ts`/`.tsx` file in the repository must be covered by a tsconfig that `tsc --build` reaches. No file may exist in a type-checking blind spot.

- **Test files must be type-checked.** Each package has a `tsconfig.test.json` that includes `src/**/*.test.ts`. The production `tsconfig.json` excludes test files from compilation output (they don't need `.js` artifacts), but the test tsconfig ensures they are still type-checked with the same strict settings.
- **Build scripts must be type-checked.** Standalone scripts (e.g., `build-*.ts`) that live outside `src/` have their own tsconfig (e.g., `tsconfig.build-scripts.json`).
- **Root config files must be type-checked.** Files like `eslint.config.ts`, `knip.ts`, and `playwright.config.ts` are covered by `tsconfig.configs.json`.
- **Never exclude files from type-checking to avoid fixing type errors.** If a file has type errors, fix the errors. Adding the file to an `exclude` list or removing it from a tsconfig is not an acceptable workaround — it creates a blind spot where bugs accumulate silently.
- **When adding a new `.ts` file**, verify it is covered by an existing tsconfig. If `tsc --build` doesn't check it, add it to the appropriate tsconfig or create a new one and reference it from the root `tsconfig.json`.

### Verification

Once a task is complete, **always run every one of these checks** to verify the change:

```bash
bun run build         # Verify production build
bun run type-check    # TypeScript check (must pass from clean checkout)
bun run lint          # Check for lint errors
bun run knip          # Check for unused code
bun run test          # Unit tests
```

**Every command must exit 0.** A task is not done until all five pass. No exceptions.

- If a check fails, **fix it** — even if the failure looks pre-existing or unrelated to your change. You own the codebase.
- Do not rationalize failures ("that's a known issue", "the build is the real type-check", "this was broken before I started"). If it fails, it is your problem. Fix it or explain to the user why you cannot.
- Do not skip a check because a different check covers "the same thing". Each command tests something distinct. Run all of them.

### ESLint

- **NEVER use `eslint-disable` comments** in source code. Always fix the underlying issue.
- **NEVER add file-specific rule overrides in eslint.config.ts** to suppress lint errors. Always fix the source code instead. Time-consuming is not an excuse — we should never be lazy.
- If a rule violation occurs, investigate and fix the root cause.
- If a dependency uses deprecated APIs, update the code to use the recommended alternative.

### Code Style

- Follow all configured ESLint rules.

### Bun-First Convention

This project runs on Bun. Always prefer Bun-native APIs over Node.js equivalents unless Bun has no equivalent.

**Use Bun APIs for:**

- File reading: `Bun.file(path).text()` instead of `readFile(path, 'utf-8')` from `node:fs/promises`
- File writing: `Bun.write(path, content)` instead of `writeFile(path, content)` from `node:fs/promises`
- File deletion: `Bun.file(path).delete()` instead of `unlinkSync(path)` from `node:fs`
- File existence checks: `Bun.file(path).exists()` instead of `stat()`-based checks
- Environment variables: `Bun.env.VAR` instead of `process.env.VAR`
- CLI arguments: `Bun.argv` instead of `process.argv`
- HTTP server: `Bun.serve()` (already in use)
- Bundling: `Bun.build()` (already in use)
- Package execution: `bunx` instead of `npx`

**Keep Node.js APIs for (no Bun-native equivalent):**

- `node:path` (`join`, `resolve`, `relative`, `dirname`) — no Bun path API
- `node:os` (`homedir`, `tmpdir`) — no Bun equivalents
- `node:fs` `watch` / `FSWatcher` — no Bun file watching API
- `node:fs` directory operations (`mkdir`, `mkdirSync`, `readdir`, `stat` for directories, `existsSync` for directories) — no Bun equivalents
- `node:fs` `mkdtempSync`, `cpSync`, `rmSync` — no Bun equivalents
- `node:child_process` — in Playwright E2E tests (Playwright runs under Node.js, not Bun)

**E2E tests (`e2e/`)** run under Playwright's Node.js test runner, so Node.js APIs are correct there.

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
