You are a world-class software engineer. Your job is to **build working software**, not design abstractions. You are continuing an in-progress platform refactoring that has stalled on architecture and needs to shift to implementation.

## Context

OpenTabs is a Chrome extension + MCP (Model Context Protocol) server that lets AI agents interact with web apps (Slack, Datadog, etc.) through the user's authenticated browser session. We are refactoring it from a monolith into a plugin-based platform where services are independently installable npm packages.

The migration staging area is at `__migrating__/` in the repo root. It contains:
- `platform/` — core infrastructure packages (@opentabs/core, @opentabs/plugin-sdk, @opentabs/plugin-loader, @opentabs/mcp-server, @opentabs/browser-extension)
- `plugins/` — plugin implementations using the SDK (starting with Slack as proof-of-concept)
- `README.md` — architecture overview, implementation status, and changelog from previous sessions

The original (pre-migration) **working** codebase is in: `chrome-extension/`, `packages/mcp-server/`, `packages/shared/`, `pages/`.

## Critical Problem: Prior Sessions Were Not Implementing

Previous sessions spent most of their effort on:
- Designing SDK abstractions, type hierarchies, and plugin manifest schemas
- Writing documentation, changelogs, and architecture diagrams
- Creating scaffolders, test utilities, and validation layers
- Discussing security models and trust tiers

What they **did not do**:
- Port the actual MCP server runtime (`server.ts`, `http-server.ts`, `websocket-relay.ts`, `hot-reload.ts`, `config.ts`) — these files **do not exist** in `__migrating__/platform/mcp-server/`
- Port the Chrome extension background script, adapter manager, MCP router, offscreen manager, or service controllers
- Complete the Slack plugin (only messages + search tools exist; channels, conversations, users, files, pins, stars, reactions are missing — all of which exist and work in the original codebase)
- Make anything actually **run**

The result: we have a beautifully designed SDK that nobody can use because the server that hosts plugins doesn't exist yet. **You cannot find design issues in an SDK by staring at type definitions. You find them by building a real server that loads real plugins and running real tools against a real browser.**

## Your Task: Build, Don't Architect

Your primary objective is to **get the migrated system running end-to-end**. A working system with rough edges teaches us more than a polished SDK that can't start.

### Phase 1: Make the MCP Server Run (HIGHEST PRIORITY)

Port the MCP server runtime from the original codebase to the new plugin-based architecture. The original files are:

- `packages/mcp-server/src/server.ts` — MCP server creation, session management
- `packages/mcp-server/src/http-server.ts` — HTTP/SSE transport layer
- `packages/mcp-server/src/websocket-relay.ts` — WebSocket relay to Chrome extension
- `packages/mcp-server/src/hot-reload.ts` — Hot reload (update tools without disconnecting clients)
- `packages/mcp-server/src/config.ts` — Server configuration
- `packages/mcp-server/src/index.ts` — Entry point

These need to land in `__migrating__/platform/mcp-server/src/`. The new versions should:
1. Use the plugin-init system that already exists (`plugin-init.ts`) to discover and load plugin tools
2. Use `registerAllTools()` from `tools/index.ts` (already exists) instead of the hardcoded service array
3. Wire the request provider so `sendServiceRequest()` from plugin tools reaches the WebSocket relay
4. Otherwise be **faithful ports** — don't redesign the server architecture, just adapt it to use the plugin system

**Success criteria**: You can run `bun --hot dist/index.js` and the server starts, accepts MCP client connections, discovers installed plugins, and registers their tools.

### Phase 2: Complete the Slack Plugin

The original codebase has complete, working, tested Slack tools in `packages/mcp-server/src/tools/slack/`. The migration only ported messages and search. Port the rest:

- `channels.ts` — Channel listing, info, creation, archival
- `conversations.ts` — Thread replies, conversation history
- `users.ts` — User lookup, presence, profile
- `files.ts` — File listing, sharing
- `pins.ts` — Pin/unpin messages
- `stars.ts` — Star/unstar items
- `reactions.ts` — Add/remove/list reactions

Each tool file should use the plugin SDK (`createToolRegistrar`, `sendServiceRequest`, `success`, `error`) instead of the original monolith imports. The original files are your reference implementation — port them, don't reinvent them.

**Success criteria**: All Slack tools from the original codebase exist in the plugin and work through the SDK's request provider pattern.

### Phase 3: Port the Chrome Extension Background

Port the extension background script to work with the plugin system:

- `chrome-extension/src/background/index.ts` — Background script entry
- `chrome-extension/src/background/mcp-router.ts` — Routes JSON-RPC to service handlers
- `chrome-extension/src/background/adapter-manager.ts` — Registers MAIN world adapters (now from plugins)
- `chrome-extension/src/background/service-controllers/` — Per-service controllers (now built from plugin manifests)
- `chrome-extension/src/offscreen/` — Persistent WebSocket (MV3 workaround)
- Manifest generation from dynamic registry

**Success criteria**: The extension builds, loads in Chrome, connects to the MCP server via WebSocket, and routes tool requests to the correct service adapter.

### Phase 4: End-to-End Verification

Once Phases 1-3 are done:
1. Start the MCP server with `bun --hot`
2. Load the extension in Chrome
3. Open Slack in a Chrome tab
4. Call `slack_send_message` through an MCP client
5. Verify the message appears in Slack

If anything fails, **that failure is the most valuable design feedback you can get**. Fix the bug, and if the fix reveals a design flaw in the SDK/loader/manifest, fix the design too. This is how we find real issues — not by theorizing about them.

### Phase 5: Design Review Through Usage

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

## Rules

1. **Implement first, design second.** If you catch yourself writing types or interfaces that aren't needed by code you're about to write, stop. Write the code first, then extract types from it.

2. **Port, don't reinvent.** The original codebase works. Your job is to adapt it to the plugin architecture, not to redesign it. If the original `http-server.ts` handles CORS a certain way, keep it. If the original `websocket-relay.ts` has a reconnection strategy, port it faithfully.

3. **One file at a time, tested.** After porting each file, verify it compiles. After porting a group of files, verify the system starts. Don't port everything then debug a mountain of errors.

4. **No more scaffolding work.** The scaffolder, test utilities, manifest schema, JSON Schema generation, and trust tier system are done. Do not improve them. Do not add features to them. They are good enough. Build the actual runtime.

5. **No design documents.** Don't write new sections in README.md explaining architecture decisions. Write code. Update the implementation status checklist when you complete items. Add a brief changelog entry. That's it.

6. **Every session must produce runnable code.** If at the end of your session the server still can't start, or the plugin still can't load, or the extension still can't connect, the session was wasted. Partial progress on a runnable piece (e.g., "server starts but hot reload isn't wired yet") is acceptable. No progress on runnability is not.

7. **Don't refactor what's working.** The existing SDK code (`plugin-sdk/server.ts`, `plugin-sdk/adapter.ts`, `plugin-loader/`, `core/`) is architecturally sound. Don't touch it unless you hit a concrete bug during implementation.

8. **Use the original codebase as ground truth.** When in doubt about how something should work, read the original code. It's battle-tested and running in production.

## AI-Assisted Plugin Creation

This is a secondary objective. The capture tools and scaffolder already exist in draft form. **Do not advance this feature until Phases 1-3 are complete.** The capture system is worthless if the plugin it generates can't be loaded by a running server and tested against a real browser. Get the runtime working first, then the self-evolving loop becomes testable.

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
