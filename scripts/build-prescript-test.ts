/**
 * Build the prescript-test E2E plugin with local platform packages.
 *
 * The prescript-test plugin depends on @opentabs-dev/plugin-sdk features
 * (./pre-script subpath export, getPreScriptValue) and @opentabs-dev/plugin-tools
 * build support (pre-script IIFE bundling) that were added in this release but
 * are not yet available in the published 0.0.103 packages. This script:
 *
 *   1. Installs the plugin's lockfile deps (npm ci --ignore-scripts).
 *   2. Overlays the local platform package dist files over the installed versions.
 *   3. Runs opentabs-plugin build to produce the adapter and pre-script IIFEs.
 *
 * Run as part of the test:e2e pipeline:
 *   tsx scripts/build-prescript-test.ts
 *
 * Once the new SDK features are published (next version bump), update the
 * plugin's package.json to the new published version and remove this script.
 */

import { execSync } from 'node:child_process';
import { cpSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pluginDir = path.join(root, 'plugins', 'prescript-test');
const nodeModulesOpentabs = path.join(pluginDir, 'node_modules', '@opentabs-dev');

// Step 1: Install lockfile deps (--ignore-scripts skips opentabs-plugin build
// which would fail without the local pre-script SDK features).
execSync('npm ci --ignore-scripts', { cwd: pluginDir, stdio: 'inherit' });

// Step 2: Overlay local platform package dist over the installed (published) versions.
for (const [pkg, pkgDir] of [
  ['plugin-sdk', path.join(root, 'platform', 'plugin-sdk')],
  ['plugin-tools', path.join(root, 'platform', 'plugin-tools')],
  ['shared', path.join(root, 'platform', 'shared')],
] as const) {
  const target = path.join(nodeModulesOpentabs, pkg);
  cpSync(path.join(pkgDir, 'dist'), path.join(target, 'dist'), { recursive: true, force: true });
  cpSync(path.join(pkgDir, 'package.json'), path.join(target, 'package.json'));
}

// Step 3: Build the plugin.
execSync('npm run build', {
  cwd: pluginDir,
  env: { ...process.env, OPENTABS_CONFIG_DIR: '/tmp/opentabs-e2e-prebuild' },
  stdio: 'inherit',
});
