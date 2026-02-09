# Project Instructions for Claude

## Project Overview

**OpenTabs** is a Chrome extension + MCP (Model Context Protocol) server that enables AI agents (like Claude Code) to interact with web applications (e.g. Slack, Datadog, Snowflake) and the Chrome browser itself through the user's authenticated browser session. The core value: "Zero tokens, full access" - use existing web sessions without API tokens, bot setup, or admin approval.

### Architecture

The codebase has two distinct service architectures:

**Webapp services** use MAIN world adapters injected into web pages to access authenticated APIs via the user's browser session. They require tab detection, URL pattern matching, health checks, and connection lifecycle management. Each webapp service has an adapter script, a service controller, and a set of MCP tools.

**Native services** (Browser, System) call `chrome.*` APIs directly from the background script. They have no tabs, no adapters, no connection status — they're always available when the extension is connected.

```
┌─────────────┐  HTTP/SSE   ┌─────────────┐  WebSocket  ┌──────────────────┐
│ Claude Code │ ←─────────→ │ MCP Server  │ ←─────────→ │ Chrome Extension │
│             │  /mcp       │ (localhost) │             │   (Background)   │
└─────────────┘             └─────────────┘             └────────┬─────────┘
                                                                 │
                                          ┌──────────────────────┼──────────────────────┐
                                          │                      │                      │
                                 ┌────────▼─────────┐  ┌────────▼─────────┐  ┌─────────▼────────┐
                                 │  MAIN World       │  │  BrowserController│  │  system.*         │
                                 │  Adapter Scripts   │  │  chrome.tabs.*   │  │  chrome.runtime.* │
                                 │ (webapp services) │  │  chrome.windows.*│  │                   │
                                 └────────┬─────────┘  └──────────────────┘  └───────────────────┘
                                          │ Same-origin
                                 ┌────────▼─────────┐
                                 │   Web APIs        │
                                 │ (user's session)  │
                                 └──────────────────┘
```

### Tech Stack

- **Language**: TypeScript (strict, ES Modules)
- **Runtime**: Bun (monorepo with workspaces)
- **Build**: Vite, tsc, Turborepo (orchestration)
- **Testing**: Bun Test (unit), Playwright (e2e)
- **UI**: React 19, Tailwind CSS 4
- **Chrome Extension**: Manifest V3

### Directory Structure

```
opentabs/
├── chrome-extension/          # Extension entry points
│   ├── manifest.ts            # MV3 manifest
│   ├── build-adapters.mts     # Builds MAIN world adapter IIFEs
│   ├── public/                # Static assets (_locales, icons)
│   └── src/
│       ├── background/        # Service worker - manages connections
│       │   ├── index.ts       # Background script entry
│       │   ├── mcp-router.ts  # Routes JSON-RPC messages to service handlers
│       │   ├── browser-controller.ts  # Native service: chrome.tabs/windows APIs
│       │   ├── adapter-manager.ts     # Registers MAIN world adapters
│       │   ├── offscreen-manager.ts   # Offscreen document lifecycle
│       │   ├── service-controllers/   # Per-service controllers (one .ts per webapp service)
│       │   └── service-managers/      # Service manager types and wiring
│       ├── adapters/          # MAIN world adapter scripts (one .ts per webapp service, built into IIFEs)
│       └── offscreen/         # Persistent WebSocket (MV3 workaround)
├── pages/                     # Extension UI & content scripts
│   ├── content/               # Content script stub for chrome API access
│   ├── side-panel/            # Side panel UI
│   └── options/               # Options page (tool permissions per service)
├── packages/                  # Shared packages (monorepo)
│   ├── mcp-server/            # MCP server (standalone Node.js)
│   │   └── src/
│   │       ├── index.ts       # Entry point
│   │       ├── server.ts      # MCP server creation
│   │       ├── http-server.ts # HTTP/SSE transport
│   │       ├── websocket-relay.ts  # WS to Chrome extension
│   │       ├── config.ts      # Server configuration
│   │       ├── hot-reload.ts  # Hot reload (update tools without disconnecting clients)
│   │       └── tools/         # MCP tool definitions (one folder per service)
│   ├── shared/                # Shared types, constants, utilities
│   ├── ui/                    # Shared UI components
│   ├── e2e/                   # E2E tests (Playwright)
│   ├── hmr/                   # Hot module reload support
│   ├── env/                   # Environment configuration
│   ├── dev-utils/             # Development utilities
│   ├── vite-config/           # Shared Vite configuration
│   ├── tsconfig/              # Shared TypeScript configs
│   └── zipper/                # Extension packaging
└── dist/                      # Built extension output
```

