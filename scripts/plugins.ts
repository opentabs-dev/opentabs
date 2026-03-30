/**
 * Build or check all plugins under plugins/.
 *
 * Usage:
 *   tsx scripts/plugins.ts --build                        # Install deps + build each plugin
 *   tsx scripts/plugins.ts --check                        # Type-check + lint + format:check each plugin
 *   tsx scripts/plugins.ts --build --filter=slack,discord  # Build only named plugins
 *   tsx scripts/plugins.ts --build --affected              # Build only plugins with outdated SDK
 *   tsx scripts/plugins.ts --build --filter=slack --affected # Intersection: named AND affected
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_HOST, DEFAULT_PORT, getConfigDir, getConfigPath, platformExec } from '@opentabs-dev/shared';

const repoRoot = join(import.meta.dirname, '..');
const pluginsDir = join(repoRoot, 'plugins');

const mode = process.argv.includes('--build') ? 'build' : process.argv.includes('--check') ? 'check' : null;

if (!mode) {
  console.error('Usage: tsx scripts/plugins.ts --build | --check');
  process.exit(1);
}

// Find plugin directories containing a package.json
let pluginDirs: string[] = [];
for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    const pkgPath = join(pluginsDir, entry.name, 'package.json');
    if (existsSync(pkgPath)) {
      pluginDirs.push(entry.name);
    }
  }
}

pluginDirs.sort();

// --filter=name1,name2: build/check only named plugins
const filterArg = process.argv.find(a => a.startsWith('--filter='));
if (filterArg) {
  const names = new Set(filterArg.slice('--filter='.length).split(','));
  const unknown = [...names].filter(n => !pluginDirs.includes(n));
  if (unknown.length > 0) {
    console.error(`Unknown plugin(s): ${unknown.join(', ')}`);
    console.error(`Available: ${pluginDirs.join(', ')}`);
    process.exit(1);
  }
  pluginDirs = pluginDirs.filter(d => names.has(d));
}

// --affected: only plugins whose installed SDK version differs from current
if (process.argv.includes('--affected')) {
  const sdkPkgPath = join(repoRoot, 'platform/plugin-sdk/package.json');
  const currentSdkVersion = (JSON.parse(readFileSync(sdkPkgPath, 'utf-8')) as Record<string, unknown>)
    .version as string;
  pluginDirs = pluginDirs.filter(name => {
    const lockPath = join(pluginsDir, name, 'package-lock.json');
    if (!existsSync(lockPath)) return true;
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as Record<string, unknown>;
      const packages = lock.packages as Record<string, Record<string, unknown>> | undefined;
      const installed = packages?.['node_modules/@opentabs-dev/plugin-sdk']?.version;
      if (installed === currentSdkVersion) {
        console.log(`  ${name}: up to date (SDK v${currentSdkVersion})`);
        return false;
      }
      return true;
    } catch {
      return true;
    }
  });
  if (pluginDirs.length === 0) {
    console.log(`All plugins are up to date with SDK v${currentSdkVersion}`);
    process.exit(0);
  }
}

if (pluginDirs.length === 0) {
  console.log('No plugins found.');
  process.exit(0);
}

const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const notifyServerOnce = async (): Promise<void> => {
  const configDir = getConfigDir();
  const authJsonPath = join(configDir, 'extension', 'auth.json');

  let secret: string | undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(authJsonPath, 'utf-8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.secret === 'string') secret = record.secret;
    }
  } catch {
    return;
  }
  if (!secret) return;

  let port: number;
  const portEnv = process.env.OPENTABS_PORT;
  if (portEnv !== undefined) {
    port = Number(portEnv);
  } else {
    let configPort: number | null = null;
    try {
      const raw = readFileSync(getConfigPath(), 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const p = (parsed as Record<string, unknown>).port;
        if (typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535) {
          configPort = p;
        }
      }
    } catch {
      // Config file missing or invalid — use default
    }
    port = configPort ?? DEFAULT_PORT;
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) return;

  try {
    const res = await fetch(`http://${DEFAULT_HOST}:${port}/reload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      console.log(`\n${CYAN}Notified MCP server to reload plugins.${RESET}`);
    }
  } catch {
    // Server not running — ignore
  }
};

const failed: string[] = [];

const runInPlugin = (pluginName: string, cmd: string[], extraEnv?: Record<string, string>): Promise<boolean> => {
  const [bin = '', ...args] = cmd;
  const proc = spawn(platformExec(bin), args, {
    cwd: join(pluginsDir, pluginName),
    stdio: ['ignore', 'inherit', 'inherit'],
    env: extraEnv ? { ...process.env, ...extraEnv } : undefined,
  });
  return new Promise(resolve => {
    proc.on('close', code => resolve(code === 0));
  });
};

for (const pluginName of pluginDirs) {
  console.log(`\n${CYAN}${BOLD}── ${pluginName} ──${RESET}\n`);

  let success: boolean;

  if (mode === 'build') {
    const skipNotify = { OPENTABS_SKIP_NOTIFY: '1' };
    success =
      (await runInPlugin(pluginName, ['npm', 'install'])) &&
      (await runInPlugin(pluginName, ['npm', 'run', 'build'], skipNotify));
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

if (mode === 'build' && failed.length === 0) {
  await notifyServerOnce();
}

if (failed.length > 0) {
  console.error(`${RED}${BOLD}Failed plugins: ${failed.join(', ')}${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}All ${pluginDirs.length} plugins passed.${RESET}`);
}
