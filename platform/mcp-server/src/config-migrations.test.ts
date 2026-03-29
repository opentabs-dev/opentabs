import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { migrateConfig } from './config-migrations.js';

const TEST_BASE_DIR = mkdtempSync(join(tmpdir(), 'opentabs-migrations-test-'));

afterAll(() => {
  rmSync(TEST_BASE_DIR, { recursive: true, force: true });
});

/** Write a raw config JSON file and return its path */
const writeConfig = async (name: string, config: Record<string, unknown>): Promise<string> => {
  const configPath = join(TEST_BASE_DIR, name);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
};

describe('migrateConfig — no migration needed', () => {
  test('returns config unchanged when version equals CURRENT_CONFIG_VERSION', async () => {
    const raw = { version: 2, localPlugins: [], permissions: {}, settings: {} };
    const configPath = await writeConfig('no-migration.json', raw);

    const result = await migrateConfig(configPath, raw);

    expect(result).toBe(raw); // Same reference — no clone
    expect(result.version).toBe(2);
  });

  test('does not create a backup file when no migration is needed', async () => {
    const raw = { version: 2, localPlugins: [], permissions: {}, settings: {} };
    const configPath = await writeConfig('no-backup.json', raw);

    await migrateConfig(configPath, raw);

    expect(existsSync(`${configPath}.backup`)).toBe(false);
  });
});

describe('migrateConfig — downgrade protection', () => {
  test('returns config as-is when version is higher than CURRENT_CONFIG_VERSION', async () => {
    const raw = { version: 99, localPlugins: [], permissions: {}, settings: {} };
    const configPath = await writeConfig('downgrade.json', raw);

    const result = await migrateConfig(configPath, raw);

    expect(result).toBe(raw); // Same reference
    expect(result.version).toBe(99);
  });

  test('does not create a backup file on downgrade', async () => {
    const raw = { version: 99, localPlugins: [], permissions: {}, settings: {} };
    const configPath = await writeConfig('downgrade-no-backup.json', raw);

    await migrateConfig(configPath, raw);

    expect(existsSync(`${configPath}.backup`)).toBe(false);
  });
});

describe('migrateConfig — backup creation', () => {
  test('creates config.json.backup with original content before migrating', async () => {
    const raw = { localPlugins: [], permissions: {}, settings: {} };
    const configPath = await writeConfig('backup-test.json', raw);
    const originalContent = await readFile(configPath, 'utf-8');

    await migrateConfig(configPath, raw);

    const backupPath = `${configPath}.backup`;
    expect(existsSync(backupPath)).toBe(true);
    const backupContent = await readFile(backupPath, 'utf-8');
    expect(backupContent).toBe(originalContent);
  });
});

describe('migrateConfig — successful migration', () => {
  test('sets version to CURRENT_CONFIG_VERSION after migration', async () => {
    const raw = { localPlugins: [], permissions: {}, settings: {} };
    const configPath = await writeConfig('version-update.json', raw);

    const result = await migrateConfig(configPath, raw);

    expect(result.version).toBe(2);
  });

  test('persists migrated config to disk', async () => {
    const raw = {
      localPlugins: [],
      permissions: {},
      settings: { retool: { instanceUrl: 'https://retool.example.com' } },
    };
    const configPath = await writeConfig('persist-test.json', raw);

    await migrateConfig(configPath, raw);

    const onDisk = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    expect(onDisk.version).toBe(2);
    expect((onDisk.settings as Record<string, Record<string, unknown>>).retool?.instanceUrl).toEqual({
      default: 'https://retool.example.com',
    });
  });

  test('does not mutate the original raw config object', async () => {
    const raw = {
      localPlugins: [],
      permissions: {},
      settings: { retool: { instanceUrl: 'https://retool.example.com' } },
    };
    const configPath = await writeConfig('no-mutate.json', raw);

    await migrateConfig(configPath, raw);

    // Original should be unchanged (structuredClone protects it)
    expect((raw.settings as Record<string, Record<string, unknown>>).retool?.instanceUrl).toBe(
      'https://retool.example.com',
    );
  });

  test('treats missing version as version 1', async () => {
    const raw = { localPlugins: [], permissions: {}, settings: {} };
    const configPath = await writeConfig('missing-version.json', raw);

    const result = await migrateConfig(configPath, raw);

    expect(result.version).toBe(2);
    expect(existsSync(`${configPath}.backup`)).toBe(true);
  });

  test('treats non-integer version as version 1', async () => {
    const raw = { version: 1.5, localPlugins: [], permissions: {}, settings: {} };
    const configPath = await writeConfig('non-integer-version.json', raw);

    const result = await migrateConfig(configPath, raw);

    expect(result.version).toBe(2);
  });
});

