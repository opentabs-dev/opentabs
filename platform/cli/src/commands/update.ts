/**
 * `opentabs update` command — update the CLI to the latest version.
 *
 * Shells out to `npm view` to check the latest published version (which
 * handles auth for private packages via ~/.npmrc), compares with the
 * currently installed version, and delegates to `bun install -g` for
 * the actual update. Warns if a server is running.
 */

import { resolvePort } from '../parse-port.js';
import { platformExec, toErrorMessage } from '@opentabs-dev/shared';
import pc from 'picocolors';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';

const CLI_PACKAGE_NAME = '@opentabs-dev/cli';

interface UpdateOptions {
  port?: number;
}

/** Read the currently installed CLI version from package.json. */
const getInstalledVersion = async (): Promise<string> => {
  const cliDir = dirname(fileURLToPath(import.meta.url));
  const pkgJson = JSON.parse(await Bun.file(join(cliDir, '..', '..', 'package.json')).text()) as { version: string };
  return pkgJson.version;
};

/** Query the latest published version via `npm view`. */
const getLatestVersion = (): string => {
  const result = Bun.spawnSync([platformExec('npm'), 'view', CLI_PACKAGE_NAME, 'version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`npm view failed: ${stderr || `exit code ${result.exitCode}`}`);
  }
  return result.stdout.toString().trim();
};

/** Check if the MCP server is running on the given port. */
const isServerRunning = async (port: number): Promise<boolean> => {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

/** Run `bun install -g` to update the CLI package. */
const performUpdate = (version: string): boolean => {
  const target = `${CLI_PACKAGE_NAME}@${version}`;
  const result = Bun.spawnSync([platformExec('bun'), 'install', '-g', target], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  return result.exitCode === 0;
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
  const serverRunning = await isServerRunning(port);
  if (serverRunning) {
    console.log(pc.yellow(`Warning: MCP server is running on port ${port}.`));
    console.log(pc.yellow('The server will need to be restarted after the update.'));
    console.log('');
  }

  // 3. Perform the update
  console.log(`Updating ${CLI_PACKAGE_NAME} to v${latest}...`);
  console.log('');
  const success = performUpdate(latest);

  if (!success) {
    console.error('');
    console.error(pc.red('Update failed.'));
    console.error(pc.dim(`Try manually: bun install -g ${CLI_PACKAGE_NAME}@latest`));
    process.exit(1);
  }

  console.log('');
  console.log(pc.green(`Updated to v${latest}.`));

  if (serverRunning) {
    console.log('');
    console.log('Restart the MCP server to use the new version:');
    console.log(pc.dim('  1. Stop the current server (Ctrl+C or kill the process)'));
    console.log(pc.dim('  2. Run: opentabs start'));
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
