/**
 * Build or check all plugins under plugins/.
 *
 * Usage:
 *   bun scripts/plugins.ts --build    # Install deps + build each plugin
 *   bun scripts/plugins.ts --check    # Type-check + lint + format:check each plugin
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const pluginsDir = join(repoRoot, 'plugins');

const mode = Bun.argv.includes('--build') ? 'build' : Bun.argv.includes('--check') ? 'check' : null;

if (!mode) {
  console.error('Usage: bun scripts/plugins.ts --build | --check');
  process.exit(1);
}

// Find plugin directories containing a package.json
const pluginDirs: string[] = [];
for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    const pkgPath = join(pluginsDir, entry.name, 'package.json');
    if (await Bun.file(pkgPath).exists()) {
      pluginDirs.push(entry.name);
    }
  }
}

pluginDirs.sort();

if (pluginDirs.length === 0) {
  console.log('No plugins found.');
  process.exit(0);
}

const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const failed: string[] = [];

const runInPlugin = async (pluginName: string, cmd: string[]): Promise<boolean> => {
  const proc = Bun.spawn(cmd, {
    cwd: join(pluginsDir, pluginName),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const exitCode = await proc.exited;
  return exitCode === 0;
};

for (const pluginName of pluginDirs) {
  console.log(`\n${CYAN}${BOLD}── ${pluginName} ──${RESET}\n`);

  let success: boolean;

  if (mode === 'build') {
    success =
      (await runInPlugin(pluginName, ['bun', 'install', '--frozen-lockfile'])) &&
      (await runInPlugin(pluginName, ['bun', 'run', 'build']));
  } else {
    success =
      (await runInPlugin(pluginName, ['bun', 'run', 'type-check'])) &&
      (await runInPlugin(pluginName, ['bun', 'run', 'lint'])) &&
      (await runInPlugin(pluginName, ['bun', 'run', 'format:check']));
  }

  if (success) {
    console.log(`\n${GREEN}${BOLD}✓ ${pluginName}${RESET}`);
  } else {
    console.log(`\n${RED}${BOLD}✗ ${pluginName}${RESET}`);
    failed.push(pluginName);
  }
}

console.log('');

if (failed.length > 0) {
  console.error(`${RED}${BOLD}Failed plugins: ${failed.join(', ')}${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}All ${pluginDirs.length} plugins passed.${RESET}`);
}
