/**
 * `opentabs update` command — update the CLI to the latest version.
 *
 * Shells out to `npm view` to check the latest published version (which
 * handles auth for private packages via ~/.npmrc), compares with the
 * currently installed version, and delegates to `npm install -g` for
 * the actual update. Warns if a server is running.
 */

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_PORT, platformExec, toErrorMessage } from '@opentabs-dev/shared';
import type { Command } from 'commander';
import pc from 'picocolors';
import { getPidFilePath, parsePidFile } from '../config.js';
import { resolvePort } from '../parse-port.js';

const CLI_PACKAGE_NAME = '@opentabs-dev/cli';

interface UpdateOptions {
  port?: number;
}

/** Read the currently installed CLI version from package.json. */
const getInstalledVersion = async (): Promise<string> => {
  const cliDir = dirname(fileURLToPath(import.meta.url));
  const pkgJson = JSON.parse(await readFile(join(cliDir, '..', '..', 'package.json'), 'utf-8')) as { version: string };
  return pkgJson.version;
};

/** Query the latest published version via `npm view`. */
const getLatestVersion = (): string => {
  const result = spawnSync(platformExec('npm'), ['view', CLI_PACKAGE_NAME, 'version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(`Failed to run npm: ${result.error.message}`);
  }
  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`npm view failed: ${stderr || `exit code ${exitCode}`}`);
  }
  return result.stdout.toString().trim();
};

interface ServerStatus {
  running: boolean;
  version?: string;
  mode?: string;
  serverType?: 'background' | 'dev' | 'foreground';
}

/** Returns true if a process with the given PID is alive. */
const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Detect whether a background server (via PID file) is currently running. */
const isBackgroundServerRunning = async (): Promise<boolean> => {
  const pidPath = getPidFilePath();
  let content: string;
  try {
    content = await readFile(pidPath, 'utf-8');
  } catch {
    return false;
  }
  const pidData = parsePidFile(content);
  return pidData !== null && isProcessAlive(pidData.pid);
};

/** Wait for a process to exit, polling every 200ms up to `timeoutMs`. */
const waitForExit = (pid: number, timeoutMs: number): Promise<boolean> =>
  new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      if (!isProcessAlive(pid)) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });

/** Stop the background server via SIGTERM and restart it with `opentabs start --background`. */
const restartBackgroundServer = async (port: number): Promise<void> => {
  const pidPath = getPidFilePath();
  let content: string;
  try {
    content = await readFile(pidPath, 'utf-8');
  } catch {
    console.log(pc.dim('  Run: opentabs start --background'));
    return;
  }
  const pidData = parsePidFile(content);
  if (pidData === null || !isProcessAlive(pidData.pid)) {
    console.log(pc.dim('  Run: opentabs start --background'));
    return;
  }

  const { pid } = pidData;
  const restartPort = pidData.port ?? port;

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ESRCH') {
      // Process already exited between the alive check and SIGTERM — proceed to restart.
    } else {
      throw err;
    }
  }
  const exited = isProcessAlive(pid) ? await waitForExit(pid, 5_000) : true;
  if (!exited) {
    console.log(pc.yellow('Warning: Old server did not stop in time. Restart manually:'));
    console.log(pc.dim('  opentabs start --background'));
    return;
  }

  const startArgs = ['start', '--background'];
  if (restartPort !== DEFAULT_PORT) {
    startArgs.push('--port', String(restartPort));
  }

  const cliEntry = process.argv[1];
  if (!cliEntry) {
    console.log(pc.yellow('Warning: Cannot determine CLI path. Run manually:'));
    console.log(pc.dim('  opentabs start --background'));
    return;
  }

  const result = spawnSync(platformExec('node'), [cliEntry, ...startArgs], {
    stdio: 'inherit',
  });

  if (result.error || (result.status ?? 1) !== 0) {
    console.log(pc.yellow('Warning: Failed to restart server. Run manually:'));
    console.log(pc.dim('  opentabs start --background'));
  }
};

