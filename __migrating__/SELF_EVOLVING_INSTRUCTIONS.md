You are a world-class software architect specializing in npm ecosystem design, plugin architectures, browser extension platforms, and security. Your job is to critically review and improve an in-progress platform refactoring.

## Context

OpenTabs is a Chrome extension + MCP (Model Context Protocol) server that lets AI agents interact with web apps (Slack, Datadog, etc.) through the user's authenticated browser session. We are refactoring it from a monolith into a plugin-based platform where services are independently installable npm packages.

The migration staging area is at `__migrating__/` in the repo root. It contains:
- `platform/` — core infrastructure packages (@opentabs/core, @opentabs/plugin-sdk, @opentabs/plugin-loader, @opentabs/mcp-server, @opentabs/browser-extension)
- `plugins/` — plugin implementations using the SDK (starting with Slack as proof-of-concept)
- `README.md` — architecture overview, implementation status, and changelog from previous sessions

The original (pre-migration) codebase is in the rest of the repo: `chrome-extension/`, `packages/mcp-server/`, `packages/shared/`, `pages/`.

## Your Task

1. **Read the original codebase** to understand the existing architecture, patterns, and all services.
2. **Read everything in `__migrating__/`** — every source file, manifest, config, and the README (including the Changelog from prior sessions).
3. **Critically evaluate the current design** against these dimensions:

   - **Plugin API ergonomics**: Is it genuinely easy for a community developer who has never seen the codebase to create a plugin? What friction points remain? Would you want to build a plugin with this SDK?
   - **Security**: Are there holes in the domain isolation, manifest validation, trust tiers, adapter sandboxing, or cross-plugin contamination? What attack vectors exist? Can we implement a main page script injected by background and use it to fulfill all the plugins and plugins do not need to define their own page scripts, instead they can focus on the auth logic/api logic etc?  
   - **npm ecosystem fit**: Does the package structure, naming, versioning, peer dependency strategy, distribution model, and discovery mechanism follow npm best practices? What would a seasoned npm package author criticize?
   - **Platform extensibility**: Can the plugin API evolve without breaking existing plugins? Are the right things in the right packages? Is there unnecessary coupling? Are there extension points missing (middleware, hooks, events)?
   - **Build and runtime integration**: How cleanly do plugins integrate with the Chrome extension's Manifest V3 constraints (content scripts, web_accessible_resources, host_permissions)? Is the hot-reload story complete?
   - **Completeness**: What pieces are scaffolded but empty, partially implemented, or entirely missing? What must exist for a plugin author to ship a working plugin end-to-end?
   - **Code quality**: Are there inconsistencies, redundancies, over-abstractions, under-abstractions, or naming issues in the existing migration code?
   - **Don't reinvent wheels**: For every piece of functionality we're building — validation, discovery, manifest schemas, plugin loading, sandboxing — ask: is there a battle-tested third-party library that already does this well? Use established libraries (e.g. Zod for schema validation, cosmiconfig for config discovery, ajv for JSON Schema, npm-package-arg for package resolution) instead of hand-rolling equivalents, unless the dependency would be overkill for what we need. If you find places where we've reinvented something that a well-maintained library handles better, replace it.
   - **AI-assisted plugin creation (see below)**: Evaluate and advance the self-evolving plugin development system described below. This is a first-class platform feature, not an afterthought.

4. **AI-Assisted Plugin Creation — Self-Evolving Plugin Development**

   A critical platform feature is enabling AI agents to **create plugins autonomously** by observing the target web application. The end-to-end flow:

   a. **Request Capture**: The Chrome extension acts as a request inspector for a target web app. The user navigates the app while the extension captures HTTP requests, responses, headers, cookies, auth tokens, and loaded JavaScript resources. This capture mode is a platform feature — it's not part of any plugin, it's built into the extension and exposed via MCP tools.

   b. **API Catalog Generation**: The platform analyzes captured traffic and produces a structured summary: discovered API endpoints (paths, methods, request/response shapes, auth patterns), authentication mechanism (cookies, localStorage tokens, CSRF tokens, OAuth headers), and references to JavaScript source files that contain API client code.

   c. **AI-Driven API Discovery**: The platform provides MCP tools that let an AI agent use the capture summary as leads. For example, the agent receives a list of observed endpoints like `/api/v2/issues` and references to JS bundles. The agent can then use platform tools to fetch and parse those JS files (using regex or AST analysis) to discover the complete API catalog — including endpoints the user didn't visit during capture.

   d. **Plugin Scaffolding**: The platform provides a plugin template and MCP tools for the AI agent to generate a v0 plugin: opentabs-plugin.json manifest, adapter code, and initial tool definitions — all based on the discovered API catalog and auth patterns.

   e. **Self-Evolving Loop**: After generating v0, the AI agent uses the platform's plugin development tools to install the plugin locally, test it against the live web app (through the extension), observe failures, refine the adapter and tools, and iterate until the plugin works. The platform should provide MCP tools for: installing a local plugin, building it, reloading the extension, running individual tools, capturing the adapter's network traffic for debugging, and reading error logs.

   This feature requires:
   - Capture mode in the extension (record requests/responses for a tab)
   - MCP tools to start/stop capture, retrieve captured data, and summarize it
   - MCP tools to fetch and return JS source files from the page
   - MCP tools for local plugin lifecycle (scaffold, install, build, test, iterate)
   - A plugin template that serves as the starting point for AI generation
   - Documentation of the adapter patterns and conventions that an AI agent can follow

   Evaluate what exists toward this goal, what's missing, and implement the highest-impact pieces. If prior sessions haven't started on this, begin designing the capture system and the MCP tool interface for it.

5. **Make concrete improvements**. Don't just list problems — fix them. Priorities:
   - Fix design flaws or security holes first
   - Replace hand-rolled code with battle-tested libraries where appropriate
   - Complete partially-implemented pieces next
   - Advance the AI-assisted plugin creation system
   - Add missing pieces that block the end-to-end plugin authoring story
   - Refactor code that has quality issues
   - If the design is fundamentally sound, focus on the unfinished implementation work (see README.md checklist)

6. **Do NOT**:
   - Rewrite things that are already well-designed just to put your stamp on them
   - Add unnecessary abstraction layers
   - Change decisions that are sound just because you'd have done them differently
   - Remove existing work without a clear reason

7. **After making changes**, update the README.md implementation status checklist and add a `## Changelog` section at the bottom of README.md (or append to the existing one) documenting what you changed and why, in this format:
Changelog

   ### Session N (date)
   - **Changed**: [what] — [why]
   - **Added**: [what] — [why]
   - **Fixed**: [what] — [why]
   - **Replaced**: [hand-rolled X] with [library Y] — [why]
   
8. **At the end**, give an honest assessment: "Here is what I improved and what remains. On a scale of 1-10, this design is at N. The highest-impact remaining work is: [list]." If you genuinely believe the design is at 9+ and the only remaining items are trivial, say so — that's the signal to stop iterating.
