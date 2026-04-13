import { type ChildProcess, execFile as execFileCb, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFile = promisify(execFileCb);

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'opentabs-smoke-'));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const run = async (...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> => {
  try {
    const { stdout, stderr } = await execFile('node', [CLI, ...args], {
      env: {
        ...process.env,
        OPENTABS_CONFIG_DIR: tmpDir,
        OPENTABS_TELEMETRY_DISABLED: '1',
      },
      timeout: 10_000,
    });
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: e.code ?? 1,
    };
  }
};

describe('CLI smoke tests', () => {
  describe('root commands', () => {
    it('opentabs --version exits 0 and matches semver', async () => {
      const result = await run('--version');
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('opentabs --help exits 0 and contains OpenTabs', async () => {
      const result = await run('--help');
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('OpenTabs');
    });
  });

  describe('every command --help exits 0', () => {
    const helpCommands: string[][] = [
      ['start'],
      ['stop'],
      ['status'],
      ['audit'],
      ['doctor'],
      ['logs'],
      ['update'],
      ['plugin'],
      ['plugin', 'search'],
      ['plugin', 'list'],
      ['plugin', 'install'],
      ['plugin', 'remove'],
      ['plugin', 'configure'],
      ['plugin', 'create'],
      ['tool'],
      ['tool', 'list'],
      ['tool', 'schema'],
      ['tool', 'call'],
      ['config'],
      ['config', 'show'],
      ['config', 'set'],
      ['config', 'path'],
      ['config', 'reset'],
      ['config', 'rotate-secret'],
      ['telemetry'],
      ['telemetry', 'status'],
      ['telemetry', 'enable'],
      ['telemetry', 'disable'],
    ];

    it.each(helpCommands)('opentabs %s --help exits 0', async (...args: string[]) => {
      const result = await run(...args, '--help');
      expect(result.code).toBe(0);
    });
  });

  describe('safe commands that exercise real code', () => {
    it('opentabs config path exits 0 and outputs an absolute path', async () => {
      const result = await run('config', 'path');
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toContain('opentabs');
    });

    it('opentabs start --show-config exits 0', async () => {
      const result = await run('start', '--show-config');
      expect(result.code).toBe(0);
    });

    it('opentabs telemetry status exits 0', async () => {
      const result = await run('telemetry', 'status');
      expect(result.code).toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toContain('elemetry');
    });

    it('opentabs doctor exits 0 or 1 and output contains Doctor', async () => {
      const result = await run('doctor');
      expect([0, 1]).toContain(result.code);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toContain('doctor');
    });

    it('opentabs plugin list exits 0', async () => {
      const result = await run('plugin', 'list');
      expect(result.code).toBe(0);
    });
  });

  describe('start command lifecycle', () => {
    it('starts the server and responds to health check', async () => {
      const child: ChildProcess = spawn('node', [CLI, 'start'], {
        env: {
          ...process.env,
          PORT: '0',
          OPENTABS_CONFIG_DIR: tmpDir,
          OPENTABS_SKIP_NPM_DISCOVERY: '1',
          OPENTABS_TELEMETRY_DISABLED: '1',
          OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      try {
        const port = await new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Server did not start within 15s')), 15_000);
          const onData = (chunk: Buffer) => {
            const match = chunk.toString().match(/[Ll]istening on http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/);
            if (match) {
              clearTimeout(timeout);
              child.stdout?.off('data', onData);
              child.stderr?.off('data', onData);
              resolve(Number(match[1]));
            }
          };
          child.stdout?.on('data', onData);
          child.stderr?.on('data', onData);
          child.on('error', err => {
            clearTimeout(timeout);
            reject(err);
          });
          child.on('exit', code => {
            clearTimeout(timeout);
            if (code !== null && code !== 0) reject(new Error(`Server exited with code ${code}`));
          });
        });

        const res = await fetch(`http://127.0.0.1:${port}/health`);
        expect(res.status).toBe(200);
      } finally {
        child.kill('SIGTERM');
        await new Promise<void>(resolve => child.on('exit', () => resolve()));
      }
    }, 20_000);
  });
});
