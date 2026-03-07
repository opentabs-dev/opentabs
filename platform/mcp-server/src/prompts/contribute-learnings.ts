/**
 * contribute_learnings prompt — standalone workflow for writing learnings back
 * into the MCP server source code after completing any task.
 *
 * This prompt enables the self-improvement loop: AI agents that complete tasks
 * (plugin development, troubleshooting, setup, etc.) write their discoveries
 * back into the source files that compile into resources and prompts served
 * by this MCP server. Every future AI session then receives those learnings
 * automatically.
 */

export const contributeLearningsPromptText = (task: string): string => {
  const taskClause = task
    ? `You just completed a task: "${task}"\n\nReview what you learned and write it back into the appropriate source files.`
    : 'Review your recent session for new patterns, gotchas, and techniques, then write them back into the appropriate source files.';

  return `${taskClause}

The embedded \`opentabs://guide/self-improvement\` resource below contains the complete file-to-content mapping, contribution rules, and architecture explanation. Read it first.

---

## Step 1: Identify What You Learned

Review your session for:

- **New patterns** — auth extraction techniques, API discovery methods, Zod schema tricks
- **Gotchas** — things that didn't work as expected, subtle bugs, non-obvious behaviors
- **Resolution steps** — how you fixed an error that isn't documented yet
- **Missing documentation** — things you had to figure out that should have been written down
- **Workflow improvements** — steps that should be added to existing prompts

---

## Step 2: Choose the Right File

Consult the file-to-content mapping in the embedded \`opentabs://guide/self-improvement\` resource to find the correct source file for your learnings.

---

## Step 3: Write the Learnings

**Rules:**
1. **Check for duplicates** — read the target file first; scan existing content before adding
2. **Keep learnings generic** — no app-specific details (e.g., no "Notion uses space IDs")
3. **Be concise and factual** — write for AI consumption, not human narratives
4. **Add to the right section** — place gotchas in gotcha lists, patterns in pattern sections
5. **Preserve existing structure** — match the formatting and style of surrounding content

---

## Step 4: Verify

After editing, verify the server builds:

\`\`\`bash
cd platform/mcp-server && npm run build
\`\`\`

The build must succeed. If it fails, fix the issue before committing.

---

## Step 5: Do NOT Write to Local Files

Write learnings ONLY to the TypeScript source files listed in the self-improvement guide. Do NOT write to:
- Local markdown files or skill files
- \`CLAUDE.md\` files (those are for platform contributors, not MCP-served content)
- Documentation site (\`docs/\`) — that's for humans, not AI agents
- Temporary files or scratch notes

The reason: only the source files in \`platform/mcp-server/src/\` compile into MCP content. Anything written elsewhere is invisible to future AI sessions.`;
};
