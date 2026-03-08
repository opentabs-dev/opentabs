# Plugin Icon Skill — Maintenance Guide

## File Structure

```
.claude/skills/plugin-icon/
├── SKILL.md          # Stub with frontmatter (loaded by AI clients at session start)
├── __SKILL__.md      # Actual skill content (read on-demand for latest version)
└── CLAUDE.md         # This file — maintenance instructions
```

## How It Works

AI clients load `SKILL.md` once at session start and cache its frontmatter + content in memory. To ensure the AI always gets the latest skill instructions (even if the skill was updated after the session started), `SKILL.md` is a lightweight stub that tells the AI to read `__SKILL__.md` at execution time.

- **`SKILL.md`**: Contains only the YAML frontmatter (name, description, triggers) and an instruction to read `__SKILL__.md`. Do NOT put actual skill logic here.
- **`__SKILL__.md`**: Contains the full skill instructions — the icon pipeline, SVG requirements, preparation steps, Simple Icons fallback, build and verification. This is the file to edit when updating the skill.

## Updating the Skill

When you need to update the plugin-icon skill content:

1. **Edit `__SKILL__.md`** — this is the single source of truth for skill behavior
2. **Do NOT edit `SKILL.md`** unless you need to change the skill's name, description, or trigger keywords in the frontmatter
3. Changes to `__SKILL__.md` take effect immediately for any AI session that invokes the skill, since the AI reads it fresh each time

## Content Sources

This skill was created from the MCP server prompt:

- **plugin_icon prompt** (`platform/mcp-server/src/prompts/plugin-icon.ts`) — icon pipeline, SVG requirements, preparation workflow, Simple Icons fallback, build and verification

When discovering new SVG techniques or icon gotchas, add them directly to `__SKILL__.md` in the appropriate section.
