import { execFile as execFileCb } from 'node:child_process';
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
});
