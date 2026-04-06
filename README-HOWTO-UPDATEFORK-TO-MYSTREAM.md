# How to update this fork from upstream opentabs

This repo (`raffishquartan/opentabs-rq`) is a fork of `opentabs-dev/opentabs`. While a PR is pending upstream, rebase `main` onto the latest upstream release tag periodically so the fork stays current and the PR branch rebases cleanly.

After the PR is merged upstream you can retire this loop and either (a) keep rebasing on each upstream release, or (b) switch the Claude Code startup hook (`~/repos/claude-code-config-sync/hooks/session-start/start-opentabs.sh`) back to a plain upstream checkout and delete this fork.

## One-off setup

Run once per clone:

```bash
cd ~/repos/opentabs-rq
git remote add upstream https://github.com/opentabs-dev/opentabs.git
git fetch upstream --tags
```

Verify:

```bash
git remote -v
# origin    git@github.com:raffishquartan/opentabs-rq.git (fetch/push)
# upstream  https://github.com/opentabs-dev/opentabs.git  (fetch/push)
```

## Per-rebase cycle

Run each time you want to pull in upstream changes.

### 0. Verify clean tree

```bash
cd ~/repos/opentabs-rq
git status
```

Stash or commit any local work before proceeding.

### 1. Fetch latest upstream tags

```bash
git fetch upstream --tags --prune --prune-tags
```

### 2. Identify the latest upstream release tag

Use semver sorting (not lexical) so `v0.0.9` doesn't beat `v0.0.88`.

```bash
export OPENTABS_LATEST_VERSION=$(git -c versionsort.suffix=- \
    ls-remote --tags --refs --sort=-v:refname upstream 'v*' \
    | head -n1 | sed 's|.*refs/tags/||')
echo "Latest upstream tag: $OPENTABS_LATEST_VERSION"
```

**Why not `git tag | egrep '^v' | tail -n1`?** That sorts lexically, so `v0.0.9` would sort *after* `v0.0.88` and you would pick up the wrong "latest". `--sort=-v:refname` is semver-aware.

**Why not `upstream/$OPENTABS_LATEST_VERSION`?** The `upstream/` prefix only works for remote-tracking *branches* (e.g. `upstream/main`). Tags live in a single global namespace after fetch - the correct ref is just `$OPENTABS_LATEST_VERSION` (or equivalently `refs/tags/$OPENTABS_LATEST_VERSION`).

### 3. Preview what is coming

First check whether your `main` is already ahead of the upstream tag. This fork merges upstream `ralph-*` automation branches directly, so `main` often already contains everything that eventually gets tagged upstream.

```bash
# Is the upstream tag already an ancestor of main? (exit 0 = yes)
git merge-base --is-ancestor "$OPENTABS_LATEST_VERSION" main \
    && echo "main already contains $OPENTABS_LATEST_VERSION - skip rebase" \
    || echo "main does NOT contain $OPENTABS_LATEST_VERSION - rebase needed"

# How far apart? Output format: "<behind> <ahead>"
git rev-list --left-right --count "$OPENTABS_LATEST_VERSION...main"
```

Then preview the commits in each direction:

```bash
# What's on the upstream tag but not on main (i.e. what you would pull in)
git log --oneline "main..$OPENTABS_LATEST_VERSION"

# What's on main but not on the upstream tag (your fork's lead)
git log --oneline "$OPENTABS_LATEST_VERSION..main" | head -30
```

**If `main..$OPENTABS_LATEST_VERSION` is empty**: `main` is already at-or-ahead of upstream. Nothing to rebase. Skip to step 8 (rebuild) - you still want to rebuild so the on-disk `dist/` and extension bundle match the current source.

**Otherwise**: review the incoming commits for anything worrying (security-sensitive changes, new privileged tools, large refactors that will conflict with your PR work), then continue to step 4.

### 4. Safety branch

```bash
git branch "backup/pre-rebase-$(date +%Y%m%d)" main
```

If the rebase goes badly:

```bash
git rebase --abort
git reset --hard backup/pre-rebase-<date>
```

### 5. Rebase main onto the upstream tag

```bash
git checkout main
git rebase "$OPENTABS_LATEST_VERSION"
```

If conflicts: resolve them, `git add <files>`, `git rebase --continue`.

### 6. Force-push to your fork

ONLY push to `origin` (your fork). Never to `upstream`.

```bash
git push --force-with-lease origin main
```

`--force-with-lease` refuses the push if the remote has moved since your last fetch, which protects against clobbering work pushed from another machine.

### 7. Rebase your PR branch on top of main

If you have a live PR branch in flight:

```bash
git checkout <your-pr-branch>
git rebase main
git push --force-with-lease origin <your-pr-branch>
```

### 8. Rebuild

From the repo root, run the top-level build. This runs `tsc --build` across the monorepo, bundles the browser extension, generates icons, recomputes the extension hash (v0.0.87+ depends on this), installs the extension, and rebuilds the CLI.

```bash
cd ~/repos/opentabs-rq
npm install
npm run build
```

If something is out of sync and you hit stale-build issues:

```bash
npm run clean
npm run build:force
```

Do NOT use `npm run --prefix platform/cli build` on its own - that only runs `tsc --build` in `platform/cli/` and skips the extension bundle + hash recomputation.

### 9. Restart the opentabs server

The Claude Code SessionStart hook at `~/repos/claude-code-config-sync/hooks/session-start/start-opentabs.sh` will auto-restart the server on the next session launch, so the easiest path is just stop it and open a new Claude Code session:

```bash
node ~/repos/opentabs-rq/platform/cli/dist/cli.js stop 2>/dev/null || true
```

Or restart manually now (mirrors what the hook does, with telemetry opt-out):

```bash
OPENTABS_TELEMETRY_DISABLED=1 nohup \
    node ~/repos/opentabs-rq/platform/cli/dist/cli.js start \
    >/dev/null 2>&1 &
disown
```

### 10. Smoke test

```bash
node ~/repos/opentabs-rq/platform/cli/dist/cli.js status
```

And in a Claude Code session, exercise a benign OpenTabs tool (e.g. `browser_list_tabs`) to confirm the server is responding.

## Troubleshooting

- **`fatal: ambiguous argument 'main..upstream/v0.0.88'`**: you used the remote-prefix form for a tag. Drop the `upstream/` prefix - tags are global after fetch. See step 2.
- **Rebase conflicts in generated files** (e.g. `platform/cli/dist/*`, browser-extension bundles, `tsbuildinfo` files): take upstream's version and re-run `npm run build`. These files are build artifacts - never hand-merge them.
- **Extension hash drift warning after upgrade**: re-run `npm run build` from the repo root. The hash is recomputed by `scripts/compute-extension-hash.ts` as part of the top-level build.
- **Server won't start after upgrade**: check `node ~/repos/opentabs-rq/platform/cli/dist/cli.js status`, look for stale lock files under `~/.opentabs/`, and check logs.
