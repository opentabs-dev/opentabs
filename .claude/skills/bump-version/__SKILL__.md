# Bump Version

Bump package versions across all platform packages and plugins in lockstep.

All platform packages and plugins share the same version number (e.g., `0.0.34`). This skill bumps every package to a new version in a single coordinated change.

---

## Versioning Model

- **All platform packages share one version** — bumped in lockstep.
- **All plugins share that same version** — plugins also reference platform packages via `^x.y.z` semver ranges, which must be updated to match.
- **The docs site (`docs/`) has its own independent version** — do NOT bump it unless explicitly requested.
- **The root `package.json` has no version field** — leave it alone.

---

## The Job

1. **Ask the user for the target version** (suggest patch bump as default — e.g., `0.0.34` → `0.0.35`)
2. **Discover the current version** by reading any platform `package.json` (they are all in sync)
3. **Update all version references** (see "Files to Update" below)
4. **Update lock files** — run `npm install --package-lock-only` at the root. Plugin lock files cannot be updated until packages are published; note this to the user.
5. **Scan for hardcoded version strings** in source code (see "Hardcoded Version Scan")
6. **Verify** — run `npm run build` and `npm run type-check` to confirm nothing broke

---

## Files to Update

### Platform Packages (version field in `package.json`)

These packages all have a `"version"` field that must be bumped:

| Package                           | Path                                      |
| --------------------------------- | ----------------------------------------- |
| `@opentabs-dev/shared`            | `platform/shared/package.json`            |
| `@opentabs-dev/plugin-sdk`        | `platform/plugin-sdk/package.json`        |
| `@opentabs-dev/browser-extension` | `platform/browser-extension/package.json` |
| `@opentabs-dev/mcp-server`        | `platform/mcp-server/package.json`        |
| `@opentabs-dev/plugin-tools`      | `platform/plugin-tools/package.json`      |
| `@opentabs-dev/cli`               | `platform/cli/package.json`               |
| `@opentabs-dev/create-plugin`     | `platform/create-plugin/package.json`     |

**Edit:** Change `"version": "<old>"` to `"version": "<new>"` in each file.

### Plugins (version field + dependency ranges in `package.json`)

Plugins are standalone (not in the npm workspace). They reference platform packages with `^x.y.z` semver ranges.

For each plugin in `plugins/*/package.json`, update:

1. `"version": "<old>"` → `"version": "<new>"`
2. `"@opentabs-dev/plugin-sdk": "^<old>"` → `"@opentabs-dev/plugin-sdk": "^<new>"` (in `dependencies`)
3. `"@opentabs-dev/plugin-tools": "^<old>"` → `"@opentabs-dev/plugin-tools": "^<new>"` (in `devDependencies`)

### Dependency Graph (for reference)

Platform packages use `"*"` for intra-workspace dependencies (resolved by npm workspaces), so those do NOT need version updates. Only plugin `^x.y.z` references need updating.

```
shared (leaf — no monorepo deps)
  ← plugin-sdk
  ← browser-extension
  ← mcp-server
  ← plugin-tools (also depends on plugin-sdk)
  ← cli (depends on all 5 above)
       ← create-plugin
```

### Lock Files

- **Root `package-lock.json`**: Run `npm install --package-lock-only` at the repo root after all `package.json` edits.
- **Plugin `package-lock.json`**: These reference published versions (`^x.y.z`). They can only be updated after the platform packages are published to npm. Note this to the user — the plugin lock files will be updated when `npm install` is run after publishing.

---

## Hardcoded Version Scan

After updating `package.json` files, scan for any hardcoded version strings in source code:

```bash
grep -r '"<old-version>"' platform/ --include='*.ts' --include='*.tsx'
grep -r "'<old-version>'" platform/ --include='*.ts' --include='*.tsx'
```

If any are found, evaluate whether they should be replaced with a dynamic import (e.g., from `version.ts`) or updated to the new version. Prefer dynamic references over hardcoded strings — the MCP server already has a `version` module (`platform/mcp-server/src/version.ts`) that reads the version from `package.json` at runtime.

---

## Verification

After all edits:

```bash
npm run build        # Verify production build
npm run type-check   # TypeScript check
```

Both must exit 0. If they fail, fix the issue before considering the bump complete.

---

## Post-Bump: Publishing (informational)

Publishing is a separate step, not part of this skill. After the version bump is committed:

1. **Publish platform packages** in dependency order: shared → browser-extension → mcp-server → plugin-sdk → plugin-tools → cli → create-plugin
2. **Update plugin lock files**: `cd plugins/<name> && npm install`
3. **Rebuild plugins**: `cd plugins/<name> && npm run build`
4. **Publish plugins** (if applicable)

Refer to `platform/cli/CLAUDE.md` for publishing instructions and the `scripts/publish.sh` script (if it exists).

---

## Checklist

- [ ] Target version confirmed with user
- [ ] All 7 platform `package.json` version fields updated
- [ ] All plugin `package.json` version fields updated
- [ ] All plugin `@opentabs-dev/plugin-sdk` dependency ranges updated
- [ ] All plugin `@opentabs-dev/plugin-tools` devDependency ranges updated
- [ ] Root `package-lock.json` updated (`npm install --package-lock-only`)
- [ ] Hardcoded version scan completed — no stale version strings in source code
- [ ] `npm run build` passes
- [ ] `npm run type-check` passes
