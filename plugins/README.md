# Plugins

Plugins in this directory are **fully standalone projects** — identical to what an external developer would get from `create-opentabs-plugin`. They depend on published `@opentabs-dev/*` npm packages and have their own toolchain.

## Excluded from root tooling

These plugins are **not** covered by the root `bun run build`, `bun run lint`, `bun run type-check`, `bun run format:check`, or `bun run knip`. Each plugin must be built and checked independently:

```bash
cd plugins/<name>
npm install
npm run build         # tsc + opentabs-plugin build
npm run type-check    # tsc --noEmit
npm run lint          # eslint
npm run format:check  # prettier
```

## Root-level commands

You can also build and check all plugins from the repo root:

```bash
bun run build:plugins   # Build all plugins (install + build each)
bun run check:plugins   # Type-check + lint + format:check all plugins
```

Each plugin also has a `check` script for running all quality checks at once:

```bash
cd plugins/<name>
npm run check   # build + type-check + lint + format:check
```

## Adding a new plugin

```bash
npx create-opentabs-plugin <name> --domain <domain>
```

Or manually: create a directory here following the same structure as the existing plugins.
