import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getCliVersion, getMcpServerVersion } from './version-info.js';

const testDir = dirname(fileURLToPath(import.meta.url));

describe('getCliVersion', () => {
  it('returns the version from platform/cli/package.json', async () => {
    const version = await getCliVersion();

    expect(version).toMatch(/^\d+\.\d+\.\d+/);

    const pkgJson = JSON.parse(await readFile(join(testDir, '..', 'package.json'), 'utf-8')) as { version: string };
    expect(version).toBe(pkgJson.version);
  });
});

describe('getMcpServerVersion', () => {
  it('returns a valid semver version', async () => {
    const version = await getMcpServerVersion();

    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
