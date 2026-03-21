#!/bin/bash
# perfect-docs.sh — Audit docs/ against the source code and create PRD(s).
#
# Usage: bash .ralph/perfect-docs.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read -r -d '' PROMPT <<'PROMPT_EOF' || true
You are auditing the OpenTabs documentation site (docs/) to ensure it accurately reflects the current codebase. Identify gaps, inaccuracies, and outdated content, then use the ralph skill to create PRDs to fix them.

## Step 1: Read the rules and understand the codebase

1. Read docs/CLAUDE.md — docs project conventions, tech stack, design rules
2. Read CLAUDE.md (root) — overall platform architecture, key concepts, commands
3. Read these package-level CLAUDE.md files for authoritative descriptions:
   - platform/plugin-sdk/CLAUDE.md
   - platform/mcp-server/CLAUDE.md
   - platform/browser-extension/CLAUDE.md
   - platform/cli/CLAUDE.md
   - platform/plugin-tools/CLAUDE.md

These CLAUDE.md files are the source of truth. If the docs contradict a CLAUDE.md, the docs are wrong.

## Step 2: Discover all documentation pages

List all .mdx files under docs/content/docs/ dynamically.

## Step 3: Audit the documentation against the source code

Systematically compare what the docs say against what the code actually does. For each page, read the corresponding source code and check for:

- **Outdated API signatures** — tool parameters, resource URIs, prompt schemas that have changed
- **Missing features** — new tools, resources, prompts, CLI commands, config options, SDK utilities not documented
- **Incorrect behavior descriptions** — docs that describe something the implementation no longer does
- **Stale code examples** — example code that would not work against the current API
- **Missing pages** — entire features with no documentation
- **Broken cross-references** — links to pages, sections, or code that no longer exist
- **Outdated SVG illustrations** — text labels, version numbers, API signatures, directory structures in SVG illustration components (docs/components/illustrations.tsx) that no longer match the codebase
- **Stale `lastUpdated` frontmatter** — pages whose `lastUpdated` date does not reflect actual last modification

### Audit priority order (highest-churn pages first):

1. SDK Reference (sdk/*.mdx) — compare against platform/plugin-sdk/src/ exports
2. CLI Reference (reference/cli.mdx) — compare against platform/cli/src/commands/
3. Configuration (reference/configuration.mdx) — compare against config.ts files
4. Guides (guides/*.mdx) — check code examples against implementation
5. Architecture (contributing/architecture.mdx, reference/mcp-server.mdx)
6. Browser tools (reference/browser-tools.mdx)
7. Root pages (index.mdx, quick-start.mdx, first-plugin.mdx, install/index.mdx)
8. Contributing (contributing/*.mdx)

### SVG illustration audit:

Read docs/components/illustrations.tsx in full. Audit every text string, label, description, version number, directory name, API signature against actual source code. Cross-reference with docs/CLAUDE.md "Current Illustrations" table.

### `lastUpdated` rule:

For every page you create a story to update, the story MUST include updating `lastUpdated` to today's date (YYYY-MM-DD). Do NOT create standalone stories just to bump dates.

### Source code to read:

- platform/plugin-sdk/src/index.ts — all SDK exports
- platform/mcp-server/src/config.ts — config schema
- platform/mcp-server/src/browser-tools/ — browser tool implementations
- platform/mcp-server/src/mcp-setup.ts — MCP registration (tabId + instance parameter injection)
- platform/mcp-server/src/mcp-gateway.ts — MCP gateway endpoint with 2 meta-tools (opentabs_list_tools, opentabs_call)
- platform/mcp-server/src/settings-resolver.ts — multi-instance URL settings resolution, instanceMap
- platform/mcp-server/src/http-routes.ts — HTTP endpoints including GET /tools and POST /tools/:name/call
- platform/cli/src/cli.ts, platform/cli/src/commands/ — CLI commands including new `tool` command (tool list/schema/call)
- platform/cli/src/commands/start.ts — start command showing all three connection modes (full MCP, gateway MCP, CLI-only)
- platform/plugin-tools/src/cli.ts — plugin developer CLI
- platform/create-plugin/src/index.ts — scaffolding CLI
- platform/shared/src/constants.ts — DEFAULT_PORT, PLATFORM_PACKAGES, and other constants
- Root package.json — engines.node version

### Key features to verify docs cover:

- **Multi-instance plugins**: url-type config fields accept Record<string, string> (instance name → URL), instance parameter injection on tools, per-tab config resolution, plugin_list_tabs instance labels
- **CLI tool interface**: `opentabs tool list`, `opentabs tool schema`, `opentabs tool call` commands
- **MCP gateway**: /mcp/gateway endpoint with opentabs_list_tools and opentabs_call meta-tools
- **Three connection modes**: full MCP (/mcp), gateway MCP (/mcp/gateway), CLI-only (opentabs tool call)

### What NOT to report (domain-specific):

- Stylistic rewording that does not fix an inaccuracy
- Adding documentation for internal implementation details users don't need
- Bumping `lastUpdated` without accompanying content changes

## Step 4: Create PRD(s) using the ralph skill

Use the skill tool to load the "ralph" skill, then follow its instructions to create PRD(s) for the docs project.

Key parameters for docs PRDs:
- Target project: "OpenTabs Docs"
- workingDirectory: "docs"
- qualityChecks: "cd docs && npm run build && npm run type-check && npm run lint && npm run knip && npm run format:check"
- All stories: e2eCheckpoint: false (docs has no E2E tests)
- When updating illustrations, include specific component names and exact text changes in acceptance criteria
- Group illustration fixes by topic
PROMPT_EOF

echo "=== perfect-docs.sh ==="
echo "Launching Claude to audit docs/ and create PRD(s)..."
echo ""

echo "$PROMPT" | bash "$SCRIPT_DIR/run-prompt.sh"
