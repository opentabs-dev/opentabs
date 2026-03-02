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

1. **Determine the target version** — discover the current version by reading any platform `package.json` (they are all in sync). For **patch bumps**, proceed immediately without asking the user (e.g., `0.0.34` → `0.0.35`). For **minor or major bumps**, confirm the target version with the user before proceeding.
2. **Discover the current version** by reading any platform `package.json` (they are all in sync)
3. **Update all version references** (see "Files to Update" below)
4. **Update root lock file** — run `npm install --package-lock-only` at the repo root
5. **Scan for hardcoded version strings** in source code (see "Hardcoded Version Scan")
6. **Verify** — run `npm run build` and `npm run type-check` to confirm nothing broke
7. **Commit and push** the version bump
8. **Publish all platform packages** to npm in dependency order (see "Publishing" below)
9. **Update plugin lock files** — run `npm install` in each plugin directory (now that published packages are available)
10. **Rebuild plugins** — run `npm run build` in each plugin directory
11. **Commit and push** the plugin lock file updates

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

### Chrome Extension Manifest

The Chrome extension manifest version must match the platform version:

| File                                       | Field       |
| ------------------------------------------ | ----------- |
| `platform/browser-extension/manifest.json` | `"version"` |

**Edit:** Change `"version": "<old>"` to `"version": "<new>"`.

Chrome's `manifest.json` `version` field uses the same `x.y.z` format as `package.json`. This ensures the installed extension version stays in sync with the platform.

### Plugins (version field + dependency ranges in `package.json`)

Plugins are standalone (not in the npm workspace). They reference platform packages with `^x.y.z` semver ranges.

For each plugin in `plugins/*/package.json`, update:

1. `"version": "<old>"` → `"version": "<new>"`
2. `"@opentabs-dev/plugin-sdk": "^<old>"` → `"@opentabs-dev/plugin-sdk": "^<new>"` (in `dependencies`)
3. `"@opentabs-dev/plugin-tools": "^<old>"` → `"@opentabs-dev/plugin-tools": "^<new>"` (in `devDependencies`)

**After editing, verify no `file:` or `workspace:` references exist in any plugin:**

```bash
grep -r '"file:\|"workspace:' plugins/*/package.json
```

This must produce no output. Plugins must use `^x.y.z` semver ranges for `@opentabs-dev/*` dependencies — never local filesystem paths.

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

## Publishing

After the version bump is committed and pushed, publish all platform packages to npm.

### Prerequisites

Verify npm authentication before publishing:

```bash
npm whoami   # Must return an account with write access to @opentabs-dev
```

### Publish Order

Publish in strict dependency order — each package must be available on the registry before its dependents are published:

```
1. shared
2. browser-extension
3. mcp-server
4. plugin-sdk
5. plugin-tools
6. cli
7. create-plugin
```

### Publish Command

For each package, run from its directory:

```bash
cd platform/<package> && npm publish
```

### Post-Publish: Update Plugins

After all platform packages are published:

1. **Update plugin lock files**: `cd plugins/<name> && npm install` (resolves `^<new-version>` from the registry)
2. **Rebuild plugins**: `cd plugins/<name> && npm run build` (compiles with the new SDK version)
3. **Commit and push** the updated lock files

### npm Registry Propagation Delay

The npm registry does not guarantee immediate availability after `npm publish`. The new version may take seconds to a few minutes to propagate across all registry endpoints. If `npm install` in a plugin fails with `ETARGET` ("No matching version found for @opentabs-dev/...@^x.y.z"), this is a propagation delay — not a real error.

**Retry strategy:**

1. Wait 10 seconds, then retry `npm install`
2. If it still fails, wait 30 seconds and retry again
3. If it fails a third time, wait 60 seconds — by this point the registry has always caught up
4. Verify with `npm view @opentabs-dev/shared@<new-version> version` to confirm the version is visible on the registry before retrying

Do not skip the plugin lock file update or commit stale lock files. The retry is worth the wait.

**NEVER change npm package access levels** (public/private) without explicit user approval. All `@opentabs-dev` packages are private (`publishConfig.access: restricted`).

---

## Checklist

### Version Bump

- [ ] Target version confirmed with user
- [ ] All 7 platform `package.json` version fields updated
- [ ] Chrome extension `manifest.json` version updated
- [ ] All plugin `package.json` version fields updated
- [ ] All plugin `@opentabs-dev/plugin-sdk` dependency ranges updated
- [ ] All plugin `@opentabs-dev/plugin-tools` devDependency ranges updated
- [ ] Root `package-lock.json` updated (`npm install --package-lock-only`)
- [ ] Hardcoded version scan completed — no stale version strings in source code
- [ ] `npm run build` passes
- [ ] `npm run type-check` passes
- [ ] Version bump committed and pushed

### Publish

- [ ] `npm whoami` confirms authenticated with write access
- [ ] All 7 platform packages published in dependency order
- [ ] Plugin lock files updated (`npm install` in each plugin, with retry for registry propagation delay)
- [ ] Plugins rebuilt (`npm run build` in each plugin)
- [ ] Plugin lock file updates committed and pushed
