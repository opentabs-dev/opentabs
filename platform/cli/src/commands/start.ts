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
import { ensureAuthSecret, getConfigDir, getLogFilePath } from '../config.js';
import { parsePort, resolvePort } from '../parse-port.js';
import { isWindows, platformExec, toErrorMessage } from '@opentabs-dev/shared';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import type { WriteStream } from 'node:fs';

interface StreamingProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill: (signal?: string) => void;
  exited: Promise<number>;
}

const spawnStreaming = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string | undefined>; stdin?: 'inherit' | 'pipe' | 'ignore' },
): StreamingProcess => {
  const child = spawn(cmd, args, {
    cwd: opts?.cwd,
    env: opts?.env as NodeJS.ProcessEnv,
    stdio: [opts?.stdin ?? 'inherit', 'pipe', 'pipe'],
  });
  const toReadableStream = (readable: Readable | null): ReadableStream<Uint8Array> => {
    if (!readable)
      return new ReadableStream({
        start(c) {
          c.close();
        },
      });
    return Readable.toWeb(readable) as unknown as ReadableStream<Uint8Array>;
  };
  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });
  return {
    stdout: toReadableStream(child.stdout),
    stderr: toReadableStream(child.stderr),
    kill: (signal?: string) => child.kill(signal === 'SIGTERM' ? 'SIGTERM' : 'SIGINT'),
    exited,
  };
};

interface StartOptions {
  port?: number;
  showConfig?: boolean;
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
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      terminal.write(value);
      logFile.write(value);
    }
  } finally {
    reader.releaseLock();
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

const indent = (json: string, prefix: string): string =>
  json
    .split('\n')
    .map(line => `${prefix}${line}`)
    .join('\n');

const printMcpClientConfigs = (mcpUrl: string, secret: string | null): void => {
  const pad = '     ';
  const authHeaders = secret ? { Authorization: `Bearer ${secret}` } : undefined;

  const configs: Array<{ label: string; file: string; json: Record<string, unknown> }> = [
    {
      label: 'Claude Code',
      file: '~/.claude/settings/mcp.json',
      json: {
        mcpServers: {
          opentabs: { type: 'streamable-http', url: mcpUrl, ...(authHeaders && { headers: authHeaders }) },
        },
      },
    },
    {
      label: 'OpenCode',
      file: 'opencode.json in project root',
      json: {
        mcp: { opentabs: { type: 'remote', url: mcpUrl, ...(authHeaders && { headers: authHeaders }) } },
      },
    },
    {
      label: 'Cursor',
      file: '.cursor/mcp.json',
      json: {
        mcpServers: { opentabs: { type: 'http', url: mcpUrl, ...(authHeaders && { headers: authHeaders }) } },
      },
    },
    {
      label: 'Windsurf',
      file: '~/.codeium/windsurf/mcp_config.json',
      json: {
        mcpServers: { opentabs: { serverUrl: mcpUrl, ...(authHeaders && { headers: authHeaders }) } },
      },
    },
  ];

  for (const { label, file, json } of configs) {
    console.log(pc.dim(`${pad}${pc.bold(label)} (${file}):`));
    console.log(pc.dim(indent(JSON.stringify(json, null, 2), pad)));
    console.log('');
  }

  console.log(pc.dim(`${pad}For other MCP clients, consult their documentation for adding a Streamable HTTP server`));
  console.log(pc.dim(`${pad}pointing to ${mcpUrl} with Authorization: Bearer <secret>`));
  console.log('');
};

const handleStart = async (options: StartOptions): Promise<void> => {
  const serverEntry = resolveServerEntry();

  if (
    !(await access(serverEntry).then(
      () => true,
      () => false,
    ))
  ) {
    console.error(pc.red(`Error: MCP server entry not found at ${serverEntry}`));
    if (serverEntry.includes('node_modules')) {
      console.error('Try reinstalling: npm install -g @opentabs-dev/cli');
    } else {
      console.error('Run npm run build from the project root first.');
    }
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
  const secret = await ensureAuthSecret();

  const env: Record<string, string | undefined> = { ...process.env };
  env.PORT = String(port);

  const logFilePath = getLogFilePath();
  const logStream = createWriteStream(logFilePath, { flags: 'a' });
  logStream.on('error', (err: Error) => {
    console.warn(pc.yellow(`Warning: Failed to write to log file: ${toErrorMessage(err)}`));
  });

  console.log(`Starting OpenTabs MCP server on port ${pc.bold(String(port))}...`);
  console.log('');
  const label = (s: string) => `  ${pc.cyan(s.padEnd(15))}`;
  console.log(`${label('MCP endpoint:')}http://localhost:${port}/mcp`);
  console.log(`${label('Health check:')}http://localhost:${port}/health`);
  console.log(`${label('Log file:')}${logFilePath}`);
  console.log('');

  if (isFirstTime || options.showConfig) {
    const extensionDest = resolve(configDir, 'extension');
    if (isFirstTime) {
      printFirstTimeInstructions(extensionDest, port, secret);
    } else {
      console.log(pc.dim('  MCP client config (add to your client):'));
      console.log('');
      printMcpClientConfigs(`http://127.0.0.1:${port}/mcp`, secret);
    }
  } else {
    console.log(pc.dim(`  Run ${pc.bold('opentabs config show --show-secret')} to see MCP client configuration.`));
    console.log('');
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
  console.log(pc.dim('Server stopped.'));
  process.exit(exitCode);
};

const registerStartCommand = (program: Command): void => {
  program
    .command('start')
    .description('Start the MCP server')
    .option('--port <number>', 'Server port (default: 9515)', parsePort)
    .option('--show-config', 'Print full MCP client configuration even on subsequent runs')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs start
  $ opentabs start --port 3000
  $ opentabs start --show-config`,
    )
    .action((_options: StartOptions, command: Command) => handleStart(command.optsWithGlobals()));
};

export { printMcpClientConfigs, registerStartCommand };
