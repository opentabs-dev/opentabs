# Contributing to OpenTabs

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- Google Chrome (for extension development and E2E tests)
- Git

## Getting Started

```bash
git clone https://github.com/opentabs-dev/opentabs.git
cd opentabs
npm install
npm run build
```

If builds get into a bad state, reset with `npm run clean` (removes all `dist/` and `.tsbuildinfo` files) then `npm run build` again. Use `npm run clean:all` to also remove `node_modules/` everywhere.

Load the Chrome extension:

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked" and select `~/.opentabs/extension/`

## Legal

By submitting a pull request, you agree that your contributions are licensed under the [MIT License](LICENSE) and that you have the right to license them. This project uses the "inbound=outbound" model: contributions are licensed under the same terms as the project itself.

Please also note:

- **Do not contribute code you do not have the right to license** (e.g., proprietary code from an employer without permission, or code copied from incompatibly-licensed projects).
- **Do not include API keys, secrets, or credentials** in any contribution.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Report unacceptable behavior to **ralph@opentabs.dev**.

## Development Workflow

**Full dev mode** (recommended):

```bash
npm run dev
```

This starts `tsc --build --watch`, the MCP server with the dev proxy for hot reload, and auto-rebuilds the Chrome extension on source changes. Output is color-coded by subprocess (`[tsc]`, `[mcp]`, `[ext]`) and a startup banner shows the MCP server URL and extension path when everything is ready. You still need to manually reload the extension from `chrome://extensions/` after rebuilds.

**MCP server only** (lightweight alternative for server-only work):

```bash
npm run dev:mcp
```

This starts just the MCP server with the dev proxy for hot reload — no tsc watcher or extension rebuilds. Useful when you're only changing server code and want faster iteration.

**Manual workflow:**

```bash
npm run build        # Build everything
opentabs start       # Start the MCP server
```

### MCP Server Changes

In dev mode, the server hot-reloads automatically when `tsc` recompiles. Without dev mode: rebuild (`npm run build`) and restart the server.

### Chrome Extension Changes

The extension never auto-reloads. After building:

1. `npm run build`
2. Open `chrome://extensions/` and click the reload icon on the OpenTabs card
3. Reopen the side panel if it was open

### Plugin Changes

Plugin builds auto-register and notify the running MCP server:

```bash
cd plugins/<name>
npm install    # first time only
npm run build  # builds, registers, and notifies the server
```

## Running Tests

**Unit tests:**

```bash
npm run test
```

**E2E tests** (requires the test plugin to be built):

```bash
npm run test:e2e
```

This builds the `e2e-test` plugin automatically, then runs Playwright.

**All quality checks at once:**

```bash
npm run check       # build + lint + format:check + knip + unit tests
npm run check:everything   # everything above + E2E tests + docs checks + plugin checks
```

| Command                    | What it does                                                      |
| -------------------------- | ----------------------------------------------------------------- |
| `npm run build`            | Production build (tsc + extension, incremental)                   |
| `npm run build:force`      | Full clean rebuild (non-incremental)                              |
| `npm run build:docs`       | Build docs site                                                   |
| `npm run build:plugins`    | Build all plugins (install + build each)                          |
| `npm run type-check`       | Incremental TypeScript compilation (tsc --build)                  |
| `npm run lint`             | Biome lint                                                        |
| `npm run format:check`     | Biome format check                                                |
| `npm run knip`             | Unused exports and dependencies                                   |
| `npm run test`             | Unit tests (Vitest)                                               |
| `npm run test:e2e`         | E2E tests (builds e2e-test plugin + Playwright)                   |
| `npm run check`            | All root checks (build + lint + format:check + knip + unit tests) |
| `npm run check:everything` | Everything: root + E2E + docs + plugins                           |
| `npm run check:docs`       | Docs quality checks (build + type-check + lint + knip + format)   |
| `npm run check:plugins`    | Plugin quality checks (type-check + lint + format)                |
| `npm run dev`              | Full dev mode (tsc watch + MCP server + extension)                |
| `npm run dev:mcp`          | MCP server only with hot reload                                   |
| `npm run dev:docs`         | Docs dev server                                                   |
| `npm run storybook`        | Storybook dev server (extension components)                       |
| `npm run clean`            | Remove all build artifacts                                        |
| `npm run clean:all`        | Remove build artifacts + node_modules everywhere                  |

All checks must pass before merging.

## Git Hooks

