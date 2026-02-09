/**
 * Hot Reload Test Harness
 *
 * Spawns the MCP server with `bun --hot` on the TypeScript source
 * and provides helpers to trigger hot reloads by modifying tool source files,
 * and to observe the effects (tool list changes, notifications).
 */

import { getAvailablePorts } from './port-utils.js';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_SRC = join(__dirname, '../../mcp-server/src/index.ts');
const TOOLS_DIR = join(__dirname, '../../mcp-server/src/tools');

interface HotReloadHarness {
  wsPort: number;
  httpPort: number;
  process: ChildProcess;
  /** Wait for the server to be ready (HTTP + WebSocket listening) */
  waitForReady: (timeoutMs?: number) => Promise<void>;
  /** Wait for a specific hot reload generation to complete */
  waitForReload: (reloadNumber: number, timeoutMs?: number) => Promise<void>;
  /** Append a comment to a tool file to trigger a hot reload */
  triggerReload: () => void;
  /** Replace the content of a tool file (for adding/removing tools) */
  writeToolFile: (content: string) => void;
  /** Read the current content of the tool file used for testing */
  readToolFile: () => string;
  /** Get accumulated server stderr output */
  getOutput: () => string;
  /** Stop the server and restore any modified files */
  stop: () => Promise<void>;
}

/**
 * The tool file used for hot-reload testing.
 * This is a small, self-contained file that we can safely modify
 * without breaking the rest of the test suite.
 */
const HOT_RELOAD_TEST_TOOL_FILE = join(TOOLS_DIR, 'slack', 'stars.ts');

/**
 * Start an MCP server with bun --hot for hot-reload testing.
 */
const startHotReloadServer = async (): Promise<HotReloadHarness> => {
  const { wsPort, httpPort } = await getAvailablePorts();

  let serverOutput = '';
  let ready = false;
  const reloadCompletions = new Map<number, Array<() => void>>();

  // Save original file content for restoration
  const originalContent = readFileSync(HOT_RELOAD_TEST_TOOL_FILE, 'utf-8');

  const serverProcess = spawn(
    'bun',
    ['--hot', MCP_SERVER_SRC, '--port', String(httpPort), '--ws-port', String(wsPort)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    },
  );

  serverProcess.stdout?.on('data', (data: Buffer) => {
    serverOutput += data.toString();
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    const message = data.toString();
    serverOutput += message;

    // Detect initial readiness
    if (serverOutput.includes('HTTP server listening') && serverOutput.includes('WebSocket server listening')) {
      ready = true;
    }

    // Detect hot reload completions: "[MCP] Hot reload #N complete"
    const reloadMatch = message.match(/Hot reload #(\d+) complete/);
    if (reloadMatch) {
      const num = parseInt(reloadMatch[1], 10);
      const resolvers = reloadCompletions.get(num);
      if (resolvers) {
        for (const resolve of resolvers) resolve();
        reloadCompletions.delete(num);
      }
    }
  });

  serverProcess.on('error', err => {
    console.error('[HotReloadHarness] Server process error:', err);
  });

  const waitForReady = (timeoutMs = 15000): Promise<void> =>
    new Promise((resolve, reject) => {
      if (ready) {
        resolve();
        return;
      }

      const checkInterval = setInterval(() => {
        if (ready) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);

      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error(`Hot reload server did not become ready within ${timeoutMs}ms. Output:\n${serverOutput}`));
      }, timeoutMs);
    });

  const waitForReload = (reloadNumber: number, timeoutMs = 10000): Promise<void> =>
    new Promise((resolve, reject) => {
      // Check if already completed
      if (serverOutput.includes(`Hot reload #${reloadNumber} complete`)) {
        resolve();
        return;
      }

      const resolvers = reloadCompletions.get(reloadNumber) ?? [];
      reloadCompletions.set(reloadNumber, resolvers);

      const timeout = setTimeout(() => {
        reject(
          new Error(`Hot reload #${reloadNumber} did not complete within ${timeoutMs}ms. Output:\n${serverOutput}`),
        );
      }, timeoutMs);

      resolvers.push(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

  let reloadCounter = 0;

  const triggerReload = (): void => {
    reloadCounter++;
    const currentContent = readFileSync(HOT_RELOAD_TEST_TOOL_FILE, 'utf-8');
    writeFileSync(HOT_RELOAD_TEST_TOOL_FILE, currentContent + `\n// hot-reload-trigger-${reloadCounter}\n`);
  };

  const writeToolFile = (content: string): void => {
    writeFileSync(HOT_RELOAD_TEST_TOOL_FILE, content);
  };

  const readToolFile = (): string => readFileSync(HOT_RELOAD_TEST_TOOL_FILE, 'utf-8');

  const stop = (): Promise<void> =>
    new Promise(resolve => {
      // Restore original file content
      writeFileSync(HOT_RELOAD_TEST_TOOL_FILE, originalContent);

      if (serverProcess.killed) {
        resolve();
        return;
      }

      serverProcess.once('exit', () => resolve());
      serverProcess.kill('SIGTERM');

      setTimeout(() => {
        if (!serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);
    });

  return {
    wsPort,
    httpPort,
    process: serverProcess,
    waitForReady,
    waitForReload,
    triggerReload,
    writeToolFile,
    readToolFile,
    getOutput: () => serverOutput,
    stop,
  };
};

export { startHotReloadServer };
export type { HotReloadHarness };
