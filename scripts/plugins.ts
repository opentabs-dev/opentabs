/**
 * Build or check all plugins under plugins/.
 *
 * Usage:
 *   tsx scripts/plugins.ts --build    # Install deps + build each plugin
 *   tsx scripts/plugins.ts --check    # Type-check + lint + format:check each plugin
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const pluginsDir = join(repoRoot, 'plugins');

const mode = process.argv.includes('--build') ? 'build' : process.argv.includes('--check') ? 'check' : null;

if (!mode) {
  console.error('Usage: tsx scripts/plugins.ts --build | --check');
  process.exit(1);
}

// Find plugin directories containing a package.json
const pluginDirs: string[] = [];
for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    const pkgPath = join(pluginsDir, entry.name, 'package.json');
    if (existsSync(pkgPath)) {
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

const runInPlugin = (pluginName: string, cmd: string[]): Promise<boolean> => {
  const [bin = '', ...args] = cmd;
  const proc = spawn(bin, args, {
    cwd: join(pluginsDir, pluginName),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return new Promise(resolve => {
    proc.on('close', code => resolve(code === 0));
  });
};

for (const pluginName of pluginDirs) {
  console.log(`\n${CYAN}${BOLD}── ${pluginName} ──${RESET}\n`);

  let success: boolean;

  if (mode === 'build') {
    success =
      (await runInPlugin(pluginName, ['npm', 'install'])) && (await runInPlugin(pluginName, ['npm', 'run', 'build']));
  } else {
    success =
      (await runInPlugin(pluginName, ['npm', 'run', 'type-check'])) &&
      (await runInPlugin(pluginName, ['npm', 'run', 'lint'])) &&
      (await runInPlugin(pluginName, ['npm', 'run', 'format:check']));
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
