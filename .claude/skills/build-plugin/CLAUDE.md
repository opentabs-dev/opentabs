# Build Plugin Skill — Maintenance Guide

## File Structure

```
.claude/skills/build-plugin/
├── SKILL.md          # Stub with frontmatter (loaded by AI clients at session start)
├── __SKILL__.md      # Actual skill content (read on-demand for latest version)
└── CLAUDE.md         # This file — maintenance instructions
```

## How It Works

AI clients load `SKILL.md` once at session start and cache its frontmatter + content in memory. To ensure the AI always gets the latest skill instructions (even if the skill was updated after the session started), `SKILL.md` is a lightweight stub that tells the AI to read `__SKILL__.md` at execution time.

- **`SKILL.md`**: Contains only the YAML frontmatter (name, description, triggers) and an instruction to read `__SKILL__.md`. Do NOT put actual skill logic here.
- **`__SKILL__.md`**: Contains the full skill instructions — the 7-phase plugin development workflow, code templates, gotchas, SDK reference, and auth patterns. This is the file to edit when updating the skill.

## Updating the Skill

When you need to update the build-plugin skill content:

1. **Edit `__SKILL__.md`** — this is the single source of truth for skill behavior
2. **Do NOT edit `SKILL.md`** unless you need to change the skill's name, description, or trigger keywords in the frontmatter
3. Changes to `__SKILL__.md` take effect immediately for any AI session that invokes the skill, since the AI reads it fresh each time

## Content Sources

This skill was created by combining three MCP server sources:

- **build_plugin prompt** (`platform/mcp-server/src/prompts/build-plugin.ts`) — 7-phase workflow, 20 gotchas, code templates
- **plugin-development resource** (`platform/mcp-server/src/resources/plugin-development.ts`) — architecture, SDK patterns, auth techniques, lifecycle hooks
- **sdk-api resource** (`platform/mcp-server/src/resources/sdk-api.ts`) — full SDK API reference

When discovering new patterns during plugin development, add them directly to `__SKILL__.md` in the appropriate section.
