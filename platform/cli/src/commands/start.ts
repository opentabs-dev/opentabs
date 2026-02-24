/**
 * `opentabs start` command — starts the MCP server in production mode.
 *
 * On first run, auto-initializes ~/.opentabs/ with a config file and
 * installs the browser extension. Prints first-time setup instructions
 * after the server starts.
 *
 * Server output is written to both the terminal and a log file at
 * ~/.opentabs/server.log (or $OPENTABS_CONFIG_DIR/server.log).
 * The `opentabs logs` command tails this file.
 */

import { installExtension } from './setup.js';
import { getConfigDir, getLogFilePath, readAuthSecret } from '../config.js';
import { parsePort, resolvePort } from '../parse-port.js';
import {
  fileExists as runtimeFileExists,
  isWindows,
  platformExec,
  spawnStreaming,
  toErrorMessage,
} from '@opentabs-dev/shared';
import pc from 'picocolors';
import { mkdirSync, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import type { WriteStream } from 'node:fs';

interface StartOptions {
  port?: number;
}

const resolveServerEntry = (): string => {
  try {
    return fileURLToPath(import.meta.resolve('@opentabs-dev/mcp-server'));
  } catch {
    const cliDir = dirname(fileURLToPath(import.meta.url));
    return resolve(cliDir, '..', '..', '..', 'mcp-server', 'dist', 'index.js');
  }
};

const isPortInUse = async (port: number): Promise<boolean> => {
  try {
    await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Pipe a readable stream to both a terminal writable and a log file stream.
 * Returns when the readable stream ends.
 */
const teeStream = async (
  readable: ReadableStream<Uint8Array>,
  terminal: NodeJS.WriteStream,
  logFile: WriteStream,
): Promise<void> => {
  const reader = readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    terminal.write(value);
    logFile.write(value);
  }
};

/**
 * Auto-initialize the config directory and install the browser extension.
 * Returns true if this is the first-time setup (extension was newly installed).
 */
const autoInitialize = async (configDir: string): Promise<boolean> => {
  mkdirSync(configDir, { recursive: true });

  try {
    const result = await installExtension(configDir);

    if (result.installed && result.firstTime) {
      console.log(pc.green(`Extension installed to ${result.extensionDest} (v${result.version})`));
      return true;
    } else if (result.installed) {
      console.log(pc.dim(`Extension updated to v${result.version}`));
      console.log(pc.dim('  Extension will auto-reload when the server connects.'));
    }
  } catch (err) {
    // Extension install is non-fatal — the server can still start without it.
    console.warn(pc.yellow(`Warning: Could not install extension: ${toErrorMessage(err)}`));
    console.warn(pc.dim('Restart opentabs start to retry extension installation.'));
  }

  return false;
};

const printFirstTimeInstructions = (extensionDest: string, port: number, secret: string | null): void => {
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;

  console.log('');
  console.log(pc.bold('First-time setup:'));
  console.log('');
  console.log('  1. Load the extension in Chrome:');
  console.log(`     a. Open ${pc.cyan('chrome://extensions/')}`);
  console.log(`     b. Enable "Developer mode" (top-right toggle)`);
  console.log(`     c. Click "Load unpacked" and select: ${pc.cyan(extensionDest)}`);
  console.log('');
  console.log('  2. Configure your MCP client:');
  console.log('');
  printMcpClientConfigs(mcpUrl, secret);
};

const printMcpClientConfigs = (mcpUrl: string, secret: string | null): void => {
  const headers = secret ? `, "headers": { "Authorization": "Bearer ${secret}" }` : '';

  console.log(pc.dim(`     ${pc.bold('Claude Code')} (~/.claude.json — add to "mcpServers"):`));
  console.log(
    pc.dim(`     { "mcpServers": { "opentabs": { "type": "streamable-http", "url": "${mcpUrl}"${headers} } } }`),
  );
  console.log('');
  console.log(pc.dim(`     ${pc.bold('OpenCode')} (opencode.json in project root):`));
  console.log(pc.dim(`     { "mcp": { "opentabs": { "type": "remote", "url": "${mcpUrl}"${headers} } } }`));
  console.log('');
  console.log(pc.dim(`     ${pc.bold('Cursor')} (.cursor/mcp.json):`));
  console.log(pc.dim(`     { "mcpServers": { "opentabs": { "type": "http", "url": "${mcpUrl}"${headers} } } }`));
  console.log('');
  console.log(pc.dim(`     ${pc.bold('Windsurf')} (~/.codeium/windsurf/mcp_config.json):`));
  console.log(pc.dim(`     { "mcpServers": { "opentabs": { "serverUrl": "${mcpUrl}"${headers} } } }`));
  console.log('');
  console.log(pc.dim('     For other MCP clients, consult their documentation for adding a Streamable HTTP server'));
  console.log(pc.dim(`     pointing to ${mcpUrl} with Authorization: Bearer <secret>`));
  console.log('');
};

const handleStart = async (options: StartOptions): Promise<void> => {
  const serverEntry = resolveServerEntry();

  if (!(await runtimeFileExists(serverEntry))) {
    console.error(pc.red(`Error: MCP server entry not found at ${serverEntry}`));
    console.error('Run npm run build from the project root first.');
    process.exit(1);
  }

  const port = resolvePort(options);

  if (await isPortInUse(port)) {
    console.error(pc.red(`Error: Port ${port} is already in use.`));
    console.error(
      port === 9515
        ? 'Another OpenTabs server may already be running. Use --port to specify a different port.'
        : `Use a different port with: opentabs start --port <number>`,
    );
    process.exit(1);
  }

  const configDir = getConfigDir();
  const isFirstTime = await autoInitialize(configDir);
  const secret = await readAuthSecret();

  const env: Record<string, string | undefined> = { ...process.env };
  env.PORT = String(port);

  const logFilePath = getLogFilePath();
  const logStream = createWriteStream(logFilePath, { flags: 'a' });

  console.log(`Starting OpenTabs MCP server on port ${pc.bold(String(port))}...`);
  console.log('');
  console.log(`  ${pc.cyan('MCP endpoint:')}  http://localhost:${port}/mcp`);
  console.log(`  ${pc.cyan('Health check:')}  http://localhost:${port}/health`);
  console.log(`  ${pc.cyan('Log file:')}     ${logFilePath}`);
  console.log('');

  if (isFirstTime) {
    const extensionDest = resolve(configDir, 'extension');
    printFirstTimeInstructions(extensionDest, port, secret);
  } else {
    console.log(pc.dim('  MCP client config (add to your client):'));
    console.log('');
    printMcpClientConfigs(`http://127.0.0.1:${port}/mcp`, secret);
  }

  console.log(pc.dim('  Press Ctrl+C to stop'));
  console.log('');

  const proc = spawnStreaming(platformExec('node'), [serverEntry], {
    env: env,
    stdin: 'inherit',
  });

  const stdoutPipe = teeStream(proc.stdout, process.stdout, logStream);
  const stderrPipe = teeStream(proc.stderr, process.stderr, logStream);

  process.on('SIGINT', () => proc.kill('SIGINT'));
  if (!isWindows()) {
    process.on('SIGTERM', () => proc.kill('SIGTERM'));
  }

  await Promise.all([stdoutPipe, stderrPipe]);
  logStream.end();

  const exitCode = await proc.exited;
  process.exit(exitCode);
};

export const registerStartCommand = (program: Command): void => {
  program
    .command('start')
    .description('Start the MCP server')
    .option('--port <number>', 'Server port (default: 9515)', parsePort)
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs start
  $ opentabs start --port 3000`,
    )
    .action((_options: StartOptions, command: Command) => handleStart(command.optsWithGlobals()));
};
