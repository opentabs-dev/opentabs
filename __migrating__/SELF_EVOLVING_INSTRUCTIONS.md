You are a world-class software engineer. Your job is to **build working software**, not design abstractions. You are continuing an in-progress platform refactoring that has stalled on architecture and needs to shift to implementation.

## Context

OpenTabs is a Chrome extension + MCP (Model Context Protocol) server that lets AI agents interact with web apps (Slack, Datadog, etc.) through the user's authenticated browser session. We are refactoring it from a monolith into a plugin-based platform where services are independently installable npm packages.

The migration staging area is at `__migrating__/` in the repo root. It contains:
- `platform/` — core infrastructure packages (@opentabs/core, @opentabs/plugin-sdk, @opentabs/plugin-loader, @opentabs/mcp-server, @opentabs/browser-extension)
- `plugins/` — plugin implementations using the SDK (starting with Slack as proof-of-concept)
- `README.md` — architecture overview, implementation status, and changelog from previous sessions

The original (pre-migration) **working** codebase is in: `chrome-extension/`, `packages/mcp-server/`, `packages/shared/`, `pages/`.

## Session History

Sessions 1-6 built the SDK layer (core, plugin-sdk, plugin-loader, manifest validation, scaffolder, test utilities, capture tools). What remains is the runtime — the actual MCP server, Chrome extension background, and complete plugin implementations. Check the README.md implementation status checklist for current state before starting work.

## Your Task: Build, Don't Architect

Your primary objective is to **get the migrated system running end-to-end**. A working system with rough edges teaches us more than a polished SDK that can't start.

### Phase 1: Make the MCP Server Run — ✅ DONE (Session 7)

Server starts, accepts MCP clients, discovers plugins, registers tools. See Session 7 changelog.

### Phase 2: Complete the Slack Plugin — ✅ DONE (Session 7)

All Slack tools ported. 40 tools registered via the SDK's request provider pattern. See Session 7 changelog.

### Phase 3: Port the Chrome Extension Background — ✅ DONE (Session 8)

All 12 background modules + offscreen document ported from `chrome-extension/src/background/` to `platform/browser-extension/src/background/`. Uses `@opentabs/core` dynamic registry instead of static constants. Background exports `initialize(serviceDefinitions, serviceConfigs)` — a build-generated entry point calls this with plugin data. Zero type errors.

**Remaining for full build**: Vite build integration and MV3 manifest generation from the dynamic plugin registry. These are build-system tasks, not runtime porting.

### Phase 4: Make the Extension Buildable and Loadable (CURRENT PRIORITY)

The background modules are ported, but the extension can't be built or loaded yet. This phase bridges the gap:

1. **Build script that generates plugin data** — A script that runs `loadPlugins()` from `@opentabs/plugin-loader` at build time and produces a generated entry point that calls `initialize(serviceDefinitions, serviceConfigs)`. See the settled decision on "Extension background uses build-time plugin data."
2. **Vite config for the extension** — Adapt the existing `chrome-extension/vite.config.mts` to the new package structure. Must compile background, offscreen, and content scripts. Must build plugin adapter IIFEs (see `chrome-extension/build-adapters.mts` for the original approach).
3. **MV3 manifest generation** — The original `chrome-extension/manifest.ts` generates `manifest.json` from the static service registry. The new version must generate it from the dynamic plugin registry (populated at build time). Key sections: `content_scripts` (adapter injection), `web_accessible_resources` (adapter IIFE files), `host_permissions` (from plugin manifests), `permissions`.
4. **Extension loads in Chrome** — `bun run build` produces a `dist/` folder that can be loaded as an unpacked extension in `chrome://extensions/`.

**Success criteria**: Run `bun run build`, load the `dist/` folder in Chrome, extension connects to the MCP server via WebSocket.

Reference the original build system: `chrome-extension/vite.config.mts`, `chrome-extension/manifest.ts`, `chrome-extension/build-adapters.mts`.

### Phase 5: End-to-End Verification

Once Phase 4 is done, verify the full stack works. What you can verify from CLI:
1. `bun --hot dist/index.js` starts without errors (MCP server)
2. `curl http://127.0.0.1:3000/health` returns healthy status with plugin tools listed
3. Extension builds without errors

What requires manual verification (note this for the human):
4. Load the extension in Chrome, open Slack, call `slack_send_message` through an MCP client

If anything fails in steps 1-3, fix it. Those failures reveal real issues that theorizing never would.

### Phase 6: Design Review Through Usage

Only after the system is running end-to-end, review the design with fresh eyes:

- Did `sendServiceRequest()` work smoothly, or was the API awkward?
- Did the plugin manifest have all the fields the runtime actually needed?
- Did hot reload work with plugins?
- Was there friction in the port that suggests the SDK is missing something?
- Were there things the original code did that the new abstractions made harder?

Fix what you found. **Every design change must be motivated by a concrete problem you encountered during implementation.**

## Settled Decisions — Do Not Revisit

These architectural questions have been thoroughly researched and decided. Do not spend time re-evaluating them.

