# Bump Version Skill — Maintenance Guide

## File Structure

```
.claude/skills/bump-version/
├── SKILL.md          # Stub with frontmatter (loaded by AI clients at session start)
├── __SKILL__.md      # Actual skill content (read on-demand for latest version)
└── CLAUDE.md         # This file — maintenance instructions
```

## How It Works

AI clients load `SKILL.md` once at session start and cache its frontmatter + content in memory. To ensure the AI always gets the latest skill instructions (even if the skill was updated after the session started), `SKILL.md` is a lightweight stub that tells the AI to read `__SKILL__.md` at execution time.

- **`SKILL.md`**: Contains only the YAML frontmatter (name, description, triggers) and an instruction to read `__SKILL__.md`. Do NOT put actual skill logic here.
- **`__SKILL__.md`**: Contains the full skill instructions — the version bump workflow, file inventory, and verification steps. This is the file to edit when updating the skill.

## Updating the Skill

When you need to update the bump-version skill content:

1. **Edit `__SKILL__.md`** — this is the single source of truth for skill behavior
2. **Do NOT edit `SKILL.md`** unless you need to change the skill's name, description, or trigger keywords in the frontmatter
3. Changes to `__SKILL__.md` take effect immediately for any AI session that invokes the skill, since the AI reads it fresh each time

## When to Update This Skill

Update `__SKILL__.md` when:

- A new platform package is added to `platform/`
- A new plugin is added to `plugins/`
- The dependency graph between packages changes
- The version referencing pattern changes (e.g., if plugins switch from `^x.y.z` to `workspace:` protocol)
- New files with hardcoded versions are discovered

## Why This Pattern Exists

Some AI clients (e.g., Claude Code with the `skill` tool) load skill files into memory once at the start of a session. If the skill content is updated mid-session, the AI continues using the stale cached version. By keeping `SKILL.md` as a stub that redirects to `__SKILL__.md`, the actual content is read on-demand via the Read tool, guaranteeing the latest version is always used.
