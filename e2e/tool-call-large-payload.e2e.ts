/**
 * E2E test: `opentabs tool call` with payloads larger than the OS argv limit.
 *
 * Spawns the real CLI subprocess with a 1.5 MB payload to prove that:
 *   - --params-file <path> succeeds and round-trips the full payload
 *   - --params-file - (stdin) succeeds and round-trips the full payload
 *   - --params with an inline 1.5 MB blob fails (regression guard for argv limit)
 *
 * The macOS ARG_MAX is ~1 MB. A 1.5 MB payload is reliably above the limit on
 * macOS and Linux CI runners, proving the argv bypass is necessary.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures.js';
import { setupToolTest } from './helpers.js';

const CLI = fileURLToPath(new URL('../platform/cli/dist/cli.js', import.meta.url));

const PAYLOAD_SIZE = Math.floor(1.5 * 1024 * 1024);

/** Run the CLI as a subprocess and collect stdout/stderr/exit code. */
const runCli = (
  args: string[],
  env: Record<string, string | undefined>,
  stdinPayload?: Buffer,
): Promise<{ stdout: string; stderr: string; code: number; spawnError: string | undefined }> =>
  new Promise(resolve => {
    let child: ReturnType<typeof spawn>;
    // When argv exceeds the OS limit (ARG_MAX), spawn() throws synchronously on
    // some platforms (macOS) and emits an async 'error' event on others. Both
    // paths are the expected outcome for the oversize-argv regression guard, so
    // capture the synchronous throw and resolve with it.
    try {
      child = spawn('node', [CLI, ...args], {
        env,
        timeout: 30_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      resolve({ stdout: '', stderr: '', code: -1, spawnError: code ?? (err as Error).message });
      return;
    }

    let stdout = '';
    let stderr = '';
    let spawnError: string | undefined;
    let settled = false;

    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, code, spawnError });
    };

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    // A spawn failure that surfaces asynchronously emits 'error' and may never
    // emit 'close', so resolve here too — otherwise the promise would hang
    // until the test timeout.
    child.on('error', (err: NodeJS.ErrnoException) => {
      spawnError = err.code ?? err.message;
      settle(-1);
    });
    child.on('close', code => {
      settle(code ?? -1);
    });

    // Writing to stdin of a process that failed to spawn throws synchronously;
    // ignore it — the spawn-failure paths above already captured the error.
    try {
      if (stdinPayload !== undefined) {
        child.stdin?.end(stdinPayload);
      } else {
        child.stdin?.end();
      }
    } catch {
      // Spawn failed before stdin was usable — handled via the error paths.
    }
  });

test.describe('CLI tool call — large payload bypass', () => {
  test('round-trips a 1.5 MB payload via --params-file <path>', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const dir = await mkdtemp(join(tmpdir(), 'opentabs-large-payload-'));
    try {
      const bigMessage = 'x'.repeat(PAYLOAD_SIZE);
      const payloadPath = join(dir, 'payload.json');
      await writeFile(payloadPath, JSON.stringify({ message: bigMessage }));

      const env = {
        ...process.env,
        OPENTABS_CONFIG_DIR: mcpServer.configDir,
        OPENTABS_TELEMETRY_DISABLED: '1',
        OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '1',
      };

      const result = await runCli(
        ['tool', 'call', 'e2e-test_echo', '--params-file', payloadPath, '--port', String(mcpServer.port)],
        env,
      );

      expect(result.spawnError).toBeUndefined();
      expect(result.code).toBe(0);

      const parsed = JSON.parse(result.stdout) as { ok: boolean; message: string };
      expect(parsed.ok).toBe(true);
      expect(parsed.message.length).toBe(PAYLOAD_SIZE);
      expect(parsed.message).toBe(bigMessage);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('round-trips a 1.5 MB payload via --params-file - (stdin)', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const bigMessage = 'y'.repeat(PAYLOAD_SIZE);
    const payloadJson = JSON.stringify({ message: bigMessage });

    const env = {
      ...process.env,
      OPENTABS_CONFIG_DIR: mcpServer.configDir,
      OPENTABS_TELEMETRY_DISABLED: '1',
      OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '1',
    };

    const result = await runCli(
      ['tool', 'call', 'e2e-test_echo', '--params-file', '-', '--port', String(mcpServer.port)],
      env,
      Buffer.from(payloadJson, 'utf8'),
    );

    expect(result.spawnError).toBeUndefined();
    expect(result.code).toBe(0);

    const parsed = JSON.parse(result.stdout) as { ok: boolean; message: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.message.length).toBe(PAYLOAD_SIZE);
    expect(parsed.message).toBe(bigMessage);
  });

  test('rejects an oversize inline --params value (regression guard for argv limit)', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const bigJson = JSON.stringify({ message: 'z'.repeat(PAYLOAD_SIZE) });

    const env = {
      ...process.env,
      OPENTABS_CONFIG_DIR: mcpServer.configDir,
      OPENTABS_TELEMETRY_DISABLED: '1',
      OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '1',
    };

    const result = await runCli(
      ['tool', 'call', 'e2e-test_echo', '--params', bigJson, '--port', String(mcpServer.port)],
      env,
    );

    // On macOS and Linux, passing a 1.5 MB argument via argv either fails at the
    // OS layer with E2BIG (spawn error), or the shell/node swallows the oversized
    // arg and the process exits non-zero. Either outcome proves that inline --params
    // is not a reliable path for large payloads — use --params-file instead.
    const failed =
      result.code !== 0 ||
      result.spawnError === 'E2BIG' ||
      /E2BIG|too long|argument list too long/i.test(result.stderr + (result.spawnError ?? ''));
    expect(failed).toBe(true);
  });
});