/** Check if the MCP server is running on the given port and return its status info. */
const getServerStatus = async (port: number): Promise<ServerStatus> => {
  try {
    const res = await fetch(`http://${DEFAULT_HOST}:${port}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return { running: false };
    const version = res.headers.get('x-opentabs-version') ?? undefined;
    const body = (await res.json()) as Record<string, unknown>;
    const mode = typeof body.mode === 'string' ? body.mode : undefined;
    const isBackground = await isBackgroundServerRunning();
    const serverType = isBackground ? 'background' : mode === 'dev' ? 'dev' : 'foreground';
    return { running: true, version, mode, serverType };
  } catch {
    return { running: false };
  }
};

/** Run `npm install -g` to update the CLI package. */
const performUpdate = (version: string): boolean => {
  const target = `${CLI_PACKAGE_NAME}@${version}`;
  const result = spawnSync(platformExec('npm'), ['install', '-g', target], { stdio: 'inherit' });
  if (result.error) return false;
  return (result.status ?? 1) === 0;
};

/** Detect if the CLI is running from a source checkout (monorepo) rather than a global npm install. */
const isRunningFromSource = (): boolean => {
  const cliPath = fileURLToPath(import.meta.url);
  return !cliPath.includes('node_modules');
};

const handleUpdate = async (options: UpdateOptions): Promise<void> => {
  if (isRunningFromSource()) {
    console.log(pc.yellow('You appear to be running from source. Use git pull to update instead.'));
    return;
  }

  const port = resolvePort(options);

  // 1. Get current and latest versions
  let installed: string;
  let latest: string;
  try {
    console.log(pc.dim('Checking for updates...'));
    installed = await getInstalledVersion();
    latest = getLatestVersion();
  } catch (err: unknown) {
    console.error(pc.red(`Failed to check for updates: ${toErrorMessage(err)}`));
    process.exit(1);
  }

  if (installed === latest) {
    console.log(pc.green(`Already up to date (v${installed}).`));
    return;
  }

  console.log(`  Installed: ${pc.dim(`v${installed}`)}`);
  console.log(`  Latest:    ${pc.cyan(`v${latest}`)}`);
  console.log('');

  // 2. Check if server is running and warn
  const serverStatus = await getServerStatus(port);
  if (serverStatus.running) {
    const versionLabel = serverStatus.version ? ` (v${serverStatus.version})` : '';
    const typeLabel = serverStatus.serverType ? ` [${serverStatus.serverType}]` : '';
    console.log(pc.yellow(`Warning: MCP server${versionLabel}${typeLabel} is running on port ${port}.`));
    const restartNote =
      serverStatus.serverType === 'background'
        ? 'The server will be automatically restarted after the update.'
        : 'The server will need to be restarted after the update.';
    console.log(pc.yellow(restartNote));
    console.log('');
  }

  // 3. Perform the update
  console.log(`Updating ${CLI_PACKAGE_NAME} to v${latest}...`);
  console.log('');
  const success = performUpdate(latest);

  if (!success) {
    console.error('');
    console.error(pc.red('Update failed.'));
    console.error(pc.dim(`Try manually: npm install -g ${CLI_PACKAGE_NAME}@latest`));
    process.exit(1);
  }

  console.log('');
  console.log(pc.green(`Updated to v${latest}.`));

  if (serverStatus.running) {
    console.log('');
    switch (serverStatus.serverType) {
      case 'background':
        await restartBackgroundServer(port);
        break;
      case 'dev':
        console.log(pc.dim('Restart your dev server:'));
        console.log(pc.dim('  npm run dev'));
        break;
      default:
        console.log(pc.dim('Stop the server (Ctrl+C) and run:'));
        console.log(pc.dim('  opentabs start'));
    }
  }
};

const registerUpdateCommand = (program: Command): void => {
  program
    .command('update')
    .description('Update OpenTabs CLI to the latest version')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs update`,
    )
    .action((_options: UpdateOptions, command: Command) => handleUpdate(command.optsWithGlobals()));
};

export { registerUpdateCommand };