describe('migrateConfig — idempotency', () => {
  test('running migration twice produces the same result', async () => {
    const raw = {
      localPlugins: ['/test/plugin'],
      permissions: { slack: { permission: 'auto' } },
      settings: { retool: { instanceUrl: 'https://retool.example.com' } },
    };
    const configPath = await writeConfig('idempotent.json', raw);

    const first = await migrateConfig(configPath, raw);
    const second = await migrateConfig(configPath, first);

    expect(second).toBe(first); // Same reference — no migration ran the second time
    expect(second.version).toBe(2);
  });
});

describe('v1→v2 migration — string url converted', () => {
  test('converts http:// string to { default: url }', async () => {
    const raw = {
      settings: { myPlugin: { instanceUrl: 'http://localhost:3000' } },
    };
    const configPath = await writeConfig('http-url.json', raw);

    const result = await migrateConfig(configPath, raw);

    expect((result.settings as Record<string, Record<string, unknown>>).myPlugin?.instanceUrl).toEqual({
      default: 'http://localhost:3000',
    });
  });

  test('converts https:// string to { default: url }', async () => {
    const raw = {
      settings: { retool: { instanceUrl: 'https://retool.example.com' } },
    };
    const configPath = await writeConfig('https-url.json', raw);

    const result = await migrateConfig(configPath, raw);

    expect((result.settings as Record<string, Record<string, unknown>>).retool?.instanceUrl).toEqual({
      default: 'https://retool.example.com',
    });
  });
});

describe('v1→v2 migration — Record url preserved', () => {
  test('leaves Record<string, string> url values unchanged', async () => {
    const raw = {
      settings: { retool: { instanceUrl: { prod: 'https://prod.example.com' } } },
    };
    const configPath = await writeConfig('record-url.json', raw);

    const result = await migrateConfig(configPath, raw);

    expect((result.settings as Record<string, Record<string, unknown>>).retool?.instanceUrl).toEqual({
      prod: 'https://prod.example.com',
    });
  });
});

describe('v1→v2 migration — mixed plugins', () => {
  test('handles mix of string and Record values across plugins', async () => {
    const raw = {
      settings: {
        retool: { instanceUrl: 'https://retool.example.com' },
        sqlpad: { instanceUrl: { default: 'https://sqlpad.example.com' } },
      },
    };
    const configPath = await writeConfig('mixed-plugins.json', raw);

    const result = await migrateConfig(configPath, raw);
    const settings = result.settings as Record<string, Record<string, unknown>>;

    expect(settings.retool?.instanceUrl).toEqual({ default: 'https://retool.example.com' });
    expect(settings.sqlpad?.instanceUrl).toEqual({ default: 'https://sqlpad.example.com' });
  });
});

describe('v1→v2 migration — missing settings', () => {
  test('handles config with no settings field', async () => {
    const raw = { localPlugins: [], permissions: {} };
    const configPath = await writeConfig('no-settings.json', raw);

    const result = await migrateConfig(configPath, raw);

    expect(result.version).toBe(2);
    expect(result.settings).toBeUndefined();
  });

  test('handles config with empty settings', async () => {
    const raw = { localPlugins: [], permissions: {}, settings: {} };
    const configPath = await writeConfig('empty-settings.json', raw);

    const result = await migrateConfig(configPath, raw);

    expect(result.version).toBe(2);
  });
});

describe('v1→v2 migration — non-url settings preserved', () => {
  test('preserves string settings that do not start with http', async () => {
    const raw = {
      settings: { myPlugin: { apiKey: 'abc123', name: 'My Instance' } },
    };
    const configPath = await writeConfig('non-url-strings.json', raw);

    const result = await migrateConfig(configPath, raw);
    const settings = result.settings as Record<string, Record<string, unknown>>;

    expect(settings.myPlugin?.apiKey).toBe('abc123');
    expect(settings.myPlugin?.name).toBe('My Instance');
  });

  test('preserves non-string setting values', async () => {
    const raw = {
      settings: { myPlugin: { debug: true, port: 3000, tags: ['a', 'b'] } },
    };
    const configPath = await writeConfig('non-string-values.json', raw);

    const result = await migrateConfig(configPath, raw);
    const settings = result.settings as Record<string, Record<string, unknown>>;

    expect(settings.myPlugin?.debug).toBe(true);
    expect(settings.myPlugin?.port).toBe(3000);
    expect(settings.myPlugin?.tags).toEqual(['a', 'b']);
  });

  test('preserves URL strings alongside non-URL strings in the same plugin', async () => {
    const raw = {
      settings: {
        myPlugin: {
          instanceUrl: 'https://example.com',
          apiKey: 'secret-key',
          debug: false,
        },
      },
    };
    const configPath = await writeConfig('mixed-values.json', raw);

    const result = await migrateConfig(configPath, raw);
    const settings = result.settings as Record<string, Record<string, unknown>>;

    expect(settings.myPlugin?.instanceUrl).toEqual({ default: 'https://example.com' });
    expect(settings.myPlugin?.apiKey).toBe('secret-key');
    expect(settings.myPlugin?.debug).toBe(false);
  });
});
