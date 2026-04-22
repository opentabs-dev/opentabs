/**
 * Bundle the background service worker and offscreen document.
 *
 * Chrome extension module service workers cannot resolve bare module specifiers
 * (e.g., '@opentabs-dev/shared'). The tsc build emits these as-is, so a
 * bundling step is needed to resolve them into self-contained files.
 *
 * Runs AFTER tsc (which produces dist/ with type-checked JS) and BEFORE the
 * extension is loaded into Chrome. Each entry point is bundled into its
 * original dist/ location, overwriting the tsc output.
 *
 * Because the bundle overwrites the tsc-emitted entry points, subsequent
 * incremental `tsc --build` runs may skip re-emitting them (the source files
 * haven't changed, even though the on-disk output was replaced by a bundle).
 * To guarantee esbuild always receives fresh tsc output with resolvable
 * imports, we delete the entry points and the tsbuildinfo, then re-run
 * `tsc --build` for this project before bundling.
 */

import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'esbuild';
import { build } from 'esbuild';
import { DEV_RELOAD_PORT } from '../../scripts/dev-reload-constants.ts';

const base = import.meta.dirname;

const bgPath = join(base, 'dist/background.js');
const offscreenPath = join(base, 'dist/offscreen/index.js');
const tokenInterceptorPath = join(base, 'dist/token-interceptor.js');
const tsbuildinfo = join(base, 'tsconfig.tsbuildinfo');

const entries = [
  { entrypoint: bgPath, outfile: bgPath, label: 'background' },
  { entrypoint: offscreenPath, outfile: offscreenPath, label: 'offscreen' },
  { entrypoint: tokenInterceptorPath, outfile: tokenInterceptorPath, label: 'token-interceptor' },
];

// Delete stale bundle artifacts and tsbuildinfo so tsc re-emits fresh entry
// points with resolvable import statements for esbuild to bundle.
for (const f of [bgPath, offscreenPath, tokenInterceptorPath, tsbuildinfo]) {
  try {
    unlinkSync(f);
  } catch {
    // File may not exist on first build — ignore
  }
}
execSync('npx tsc --build', { cwd: base, stdio: 'inherit' });

const isDev = process.env.OPENTABS_DEV === '1';

// In dev mode, prepend the dev reload WebSocket client to the background bundle.
// The client connects to the relay server and triggers chrome.runtime.reload()
// on DO_UPDATE signals with id 'extension'. The banner is injected as raw text
// (not processed by esbuild), so __DEV_RELOAD_PORT__ is replaced via string substitution.
let devBgBanner = '';
if (isDev) {
  const clientPath = join(base, 'src/dev/reload-background.js');
  devBgBanner = readFileSync(clientPath, 'utf-8').replaceAll('__DEV_RELOAD_PORT__', String(DEV_RELOAD_PORT));
}

/**
 * esbuild plugin that marks `node:*` imports as external with no side effects.
 *
 * @opentabs-dev/shared re-exports runtime utilities that have top-level
 * `import` statements from Node.js builtins (child_process, crypto, fs, etc.).
 * The extension never calls these functions — it only uses shared constants
 * and browser-safe helpers like `toErrorMessage`.
 *
 * Using plain `external: ['node:*']` left bare `import ... from "node:*"` in
 * the output because esbuild assumed they might have side effects. By marking
 * them as `sideEffects: false`, esbuild can tree-shake the import statements
 * entirely when none of the imported bindings are used.
 */
const stubNodeBuiltins: Plugin = {
  name: 'stub-node-builtins',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^node:/ }, args => ({
      path: args.path,
      external: true,
      sideEffects: false,
    }));
  },
};

let failed = false;

for (const { entrypoint, outfile, label } of entries) {
  try {
    // Only inject the dev reload client into the background bundle — the
    // offscreen document does not need its own reload client since it is
    // destroyed when the extension reloads.
    const banner = label === 'background' && devBgBanner ? { js: devBgBanner } : undefined;

    // Bundling resolves bare specifiers (e.g., @opentabs-dev/shared) and
    // relative imports into a single self-contained file.
    // chrome.* APIs are globals — they don't need to be imported/resolved.
    await build({
      entryPoints: [entrypoint],
      outfile,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      minify: false,
      // Write directly to the exact output path, overwriting the tsc-produced file.
      allowOverwrite: true,
      banner,
      plugins: [stubNodeBuiltins],
    });

    console.log(`[opentabs:build:${label}] Bundled successfully`);
  } catch (error: unknown) {
    console.error(`[opentabs:build:${label}] Bundle failed:`);
    console.error(error);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