### Adding a New Webapp Service

Each webapp service follows the same pattern. To add support for a new web application:

1. **Adapter** (`chrome-extension/src/adapters/<service>.ts`): MAIN world script injected into the page to access authenticated APIs
2. **Service controller** (`chrome-extension/src/background/service-controllers/<service>.ts`): Extends `base-service-controller.ts`, handles tool requests
3. **MCP tools** (`packages/mcp-server/src/tools/<service>/`): Tool definitions registered with the MCP server
4. **Options page**: Add tool list and category definitions in `pages/options/src/Options.tsx`

### Key Components

1. **WebSocket Relay** (`packages/mcp-server/src/websocket-relay.ts`): Manages MCP server to Chrome extension communication
2. **MCP Router** (`chrome-extension/src/background/mcp-router.ts`): Routes incoming JSON-RPC requests to service handlers and system commands
3. **MAIN World Adapters** (`chrome-extension/src/adapters/`): Per-service adapter scripts that run in the page's MAIN world to access authenticated web APIs. Built into IIFEs by `build-adapters.mts` and registered by `adapter-manager.ts`
4. **Service Controllers** (`chrome-extension/src/background/service-controllers/`): Per-service controllers extending `base-service-controller.ts` that handle tool requests for webapp services
5. **Browser Controller** (`chrome-extension/src/background/browser-controller.ts`): Native service controller that calls `chrome.tabs.*` / `chrome.windows.*` APIs directly — no adapters, no tab lifecycle, always available
6. **Offscreen Document** (`chrome-extension/src/offscreen/`): Maintains persistent WebSocket (MV3 service workers can suspend)
7. **MCP Tools** (`packages/mcp-server/src/tools/`): Tool definitions organized by service, one folder per service
8. **Hot Reload** (`packages/mcp-server/src/hot-reload.ts`): Updates tool handlers without disconnecting MCP clients

### Commands

```bash
bun install           # Install dependencies
bun run dev           # Development with hot reload
bun run build         # Production build
bun run test          # Unit tests (Bun Test)
bun run e2e           # E2E tests (Playwright)
bun run lint          # Lint check
bun run lint:fix      # Lint fix
bun run type-check    # TypeScript check
bun run zip           # Package extension
```

### MCP Client Configuration

For Claude Code (`~/.claude/settings/mcp.json`):
```json
{
  "mcpServers": {
    "opentabs": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

### Loading the Extension

1. `bun run build`
2. Open `chrome://extensions/`
3. Enable Developer mode
4. Load unpacked → select `dist` folder

---

## Self-Iteration Development Workflow

This project supports a fully autonomous development loop. You can modify code, rebuild, and apply changes without any human intervention (no manual extension reloads, no server restarts).

### Build Safety

The MCP server (`packages/mcp-server/`) is excluded from the turbo `clean:bundle` pipeline. This means root `bun run build` and `turbo build` safely overwrite the MCP server's `dist/` in-place without deleting it first, so a running `bun --hot` process is never disrupted. To clean the MCP server's `dist/`, use `bun run clean:dist` or `bun run rebuild` from within `packages/mcp-server/`.

### Two Change Domains

Changes fall into two categories with different reload mechanisms:

| What changed | Build command | How it reloads |
|---|---|---|
| **MCP server** (`packages/mcp-server/src/`) | `bun run build` from `packages/mcp-server/` | Automatic hot reload via `bun --hot` |
| **Chrome extension** (`chrome-extension/`, `pages/`, `packages/shared/`, `packages/ui/`) | `turbo build --filter=chrome-extension...` from project root | Call `reload_extension` MCP tool after build |

Root `bun run build` builds everything (both extension and MCP server) and is safe to run at any time.

### MCP Server Changes (Hot Reload)

The MCP server runs as `bun --hot dist/index.js`. When compiled files in `dist/` change, Bun re-evaluates all modules while keeping the process alive, all network connections intact, and all client sessions connected. The hot reload system diffs old vs new tool definitions and patches them in-place. MCP clients receive a `notifications/tools/list_changed` notification automatically.

**Workflow for MCP server changes:**
```bash
# 1. Edit source files in packages/mcp-server/src/
# 2. Build (compiles TS → JS in dist/)
bun run build    # Run from packages/mcp-server/
# 3. Done — bun --hot detects the change and patches all sessions
```

**If stale files accumulate** (e.g. after renaming/deleting source files):
```bash
bun run rebuild    # Run from packages/mcp-server/ — cleans dist then rebuilds
```

