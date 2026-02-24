/**
 * Remove build artifacts from the repository.
 *
 * Usage:
 *   bun scripts/clean.ts          # Remove dist/, tsbuildinfo, generated icons
 *   bun scripts/clean.ts --all    # Above + node_modules, plugins/dist, docs artifacts
 */

import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const allMode = Bun.argv.includes('--all');

let removedCount = 0;

const remove = (absolutePath: string): void => {
  try {
    rmSync(absolutePath, { recursive: true, force: true });
    const relative = absolutePath.replace(repoRoot + '/', '');
    console.log(`  removed: ${relative}`);
    removedCount++;
  } catch {
    // Path does not exist — nothing to clean
  }
};

// ── Phase 1: Build artifacts (always) ──────────────────────────────────────

console.log('Cleaning build artifacts...\n');

// dist/ directories under platform/
const platformDir = join(repoRoot, 'platform');
for (const pkg of readdirSync(platformDir, { withFileTypes: true })) {
  if (pkg.isDirectory()) {
    remove(join(platformDir, pkg.name, 'dist'));
  }
}

// dist/ under e2e/
remove(join(repoRoot, 'e2e', 'dist'));

// Generated icons (produced by build:icons)
remove(join(repoRoot, 'platform', 'browser-extension', 'icons'));

// *.tsbuildinfo files under platform/
for (const pkg of readdirSync(platformDir, { withFileTypes: true })) {
  if (pkg.isDirectory()) {
    const pkgDir = join(platformDir, pkg.name);
    for (const file of readdirSync(pkgDir)) {
      if (file.endsWith('.tsbuildinfo')) {
        remove(join(pkgDir, file));
      }
    }
  }
}

// *.tsbuildinfo files under e2e/
const e2eDir = join(repoRoot, 'e2e');
try {
  for (const file of readdirSync(e2eDir)) {
    if (file.endsWith('.tsbuildinfo')) {
      remove(join(e2eDir, file));
    }
  }
} catch {
  // e2e/ may not exist
}

// Root-level tsbuildinfo files
for (const file of readdirSync(repoRoot)) {
  if (file.endsWith('.tsbuildinfo')) {
    remove(join(repoRoot, file));
  }
}

// ── Phase 2: Full clean (--all only) ───────────────────────────────────────

if (allMode) {
  console.log('\nCleaning node_modules and standalone projects...\n');

  // Root node_modules
  remove(join(repoRoot, 'node_modules'));

  // platform/*/node_modules (workspace symlinks)
  for (const pkg of readdirSync(platformDir, { withFileTypes: true })) {
    if (pkg.isDirectory()) {
      remove(join(platformDir, pkg.name, 'node_modules'));
    }
  }

  // plugins/*/node_modules and plugins/*/dist
  const pluginsDir = join(repoRoot, 'plugins');
  try {
    for (const plugin of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (plugin.isDirectory()) {
        remove(join(pluginsDir, plugin.name, 'node_modules'));
        remove(join(pluginsDir, plugin.name, 'dist'));
      }
    }
  } catch {
    // plugins/ may not exist
  }

  // docs artifacts
  remove(join(repoRoot, 'docs', 'node_modules'));
  remove(join(repoRoot, 'docs', '.next'));
  remove(join(repoRoot, 'docs', '.content-collections'));
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\nDone — removed ${removedCount} item${removedCount === 1 ? '' : 's'}.`);
