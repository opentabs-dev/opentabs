/**
 * E2E tests for the stdio bridge (`opentabs start --stdio`).
 *
 * Verifies the bridge can proxy MCP JSON-RPC between stdin/stdout and the
 * HTTP server, including initialize, tools/list, and session cleanup.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { McpServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  E2E_TEST_PLUGIN_DIR,
  expect,
  readPluginToolNames,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI_ENTRY = path.join(ROOT, 'platform/cli/dist/cli.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BridgeProcess {
  proc: ChildProcess;
  /** Send a JSON-RPC message to the bridge's stdin. */
  send: (message: Record<string, unknown>) => void;
  /** Wait for the next JSON-RPC response on stdout (matching the given id). */
  waitForResponse: (id: number, timeoutMs?: number) => Promise<Record<string, unknown>>;
  /** Kill the bridge process. */
  kill: () => Promise<void>;
}

/**
 * Spawn the stdio bridge as a child process connected to an existing MCP server.
 */
const spawnBridge = (port: number, configDir: string): BridgeProcess => {
  const proc = spawn('node', [CLI_ENTRY, 'start', '--stdio', '--port', String(port)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OPENTABS_CONFIG_DIR: configDir,
    },
  });

  const lines: string[] = [];
  const waiters: Array<{ id: number; resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }> = [];

  const stdout = proc.stdout;
  if (!stdout) throw new Error('Bridge process has no stdout');
  const rl = createInterface({ input: stdout });
  rl.on('line', (line: string) => {
    lines.push(line);
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const responseId = parsed.id as number | undefined;
      if (responseId !== undefined) {
        const idx = waiters.findIndex(w => w.id === responseId);
        if (idx >= 0) {
          const waiter = waiters.splice(idx, 1)[0];
          if (waiter) waiter.resolve(parsed);
        }
      }
    } catch {
      // Not JSON — ignore (e.g., log output that leaked to stdout)
    }
  });

  const send = (message: Record<string, unknown>): void => {
    proc.stdin?.write(`${JSON.stringify(message)}\n`);
  };

  const waitForResponse = (id: number, timeoutMs = 15_000): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      // Check if already received
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if ((parsed.id as number) === id) {
            resolve(parsed);
            return;
          }
        } catch {
          // ignore
        }
      }

      const timer = setTimeout(() => {
        const idx = waiters.findIndex(w => w.id === id);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`Timed out waiting for response id=${String(id)} after ${String(timeoutMs)}ms`));
      }, timeoutMs);

      waiters.push({
        id,
        resolve: v => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: e => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });

  const kill = async (): Promise<void> => {
    if (proc.exitCode !== null) return;
    return new Promise<void>(resolve => {
      proc.once('exit', () => resolve());
      // Close stdin to trigger graceful shutdown
      proc.stdin?.end();
      // Fallback: force kill after 5s
      const fallback = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* already dead */
        }
      }, 5_000);
      proc.once('exit', () => clearTimeout(fallback));
    });
  };

  return { proc, send, waitForResponse, kill };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('stdio bridge', () => {
  test('initialize and tools/list via stdio bridge', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let bridge: BridgeProcess | undefined;
    try {
      // Create isolated config with e2e-test plugin
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-stdio-'));
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) tools[t] = true;
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      // Start MCP server
      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.status === 'ok');

      // Spawn the stdio bridge
      bridge = spawnBridge(server.port, configDir);

      // Send initialize request
      bridge.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'e2e-test', version: '1.0.0' },
        },
      });

      const initResponse = await bridge.waitForResponse(1);
      expect(initResponse.jsonrpc).toBe('2.0');
      expect(initResponse.id).toBe(1);
      expect(initResponse.result).toBeDefined();

      const result = initResponse.result as Record<string, unknown>;
      expect(result.serverInfo).toBeDefined();
      expect(result.capabilities).toBeDefined();

      // Send initialized notification (no response expected)
      bridge.send({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });

      // Small delay for notification processing
      await new Promise(r => setTimeout(r, 500));

      // Send tools/list request
      bridge.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      const toolsResponse = await bridge.waitForResponse(2);
      expect(toolsResponse.jsonrpc).toBe('2.0');
      expect(toolsResponse.id).toBe(2);
      expect(toolsResponse.result).toBeDefined();

      const toolsResult = toolsResponse.result as { tools: Array<{ name: string }> };
      expect(toolsResult.tools).toBeInstanceOf(Array);
      expect(toolsResult.tools.length).toBeGreaterThan(0);

      // Verify e2e-test plugin tools are present
      const toolNames = toolsResult.tools.map(t => t.name);
      expect(toolNames.some(n => n.startsWith('e2e-test_'))).toBe(true);
    } finally {
      await bridge?.kill();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('bridge proxies error responses for invalid methods', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let bridge: BridgeProcess | undefined;
    try {
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-stdio-err-'));
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      writeTestConfig(configDir, { localPlugins: [absPluginPath] });

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.status === 'ok');

      bridge = spawnBridge(server.port, configDir);

      // Send initialize first
      bridge.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'e2e-test', version: '1.0.0' },
        },
      });
      await bridge.waitForResponse(1);

      // Send a request without initializing first won't work, but after
      // init, send an unknown method — the server returns an error response
      bridge.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'nonexistent/method',
        params: {},
      });

      const errorResponse = await bridge.waitForResponse(2);
      expect(errorResponse.jsonrpc).toBe('2.0');
      expect(errorResponse.id).toBe(2);
      expect(errorResponse.error).toBeDefined();
    } finally {
      await bridge?.kill();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});