**Verify hot reload worked:**
```bash
curl -s http://127.0.0.1:3000/health | python3 -m json.tool
# Check: hotReload.reloadCount increased, lastReload.success is true
```

### Chrome Extension Changes (Build + Reload Tool)

Extension-side changes (adapters, background scripts, service controllers, UI) require building the extension and then reloading it via the `reload_extension` MCP tool.

**Workflow for extension changes:**
```bash
# 1. Edit source files in chrome-extension/src/, pages/, packages/shared/, etc.
# 2. Build the extension
turbo build --filter=chrome-extension...    # Run from project root
# 3. Reload the extension via MCP tool
```
Then call the `reload_extension` MCP tool. The extension will disconnect briefly and reconnect automatically. Adapter scripts are re-injected into matching tabs.

**If both MCP server and extension changed:**
```bash
# 1. Build MCP server first (hot reload preserves connection)
bun run build    # Run from packages/mcp-server/
# 2. Build extension
turbo build --filter=chrome-extension...    # Run from project root
# 3. Reload extension via MCP tool
```

### Managing the MCP Server Process

The MCP server should be running for tools to work.

**CRITICAL: NEVER kill the MCP server process during a session.** The MCP client session is tied to the running process. If you kill it, all opentabs tools become permanently unavailable for the rest of the session — the client does NOT auto-reconnect to a new process. Always rely on hot reload instead (build from `packages/mcp-server/` and `bun --hot` patches in-place).

**Check if running:**
```bash
pgrep -f 'bun --hot.*mcp-server/dist/index.js'
curl -s http://127.0.0.1:3000/health
```

**Start a detached MCP server** (survives terminal close, use only for initial setup or recovery):
```bash
nohup bun --hot packages/mcp-server/dist/index.js > /tmp/opentabs-mcp-server.log 2>&1 &
```

**Restart (kill old + start new):**
```bash
kill $(pgrep -f 'bun --hot.*mcp-server/dist/index.js') 2>/dev/null
sleep 1
nohup bun --hot packages/mcp-server/dist/index.js > /tmp/opentabs-mcp-server.log 2>&1 &
```

The detached process runs independently of the terminal session. The Chrome extension reconnects automatically when the WebSocket server comes back up. However, MCP clients (AI sessions) will NOT reconnect — use this only when no active AI session depends on the tools.

### Health Endpoint

`GET http://127.0.0.1:3000/health` returns server state including:
- `streamSessions` / `sseSessions` — connected MCP client count
- `extension` — Chrome extension connection status (`"connected"` or `"disconnected"`)
- `hotReload.reloadCount` — total hot reloads since process start
- `hotReload.lastReload` — last reload result (success, timestamp, patched sessions, tool count)

### Always Test After Building

**After building any change, immediately test it using the live MCP tools.** Do not stop after `bun run build` succeeds and do not wait for the human to ask you to test. The build passing only verifies compilation — you must verify runtime behavior by calling the affected tools.

**After MCP server changes:**
1. Build: `bun run build` from `packages/mcp-server/`
2. Verify hot reload: `curl -s http://127.0.0.1:3000/health | python3 -m json.tool`
3. Call the affected tool(s) to verify they work end-to-end

**After extension changes:**
1. Build: `turbo build --filter=chrome-extension...` from project root
2. Reload: call the `reload_extension` MCP tool
3. Wait a few seconds for reconnection
4. Call the affected tool(s) to verify they work end-to-end

**Hot reload scope:** Both tool definitions and `WebSocketRelay` methods hot-reload correctly. The relay singleton's prototype is updated to the fresh class definition on each reload via `Object.setPrototypeOf`, so new or changed methods take effect immediately without a process restart.

---

## Debugging Tools

Some webapp services have `<service>_execute_script` debugger tools that execute arbitrary JavaScript in the service's browser page context. Use `browser_execute_script` to run scripts in any tab by tab ID.

### When to Use Debugger Tools

1. **API Failures**: When a tool's API call fails, use the debugger to inspect:
   - What authentication tokens/cookies are available
   - What the actual API response looks like
   - Whether the page context has the expected state

2. **Improving Tool Responses**: Use debuggers to explore:
   - What data the webpage provides that tools aren't capturing
   - Additional API endpoints available in the page context
   - How to extract richer information from responses

3. **Self-Iteration**: Before modifying tool code, use debugger tools to:
   - Test API calls directly in the browser context
   - Verify assumptions about available data
   - Prototype improvements before implementing

---

## Keeping CLAUDE.md Up to Date

