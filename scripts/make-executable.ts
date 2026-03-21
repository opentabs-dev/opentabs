/**
 * Set executable permissions on CLI entry points. No-op on Windows
 * where file permissions are not relevant for Node.js scripts.
 *
 * Usage: tsx scripts/make-executable.ts
 */

import { chmodSync } from 'node:fs';
import { platform } from 'node:os';

if (platform() === 'win32') process.exit(0);

const files = ['platform/cli/dist/cli.js', 'platform/plugin-tools/dist/cli.js', 'platform/create-plugin/dist/index.js'];

for (const file of files) {
  chmodSync(file, 0o755);
}