- **Each plugin ships its own MAIN world adapter script.** We evaluated three alternatives (fully declarative adapters, a single universal bundled script, background-mediated fetch) and all are unviable. The core reasons: (1) httpOnly cookies require same-origin `fetch()` from within the page — moving fetch to the background breaks `SameSite` cookie enforcement, (2) services like Snowflake call page-internal JS functions (`window.numeracy.nufetch()`) that can't be expressed declaratively, (3) bundling all plugin adapters into one universal script loses per-plugin URL scoping, per-plugin hot reload, and per-plugin isolation. The real security boundary is Chrome's content script URL matching (a Slack plugin can't run on a Jira page) plus trust tiers for plugin review. This is the same trust model as npm packages, VS Code extensions, and Chrome extensions themselves.

- **Extension background uses build-time plugin data, not runtime discovery.** The MCP server discovers plugins at runtime (node_modules scan). The Chrome extension cannot — it runs in a service worker without filesystem access. The solution: a build script runs `loadPlugins()` from `@opentabs/plugin-loader` at build time, producing `ServiceDefinition[]` and `Record<string, WebappServiceConfig>`. A generated entry point imports this data and calls `initialize(serviceDefinitions, serviceConfigs)` from `@opentabs/browser-extension`. This means the dynamic registry (`setServiceRegistry()`) is populated once at startup from static build-time data, and all dynamic getter functions (`getServiceIds()`, `getServiceUrlPatterns()`, etc.) work correctly from that point forward.

## Rules

1. **Write clean code, but don't invent new abstractions.** The original codebase is the design — port it faithfully to the plugin architecture. Write the same quality of code as the original. Don't add new abstraction layers, helper utilities, or type hierarchies that don't exist in the original. Don't write types or interfaces that aren't needed by code you're about to write. If a design question comes up during porting, check how the original solved it before inventing something new.

2. **Port, don't reinvent.** The original codebase works. Your job is to adapt it to the plugin architecture, not to redesign it. If the original `http-server.ts` handles CORS a certain way, keep it. If the original `websocket-relay.ts` has a reconnection strategy, port it faithfully.

3. **One file at a time, tested.** After porting each file, verify it compiles. After porting a group of files, verify the system starts. Don't port everything then debug a mountain of errors.

4. **No more scaffolding work.** The scaffolder, test utilities, manifest schema, JSON Schema generation, and trust tier system are done. Do not improve them. Do not add features to them. They are good enough. Build the actual runtime.

5. **No design documents.** Don't write new sections in README.md explaining architecture decisions. Write code. Update the implementation status checklist when you complete items. Add a brief changelog entry. That's it.

6. **Every session must produce runnable code.** If at the end of your session the server still can't start, or the plugin still can't load, or the extension still can't connect, the session was wasted. Partial progress on a runnable piece (e.g., "server starts but hot reload isn't wired yet") is acceptable. No progress on runnability is not.

7. **Don't refactor what's working.** The existing SDK code (`plugin-sdk/server.ts`, `plugin-sdk/adapter.ts`, `plugin-loader/`, `core/`) is architecturally sound. Don't touch it unless you hit a concrete bug during implementation.

8. **Use the original codebase as ground truth.** When in doubt about how something should work, read the original code. It's battle-tested and running in production.

## AI-Assisted Plugin Creation

This is a secondary objective. The capture tools and scaffolder already exist in draft form. **Do not advance this feature until Phase 5 (E2E verification) passes.** The self-evolving loop requires: (1) a running MCP server that loads plugins, (2) a loadable Chrome extension that injects adapters and connects to the server, (3) a real web app open in a tab. Without all three, the capture system can't observe traffic and generated plugins can't be tested. Get the full stack working first.

## Updating These Instructions

This file is meant to evolve across sessions. But evolution must be tightly scoped to prevent the instruction-editing from becoming the work itself.

**You MUST update this file when:**
- You **complete a phase** — mark it done and remove or collapse its details so the next session focuses on what's next, not what's finished
- You hit an **architectural question** during implementation that required significant investigation — add the conclusion to "Settled Decisions" so the next session doesn't re-investigate it
- You discover a **new anti-pattern** (something that wasted your time or led you astray) — add a brief rule to prevent the next session from repeating it

**You MUST NOT:**
- Spend more than 5 minutes editing this file per session
- Weaken or remove existing rules (especially "no new abstractions", "no scaffolding", "every session must produce runnable code")
- Add new phases, features, or scope — that's the human's job
- Rewrite sections that are working fine just to improve prose

The goal: each session leaves this file slightly more useful for the next session, with zero time wasted on meta-work.

## After Making Changes

1. Update the implementation status checklist in README.md
2. Add a changelog entry in this format:

```
### Session N (date)
- **Implemented**: [what] — [brief note]
- **Ported**: [what from where] — [any adaptations]
- **Fixed**: [what] — [why]
```

3. Give an honest status: "The server [can/cannot] start. The Slack plugin [is/is not] fully ported. The extension [can/cannot] connect. Remaining to reach end-to-end: [list]."
