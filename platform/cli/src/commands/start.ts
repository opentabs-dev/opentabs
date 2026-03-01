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
import { ensureAuthSecret, getConfigDir, getLogFilePath, getPidFilePath, readAuthSecret } from '../config.js';
import { parsePort, resolvePort } from '../parse-port.js';
import { DEFAULT_PORT, isWindows, platformExec, toErrorMessage } from '@opentabs-dev/shared';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import net from 'node:net';
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
  background?: boolean;
}

const resolveServerEntry = (): string => {
  try {
    return fileURLToPath(import.meta.resolve('@opentabs-dev/mcp-server'));
  } catch {
    const cliDir = dirname(fileURLToPath(import.meta.url));
    return resolve(cliDir, '..', '..', '..', 'mcp-server', 'dist', 'index.js');
  }
};

const isPortInUse = (port: number): Promise<boolean> =>
  new Promise<boolean>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      server.close();
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port, '127.0.0.1');
  });

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
  mkdirSync(configDir, { recursive: true, mode: 0o700 });

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
  printMcpClientConfigs(mcpUrl, secret, false);
};

const indent = (json: string, prefix: string): string =>
  json
    .split('\n')
    .map(line => `${prefix}${line}`)
    .join('\n');

const getMcpClientConfigs = (
  mcpUrl: string,
  secret: string | null,
): Array<{ label: string; file: string; json: Record<string, unknown>; cliCommand?: string }> => {
  const authHeaders = secret ? { Authorization: `Bearer ${secret}` } : undefined;
  const claudeCliCommand = secret
    ? `claude mcp add --transport http opentabs ${mcpUrl} --header "Authorization: Bearer ${secret}"`
    : `claude mcp add --transport http opentabs ${mcpUrl}`;
  return [
    {
      label: 'Claude Code',
      file: '~/.claude.json',
      cliCommand: claudeCliCommand,
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
};

const printMcpClientConfigs = (mcpUrl: string, secret: string | null, primaryOnly = false, showHint = true): void => {
  const pad = '     ';
  const configs = getMcpClientConfigs(mcpUrl, secret);
  const displayConfigs = primaryOnly ? configs.slice(0, 1) : configs;

  for (const { label, file, json, cliCommand } of displayConfigs) {
    if (cliCommand) {
      console.log(pc.dim(`${pad}${pc.bold(label)} — recommended, add via CLI:`));
      console.log(pc.dim(`${pad}  ${cliCommand}`));
      console.log('');
      console.log(pc.dim(`${pad}${pc.bold(label)} — manual alternative (${file}):`));
      console.log(pc.dim(indent(JSON.stringify(json, null, 2), pad)));
    } else {
      console.log(pc.dim(`${pad}${pc.bold(label)} (${file}):`));
      console.log(pc.dim(indent(JSON.stringify(json, null, 2), pad)));
    }
    console.log('');
  }

  if (primaryOnly) {
    const otherClients = configs
      .slice(1)
      .map(({ label }) => label)
      .join(', ');
    console.log(
      pc.dim(`${pad}For other MCP clients (${otherClients}): run ${pc.bold('opentabs config show --show-secret')}`),
    );
    console.log('');
  }

  console.log(
    pc.dim(
      `${pad}For manual configuration, consult your MCP client's documentation for adding a Streamable HTTP server`,
    ),
  );
  if (secret) {
    console.log(pc.dim(`${pad}pointing to ${mcpUrl} with Authorization: Bearer ${secret}`));
  } else {
    console.log(pc.dim(`${pad}pointing to ${mcpUrl} with an Authorization: Bearer header`));
  }
  if (!primaryOnly && showHint) {
    console.log(
      pc.dim(`${pad}Run ${pc.bold('opentabs config show --show-secret')} to see MCP client configuration at any time.`),
    );
  }
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

  if (options.showConfig) {
    const secret = await readAuthSecret();
    if (secret === null) {
      console.error(pc.red('Error: No auth secret found. Run `opentabs start` to initialize.'));
      process.exit(1);
    }
    console.log(pc.dim('  MCP client config (add to your client):'));
    console.log('');
    printMcpClientConfigs(`http://127.0.0.1:${port}/mcp`, secret, false, false);
    process.exit(0);
  }

  let portInUse: boolean;
  try {
    portInUse = await isPortInUse(port);
  } catch (err: unknown) {
    const errnoErr = err as NodeJS.ErrnoException;
    if (errnoErr.code === 'EACCES') {
      console.error(pc.red(`Error: Permission denied: port ${port} requires elevated privileges.`));
    } else {
      console.error(pc.red(`Error: Failed to check port ${port}: ${toErrorMessage(err)}`));
    }
    process.exit(1);
  }

  if (portInUse) {
    console.error(pc.red(`Error: Port ${port} is already in use.`));
    console.error(
      port === 9515
        ? 'Another OpenTabs server may already be running. Use --port to specify a different port.'
        : `Use a different port with: opentabs start --port <number>`,
    );
    process.exit(1);
  }

  const configDir = getConfigDir();
  const secret = await ensureAuthSecret();
  const isFirstTime = await autoInitialize(configDir);

  const env: Record<string, string | undefined> = { ...process.env };
  env.PORT = String(port);

  const logFilePath = getLogFilePath();

  const printStartupHeader = (): void => {
    console.log(`Starting OpenTabs MCP server on port ${pc.bold(String(port))}...`);
    console.log('');
    const label = (s: string) => `  ${pc.cyan(s.padEnd(15))}`;
    console.log(`${label('MCP endpoint:')}http://127.0.0.1:${port}/mcp`);
    console.log(`${label('Health check:')}http://127.0.0.1:${port}/health`);
    console.log(`${label('Log file:')}${logFilePath}`);
    console.log('');
  };

  const printSetupHints = (): void => {
    if (isFirstTime) {
      const extensionDest = resolve(configDir, 'extension');
      printFirstTimeInstructions(extensionDest, port, secret);
    } else {
      console.log(pc.dim(`  Run ${pc.bold('opentabs config show --show-secret')} to see MCP client configuration.`));
      console.log('');
    }
  };

  if (options.background) {
    const logStream = createWriteStream(logFilePath, { flags: 'a', mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      logStream.once('open', () => resolve());
      logStream.once('error', reject);
    }).catch((err: unknown) => {
      console.error(pc.red(`Error: Failed to open log file ${logFilePath}: ${toErrorMessage(err)}`));
      process.exit(1);
    });
    const child = spawn(platformExec('node'), [serverEntry], {
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', logStream, logStream],
      detached: true,
    });
    child.unref();

    const pid = child.pid;
    if (pid === undefined) {
      console.error(pc.red('Error: Failed to start background server process.'));
      process.exit(1);
    }

    // Wait briefly to detect early crashes (e.g., port conflict, missing entry)
    const crashed = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => {
        child.removeAllListeners('exit');
        resolve(false);
      }, 2000);
      child.on('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    if (crashed) {
      console.error(pc.yellow(`Warning: Background server exited unexpectedly. Check logs: ${logFilePath}`));
      process.exit(1);
    }

    try {
      await writeFile(getPidFilePath(), JSON.stringify({ pid, port }), { mode: 0o600 });
    } catch (err) {
      console.error(pc.red(`Error: Failed to write PID file: ${toErrorMessage(err)}`));
      process.exit(1);
    }

    printStartupHeader();
    printSetupHints();

    console.log(`Server started in background (PID: ${String(pid)})`);
    console.log(pc.dim(`Logs: ${logFilePath}`));
    const stopCmd = port !== DEFAULT_PORT ? `opentabs stop --port ${String(port)}` : 'opentabs stop';
    console.log(pc.dim(`Stop: ${stopCmd}`));
    return;
  }

  printStartupHeader();
  printSetupHints();

  console.log(pc.dim('  Press Ctrl+C to stop'));
  console.log('');

  const logStream = createWriteStream(logFilePath, { flags: 'a', mode: 0o600 });
  logStream.on('error', (err: Error) => {
    console.warn(pc.yellow(`Warning: Failed to write to log file: ${toErrorMessage(err)}`));
  });

  const proc = spawnStreaming(platformExec('node'), [serverEntry], {
    env: env,
    stdin: 'inherit',
  });
  // Suppress unhandled rejection if spawn fails before proc.exited is awaited below.
  // The error is still surfaced when await proc.exited runs.
  proc.exited.catch(() => {});

  const stdoutPipe = teeStream(proc.stdout, process.stdout, logStream);
  const stderrPipe = teeStream(proc.stderr, process.stderr, logStream);

  process.on('SIGINT', () => proc.kill('SIGINT'));
  if (!isWindows()) {
    process.on('SIGTERM', () => proc.kill('SIGTERM'));
  }

  await Promise.all([stdoutPipe, stderrPipe]);
  await new Promise<void>(resolve => logStream.end(() => resolve()));

  const exitCode = await proc.exited;
  console.log(pc.dim('Server stopped.'));
  process.exit(exitCode);
};

const registerStartCommand = (program: Command): void => {
  program
    .command('start')
    .description('Start the MCP server')
    .option('--port <number>', 'Server port (default: 9515)', parsePort)
    .option('--background', 'Start the server in the background')
    .option('--show-config', 'Print full MCP client configuration even on subsequent runs')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs start
  $ opentabs start --background
  $ opentabs start --port 3000
  $ opentabs start --show-config`,
    )
    .action((_options: StartOptions, command: Command) => handleStart(command.optsWithGlobals()));
};

export { getMcpClientConfigs, printMcpClientConfigs, registerStartCommand };
