/**
 * `opentabs stop` command — stops a background MCP server.
 *
 * Reads the PID file written by `opentabs start --background`, sends SIGTERM
 * to the process, waits for it to exit, and cleans up the PID file. Falls back
 * to a health-check probe when no PID file exists.
 */

import { isConnectionRefused, getPidFilePath, readAuthSecret } from '../config.js';
import { parsePort, resolvePort } from '../parse-port.js';
import { DEFAULT_HOST } from '@opentabs-dev/shared';
import pc from 'picocolors';
import { readFile, unlink } from 'node:fs/promises';
import type { Command } from 'commander';

interface StopOptions {
  port?: number;
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

const handleStop = async (options: StopOptions): Promise<void> => {
  const pidPath = getPidFilePath();

  let pidFileContent: string | undefined;
  try {
    pidFileContent = await readFile(pidPath, 'utf-8');
  } catch {
    // No PID file — fall through to port-based detection
  }

  if (pidFileContent !== undefined) {
    const pid = parseInt(pidFileContent.trim(), 10);
    if (isNaN(pid)) {
      await unlink(pidPath).catch(() => {});
      console.log('Server is not running (invalid PID file cleaned up).');
      return;
    }

    if (!isProcessAlive(pid)) {
      await unlink(pidPath).catch(() => {});
      console.log('Server is not running (stale PID file cleaned up).');
      return;
    }

    // Verify the process is an OpenTabs server via health check to guard against PID recycling
    const port = resolvePort(options);
    const healthUrl = `http://${DEFAULT_HOST}:${port}/health`;
    const secret = await readAuthSecret();
    const healthHeaders: Record<string, string> = {};
    if (secret) healthHeaders['Authorization'] = `Bearer ${secret}`;

    try {
      const res = await fetch(healthUrl, { headers: healthHeaders, signal: AbortSignal.timeout(2_000) });
      if (!res.headers.get('x-opentabs-version')) {
        await unlink(pidPath).catch(() => {});
        console.log('Server is not running (stale PID file cleaned up).');
        return;
      }
    } catch {
      await unlink(pidPath).catch(() => {});
      console.log('Server is not running (stale PID file cleaned up).');
      return;
    }

    process.kill(pid, 'SIGTERM');

    const exited = await waitForExit(pid, 5_000);
    await unlink(pidPath).catch(() => {});

    if (exited) {
      console.log('Server stopped.');
    } else {
      console.log(pc.yellow(`Server process (PID: ${String(pid)}) did not exit within 5 seconds.`));
      console.log(pc.dim(`You may need to kill it manually: kill -9 ${String(pid)}`));
    }
    return;
  }

  // No PID file — check if a server is running on the port via health endpoint
  const port = resolvePort(options);
  const url = `http://${DEFAULT_HOST}:${port}/health`;

  const secret = await readAuthSecret();
  const headers: Record<string, string> = {};
  if (secret) headers['Authorization'] = `Bearer ${secret}`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(3_000) });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      if (typeof data.status === 'string' && typeof data.version === 'string') {
        console.log(
          `Server is running but was not started with --background.\n  - If running in a terminal: press Ctrl+C\n  - Otherwise (macOS): kill $(lsof -ti :${port})\n  - Otherwise (Linux):  fuser -k ${port}/tcp\n  - Tip: use opentabs start --background next time to enable opentabs stop`,
        );
        return;
      }
      console.log(`No OpenTabs server found on port ${port}.`);
      return;
    }
  } catch (err: unknown) {
    if (isConnectionRefused(err)) {
      console.log('Server is not running.');
      return;
    }
  }

  console.log('Server is not running.');
};

const registerStopCommand = (program: Command): void => {
  program
    .command('stop')
    .description('Stop the background MCP server')
    .option('--port <number>', 'Server port for fallback detection (default: 9515)', parsePort)
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs stop
  $ opentabs stop --port 3000`,
    )
    .action((_options: StopOptions, command: Command) => handleStop(command.optsWithGlobals()));
};

export { registerStopCommand };
