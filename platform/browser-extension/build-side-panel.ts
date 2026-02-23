/**
 * Build script for the side panel React app.
 * Uses Bun.build to bundle React + JSX into a single file for the Chrome extension.
 */

import { join } from 'node:path';

const base = import.meta.dirname;
const outdir = join(base, 'dist/side-panel');

// Remove previous bundle to guarantee no stale output survives
await Bun.file(join(outdir, 'side-panel.js'))
  .delete()
  .catch(() => {});

const result = await Bun.build({
  entrypoints: [join(base, 'src/side-panel/index.tsx')],
  outdir,
  naming: 'side-panel.js',
  target: 'browser',
  format: 'esm',
  minify: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

if (!result.success) {
  console.error('[opentabs:build:side-panel] Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log('[opentabs:build:side-panel] Built successfully');
