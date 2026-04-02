# Build Plugin Skill — Maintenance Guide

## File Structure

```
.claude/skills/build-plugin/
├── SKILL.md          # Stub with frontmatter (loaded by AI clients at session start)
├── __SKILL__.md      # Actual skill content (read on-demand for latest version)
└── CLAUDE.md         # This file — maintenance instructions
```

## How It Works

`SKILL.md` is a lightweight stub with YAML frontmatter. AI clients cache it at session start. The stub instructs the AI to read `__SKILL__.md` on demand, ensuring the latest content is always used.

## Updating the Skill

Edit `__SKILL__.md` — the single source of truth. Changes take effect immediately. Only edit `SKILL.md` to change the name, description, or trigger keywords.

## Scope

This skill covers the full plugin lifecycle: building, icons, troubleshooting, setup, and writing learnings back. It consolidates content from the previously separate plugin-icon, troubleshoot, setup-plugin skills and the former MCP server prompts/resources.