The project uses [Lefthook](https://github.com/evilmartians/lefthook) for git hooks:

**Pre-commit** (runs on every commit):

- Rejects any accidentally staged ralph state files (`.ralph/prd.json`, `.ralph/progress.txt`)
- Auto-stages dirty `package-lock.json` files whose sibling `package.json` is staged
- Biome check (lint + format) on staged `.ts` and `.tsx` files
- Biome format on staged `.json` and `.md` files

**Pre-push** (runs before every push):

- `npm run build` — full production build
- `npm run build:plugins` — build all plugins
- `npm run type-check` — TypeScript type checking
- `npm run test` — unit tests

If any hook command fails, the git operation is aborted. Fix the issue before retrying.

## E2E Test Infrastructure

E2E tests live in `e2e/` and use Playwright with custom fixtures. Each test gets a fully isolated environment:

**Fixture hierarchy** (each layer depends on the previous):

1. **`testPorts`** — dynamically allocated free ports (MCP server + test server)
2. **`mcpServer`** — MCP server subprocess running on the test's unique port, with its own config directory
3. **`testServer`** — controllable HTTP server that simulates web applications the extension interacts with
4. **`extensionContext`** — Chromium browser context with a copy of the extension configured for this test's ports
5. **`backgroundPage`** — the extension's service worker page, for inspecting extension internals
6. **`mcpClient`** — MCP Streamable HTTP client connected to this test's server, for calling tools and reading resources
7. **`sidePanelPage`** — the extension's side panel, for testing the React UI

**Writing a new test:**

```typescript
import { test, expect } from './fixtures.js';

test('my feature works', async ({ mcpClient, mcpServer }) => {
  await mcpServer.waitForHealth();
  const tools = await mcpClient.listTools();
  expect(tools.length).toBeGreaterThan(0);
});
```

Import `test` and `expect` from `./fixtures.js` (not from `@playwright/test` directly). The custom `test` object provides all the fixtures above as destructured parameters.

**Configuration**: Tests run in parallel (`fullyParallel: true`) with 4 local workers (2 on CI). Each test uses ephemeral ports (`PORT=0`), so parallel tests never collide. Traces and video are retained on failure.

## Debugging

OpenTabs spans four processes — each has its own debugging surface:

**MCP Server** (Node.js process):

- Log file: `~/.opentabs/server.log`
- CLI: `opentabs logs -f` to follow logs in real time, or `opentabs logs` for recent output
- Filter by plugin: `opentabs logs -f --plugin <name>`
- Health endpoint: `curl http://localhost:9515/health`

**Extension background** (Chrome service worker):

- Open `chrome://extensions/`, find OpenTabs, click "Inspect views: service worker"
- Console shows WebSocket messages, adapter injection, and tool dispatch

**Extension side panel** (React UI):

- Right-click the side panel and select "Inspect"
- Standard Chrome DevTools for the React app

**Injected adapters** (page context):

- Open DevTools on the target page
- Console: `globalThis.__openTabs` shows registered adapters and their state
- Network tab shows API calls made by plugin tool handlers

**E2E test failures:**

- Playwright traces are saved to `test-results/` on failure (configured via `trace: 'retain-on-failure'`)
- View traces: `npx playwright show-trace test-results/<test-name>/trace.zip`
- HTML report: `npx playwright show-report`
- Video recordings are also retained on failure

## Code Conventions

Key rules (see [CLAUDE.md](CLAUDE.md) for the full list):

- **Node.js APIs** — use `node:fs/promises`, `node:child_process`, `node:crypto`, `process.env`, `process.argv`
- **No `biome-ignore` comments** — fix the underlying issue
- **No TODO/FIXME/HACK comments** — fix it now or don't commit
- **Delete unused code** — dead code is noise
- **Every `.ts` file must be covered by a tsconfig** that `tsc --build` reaches
- **Comments describe current behavior** — no historical context or "used to" phrasing

## Architecture

OpenTabs has three core components: the **MCP Server** (discovers plugins, dispatches tool calls), the **Chrome Extension** (injects plugin adapters into matching tabs), and the **Plugin SDK** (base class and utilities for plugin authors). They communicate via Streamable HTTP (Claude Code ↔ MCP Server) and WebSocket (MCP Server ↔ Extension).

See [CLAUDE.md](CLAUDE.md) for the full architecture documentation, plugin discovery pipeline, dispatch protocol, and design decisions.

## Adding a Platform Package

1. Create the package directory under `platform/<name>/`
2. Add `package.json` with the `@opentabs-dev` scope
3. Add `tsconfig.json` with `composite: true` and project references to dependencies
4. Reference the new package from the root `tsconfig.json`
5. The root `package.json` uses `"workspaces": ["platform/*"]`, so it is automatically included
6. Run `npm install` to link the workspace

## Publishing

Platform packages are published to npm via the "Publish Platform Packages" GitHub Actions workflow:

1. Go to **Actions** → **Publish Platform Packages** → **Run workflow**
2. Enter the target version (e.g., `0.0.82`)
3. The workflow bumps versions, builds, publishes in dependency order, updates plugins, and commits + tags

## Creating a Pull Request

1. Create a feature branch: `git checkout -b my-feature`
2. Make your changes and commit with a clear message
3. Run `npm run check:everything` to verify everything passes
4. Push your branch: `git push -u origin my-feature`
5. Open a pull request against `main` with a description of what changed and why
