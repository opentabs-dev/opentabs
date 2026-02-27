/**
 * Wrapper for `bun --hot platform/mcp-server/dist/index.js --dev` that checks
 * for the existence of the dist/ output before starting. Provides a clear error
 * message if the project hasn't been built yet, instead of a cryptic module
 * resolution failure.
 *
 * Invoked via the "dev:mcp" script in package.json.
 *
 * Note: The bun --hot invocation will be replaced by the Node.js proxy dev
 * server in a subsequent story (US-005).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const distPath = resolve(ROOT, 'platform', 'mcp-server', 'dist', 'index.js');

if (!existsSync(distPath)) {
  console.error('Error: platform/mcp-server/dist/index.js not found.');
  console.error('Run `bun run build` first to compile the project.');
  process.exit(1);
}

const proc = spawn('bun', ['--hot', distPath, '--dev'], {
  stdio: ['inherit', 'inherit', 'inherit'],
});

proc.on('close', code => {
  process.exit(code ?? 0);
});