**Important**: This file should remain **service-agnostic**. Do not enumerate individual services, tools, or adapters by name. The codebase grows by adding new services — documentation should describe patterns and conventions, not inventories.

Guidelines for updates:
- Keep additions **high-level** — avoid excessive detail that wastes context
- Focus on **architecture, patterns, and conventions** — not per-service details
- **Never list individual services** (e.g. "Slack, Datadog, ...") — use generic terms like "webapp services" and reference the code structure for discovery
- Use `...` or "(e.g. Slack)" sparingly when a concrete example clarifies a pattern
- Remove outdated information that no longer applies

---

## Code Quality Rules

### Core Principles

You are the best frontend React engineer, the best UI/UX designer, and the best software architect. Hold yourself to the highest standard — no lazy work, no half-measures, no excuses. Every line of code you write should reflect that standard.

**Correctness over speed. Always.** Never be lazy. Never take the easy path when the correct path exists. Always use the correct method and best practice, even if it takes more time. Doing the right thing and keeping code clean is the highest priority — never compromise on this.

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

This project uses **React 19** (`^19.2.4`) with the automatic JSX runtime (`react-jsx`). Prefer modern React features and patterns, but **only when they fit the problem** -- do not adopt a feature just because it is new. Every API choice should have a clear justification rooted in the current code, not in novelty.

- **`<Activity>` for view switching** - use `<Activity mode={isActive ? 'visible' : 'hidden'}>` when toggling views that have **meaningful internal state worth preserving** (e.g., scroll position, form input, expensive mounted resources). If the hidden component is stateless or trivially cheap to remount, simple conditional rendering (`{isActive && <Component />}`) is clearer and preferred.
- **`useEffectEvent` for stable callbacks** - when an effect needs to call a function that reads the latest props/state but should not re-trigger the effect, wrap it with `useEffectEvent`. This avoids stale closures without adding dependencies to the effect. Do not use it outside of effects -- regular callbacks and event handlers do not need it.
- **Arrow function components** - use `const Component = () => (...)` per the `func-style` ESLint rule. No function declarations.
- **Lift state to the right level** - if state needs to persist across component mount/unmount cycles, lift it to the parent rather than introducing complex patterns.
- **Minimize `useEffect`** - prefer derived state (inline computation) over effects that sync state. Effects are for external system synchronization (Chrome APIs, event listeners), not for state derivation.
- **`useRef` for non-rendering values** - timers, previous values, and DOM references belong in refs, not state.
- **`useMemo`/`useCallback` only when justified** - do not wrap trivial computations (array filters, string formatting) in `useMemo`. Reserve memoization for genuinely expensive calculations or when a stable reference is required (e.g., effect dependencies, context values). When React Compiler is adopted, most manual memoization becomes unnecessary.

### MCP Tools

When working on new or existing MCP tools:

- **Tool descriptions must be accurate and informative** - descriptions are shown to AI agents, so clarity is critical for proper tool usage
- **Keep parameter descriptions clear** - explain what each parameter does and provide examples where helpful
- **Update descriptions when behavior changes** - if a tool's functionality changes, update its description immediately
- **Design for usefulness** - think about how AI agents and engineers will actually use the tool; make it intuitive and powerful
- **Design for composability** - consider how tools can work together; tools should complement each other to make this MCP server the most powerful toolset for engineers
- **Return actionable data** - tool responses should include IDs, references, and context that enable follow-up actions with other tools

### Verification

Once a task is complete, **always run tests, lint, and build** to verify the change:

```bash
bun run test          # Run unit tests
bun run lint          # Check for lint errors
bun run build         # Verify production build
```

Fix any issues before considering the task done.

### ESLint
- **NEVER use `eslint-disable` comments** in source code. Always fix the underlying issue.
- If a rule violation occurs, investigate and fix the root cause.
- If a dependency uses deprecated APIs, update the code to use the recommended alternative.
- **File-specific rule configuration in eslint.config.ts is acceptable** when a library's recommended pattern conflicts with a general rule (e.g., typescript-eslint's API design).

### Code Style
- Use arrow function expressions (not function declarations) per the `func-style` rule.
- Follow all configured ESLint rules.

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

**Examples:**
```typescript
// Bad: "Don't restore tabIds here - findTabs will re-discover them"
// Good: "Restore connection status (tabIds are re-discovered by findTabs)"

// Bad: "This used to set connected=false but now we don't touch it"
// Good: (just remove the comment if the code is self-explanatory)

// Bad: "Legacy SSE transport (deprecated but still supported)"
// Good: "SSE transport"
```
