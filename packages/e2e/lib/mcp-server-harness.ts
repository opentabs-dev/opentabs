import { getAvailablePorts } from './port-utils.js';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_DIST = join(__dirname, '../../mcp-server/dist/index.js');

export interface McpServerHarness {
  wsPort: number;
  httpPort: number;
  process: ChildProcess;
  isReady: () => boolean;
  waitForReady: (timeoutMs?: number) => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Start an MCP server instance for testing
 *
 * Spawns the MCP server on dynamically allocated unused ports
 * and waits for it to be ready before returning.
 */
export const startMcpServer = async (): Promise<McpServerHarness> => {
  const { wsPort, httpPort } = await getAvailablePorts();

  let ready = false;
  let serverOutput = '';

  const serverProcess = spawn(
    'node',
    [MCP_SERVER_DIST, '--mode', 'http', '--port', String(httpPort), '--ws-port', String(wsPort)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    },
  );

  // Capture output for debugging
  serverProcess.stdout?.on('data', (data: Buffer) => {
    serverOutput += data.toString();
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    const message = data.toString();
    serverOutput += message;

    // Check for readiness indicators (both messages must appear in cumulative output)
    if (serverOutput.includes('HTTP server listening') && serverOutput.includes('WebSocket server listening')) {
      ready = true;
    }
  });

  serverProcess.on('error', err => {
    console.error('[McpServerHarness] Server process error:', err);
  });

  const waitForReady = (timeoutMs = 10000): Promise<void> =>
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
        reject(new Error(`MCP server did not become ready within ${timeoutMs}ms. Output:\n${serverOutput}`));
      }, timeoutMs);
    });

  const stop = (): Promise<void> =>
    new Promise(resolve => {
      if (serverProcess.killed) {
        resolve();
        return;
      }

      serverProcess.once('exit', () => resolve());
      serverProcess.kill('SIGTERM');

      // Force kill after 5 seconds
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
    isReady: () => ready,
    waitForReady,
    stop,
  };
};
