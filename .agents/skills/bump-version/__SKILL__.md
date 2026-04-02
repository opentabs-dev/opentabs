# Bump Version

Bump package versions across all platform packages and plugins in lockstep.

All platform packages and plugins share the same version number (e.g., `0.0.82`). This skill triggers the GitHub Actions workflow that handles everything automatically.

---

## How to Execute This Skill

Publishing is automated via the **"Publish Platform Packages"** GitHub Actions workflow (`.github/workflows/publish-platform.yml`).

### Steps

1. **Determine the target version** — read the current version from any platform `package.json` (they're all in sync). For patch bumps, proceed immediately. For minor/major, confirm with the user.

2. **Trigger the workflow** — tell the user to go to GitHub Actions and run the workflow:
   - Go to **https://github.com/opentabs-dev/opentabs/actions/workflows/publish-platform.yml**
   - Click **"Run workflow"**
   - Enter the version number (e.g., `0.0.82`)
   - Click **"Run workflow"**

3. **The workflow handles everything:**
   - Bumps all 7 platform package versions
   - Deletes lockfile, reinstalls, force-builds
   - Runs quality checks (type-check, lint, test)
   - Publishes all 7 packages to npm in dependency order
   - Updates plugin deps to `^version`
   - Waits for npm registry propagation
   - Rebuilds all plugins with new deps
   - Commits version bumps + creates git tag
   - The tag push triggers the release workflow (auto-creates GitHub Release with notes)

That's it. No local setup, no npm auth, no manual steps.

---

## Versioning Model

- **All platform packages share one version** — bumped in lockstep.
- **All plugins reference platform packages via `^x.y.z` semver ranges** — updated automatically by the workflow.
- **Plugin versions are NOT bumped** — they have their own independent release lifecycle via the `publish-plugins.yml` workflow.
- **The docs site (`docs/`) has its own independent version** — do NOT bump it.
- **The root `package.json` has no version field** — leave it alone.

---

## Dependency Graph (for reference)

```
shared (leaf — no monorepo deps)
  ← plugin-sdk
  ← browser-extension
  ← mcp-server
  ← plugin-tools (also depends on plugin-sdk)
  ← cli (depends on all 5 above)
       ← create-plugin
```

---

## Dry Run

The workflow supports a `dry-run` option that bumps versions and builds but skips `npm publish`. Use this to verify the workflow works without publishing.
