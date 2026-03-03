/**
 * Build script for the side panel React app.
 * Uses esbuild to bundle React + JSX into a single file for the Chrome extension.
 */

import { readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import babel from 'esbuild-plugin-babel';
import { DEV_RELOAD_PORT } from '../../scripts/dev-reload-constants.ts';

const base = import.meta.dirname;
const outdir = join(base, 'dist/side-panel');
const outfile = join(outdir, 'side-panel.js');

const isDev = process.env.OPENTABS_DEV === '1';

// In dev mode, prepend the dev reload WebSocket client to the bundle.
// The client connects to the relay server and refreshes the page on
// DO_UPDATE signals, enabling hot UI reload without chrome.runtime.reload().
// The banner is injected as raw text (not processed by esbuild), so the
// __DEV_RELOAD_PORT__ placeholder is replaced via string substitution.
let devBanner = '';
if (isDev) {
  const clientPath = join(base, 'src/dev/reload-client.js');
  devBanner = readFileSync(clientPath, 'utf-8').replace('__DEV_RELOAD_PORT__', String(DEV_RELOAD_PORT));
}

// Remove previous bundle to guarantee no stale output survives
await unlink(outfile).catch(() => {});

await build({
  entryPoints: [join(base, 'src/side-panel/index.tsx')],
  outfile,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  minify: false,
  // Some dependencies (e.g., lucide-react/dynamic) expose bare .mjs subpath files
  // without a package.json "exports" map. esbuild needs .mjs in its resolve extensions
  // to find these files.
  resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.css', '.json'],
  external: ['node:*'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  banner: devBanner ? { js: devBanner } : undefined,
  plugins: [
    babel({
      filter: /\.[jt]sx?$/,
      config: {
        plugins: ['babel-plugin-react-compiler'],
        presets: ['@babel/preset-typescript', ['@babel/preset-react', { runtime: 'automatic' }]],
      },
    }),
  ],
});

console.log('[opentabs:build:side-panel] Built successfully');
