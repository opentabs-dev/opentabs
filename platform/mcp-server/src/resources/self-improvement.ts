/**
 * Self-improvement guide resource — explains how the MCP server's AI-facing
 * content forms a self-improving loop and how agents contribute back.
 *
 * This resource is served at `opentabs://guide/self-improvement` and is
 * designed so any connected AI agent can discover the contribution architecture
 * without needing a human to explain it.
 */

export const SELF_IMPROVEMENT_CONTENT = `# Self-Improvement Architecture

## How It Works

The OpenTabs MCP server serves AI-facing content through three mechanisms:

| Mechanism | MCP method | When delivered | Source files |
|---|---|---|---|
| **Instructions** | \`initialize\` response | Pushed to every session automatically | \`platform/mcp-server/src/mcp-setup.ts\` (\`SERVER_INSTRUCTIONS\` constant) |
| **Resources** | \`resources/read\` | Pulled on demand by the client | \`platform/mcp-server/src/resources/*.ts\` |
| **Prompts** | \`prompts/get\` | User-triggered (slash commands, explicit invocation) | \`platform/mcp-server/src/prompts/*.ts\` |

These source files are **TypeScript string constants** that compile into the content this server serves. When an AI agent edits them and the server rebuilds, every future AI session receives those edits automatically. This creates a self-improving loop — each session that builds a plugin, fixes an issue, or discovers a gotcha makes every subsequent session better.

## The Contribution Cycle

1. **AI receives context** — on connect, the server pushes instructions. During a task, the AI fetches resources and invokes prompts for detailed guidance.
2. **AI completes a task** — building a plugin, troubleshooting an issue, configuring the platform.
3. **AI writes learnings back** — edits the TypeScript source files that compile into resources and prompts.
4. **Server rebuilds** — the edited files produce updated content.
5. **Next AI session benefits** — receives the improved instructions, resources, and prompts.

## File-to-Content Mapping

| What you learned | Write to | Served as |
|---|---|---|
| Plugin dev patterns, gotchas, conventions | \`platform/mcp-server/src/resources/plugin-development.ts\` | \`opentabs://guide/plugin-development\` resource |
| Plugin dev workflow steps, code templates | \`platform/mcp-server/src/prompts/build-plugin.ts\` | \`build_plugin\` prompt |
| Icon handling patterns | \`platform/mcp-server/src/prompts/plugin-icon.ts\` | \`plugin_icon\` prompt |
| Troubleshooting patterns, error resolution | \`platform/mcp-server/src/resources/troubleshooting.ts\` | \`opentabs://guide/troubleshooting\` resource |
| Troubleshooting workflow improvements | \`platform/mcp-server/src/prompts/troubleshoot.ts\` | \`troubleshoot\` prompt |
| Plugin setup patterns | \`platform/mcp-server/src/prompts/setup-plugin.ts\` | \`setup_plugin\` prompt |
| CLI or config changes | \`platform/mcp-server/src/resources/cli.ts\` | \`opentabs://reference/cli\` resource |
| SDK utility additions | \`platform/mcp-server/src/resources/sdk-api.ts\` | \`opentabs://reference/sdk-api\` resource |
| Browser tool documentation | \`platform/mcp-server/src/resources/browser-tools.ts\` | \`opentabs://reference/browser-tools\` resource |
| Quick start improvements | \`platform/mcp-server/src/resources/quick-start.ts\` | \`opentabs://guide/quick-start\` resource |
| Self-improvement loop changes | \`platform/mcp-server/src/resources/self-improvement.ts\` | \`opentabs://guide/self-improvement\` resource (this file) |
| Contribution workflow itself | \`platform/mcp-server/src/prompts/contribute-learnings.ts\` | \`contribute_learnings\` prompt |
| New workflow triggers or instruction gaps | \`platform/mcp-server/src/mcp-setup.ts\` (\`SERVER_INSTRUCTIONS\`) | MCP initialize instructions |
| Audit workflow improvements | \`platform/mcp-server/src/prompts/audit-ai-docs.ts\` | \`audit_ai_docs\` prompt |

## Rules for Contributing

1. **Check for duplicates** — read the target file first and scan existing content before adding.
2. **Keep learnings generic** — no app-specific details (e.g., no "Notion uses space IDs"). Write patterns that apply to any web app.
3. **Be concise and factual** — write for AI consumption, not human narratives.
4. **Add to the right section** — place gotchas in gotcha lists, patterns in pattern sections.
5. **Preserve existing structure** — match the formatting and style of surrounding content.
6. **Verify the build** — run \`cd platform/mcp-server && npm run build\` after editing. The build must succeed.
7. **Write ONLY to source files** — do not write to local markdown files, CLAUDE.md files, or the docs site. Only the source files listed above compile into MCP-served content.

## How to Trigger the Contribution Workflow

Invoke the \`contribute_learnings\` prompt:

\`\`\`
contribute_learnings(task: "brief description of what you just did")
\`\`\`

This prompt provides the full step-by-step workflow for identifying learnings, choosing the right file, writing the content, and verifying the build.

## Why This Matters for Bootstrapping

When you are asked to build a plugin for a web service, the \`build_plugin\` prompt provides a complete workflow including site analysis, API discovery, scaffolding, implementation, and testing. That workflow was written and refined by previous AI sessions — each one contributing patterns they discovered. After you finish building, you contribute back, and the next session receives your improvements.

This means the platform becomes progressively better at plugin development with each use, without requiring human intervention to update documentation or workflows.
`;
