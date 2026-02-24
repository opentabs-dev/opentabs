/**
 * Wrapper for `bun --hot platform/mcp-server/dist/index.js --dev` that checks
 * for the existence of the dist/ output before starting. Provides a clear error
 * message if the project hasn't been built yet, instead of a cryptic module
 * resolution failure from bun.
 *
 * Invoked via the "dev:mcp" script in package.json.
 */

import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const distPath = resolve(ROOT, 'platform', 'mcp-server', 'dist', 'index.js');

const exists = await Bun.file(distPath).exists();

if (!exists) {
  console.error('Error: platform/mcp-server/dist/index.js not found.');
  console.error('Run `bun run build` first to compile the project.');
  process.exit(1);
}

const proc = Bun.spawn(['bun', '--hot', distPath, '--dev'], {
  stdio: ['inherit', 'inherit', 'inherit'],
});

process.exit(await proc.exited);
