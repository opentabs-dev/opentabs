import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { atomicWrite, isWindows, npmSpawnOpts } from './cross-platform.js';

describe('atomicWrite', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opentabs-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('writes content to a new file', async () => {
    const filePath = join(tempDir, 'test.json');
    await atomicWrite(filePath, '{"hello":"world"}');
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('{"hello":"world"}');
  });

  test('overwrites existing file with new content', async () => {
    const filePath = join(tempDir, 'test.json');
    await atomicWrite(filePath, 'first');
    await atomicWrite(filePath, 'second');
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('second');
  });

  test('concurrent writes to the same file do not corrupt data', async () => {
    const filePath = join(tempDir, 'concurrent.json');
    const contentA = JSON.stringify({ source: 'A', data: 'a'.repeat(1000) });
    const contentB = JSON.stringify({ source: 'B', data: 'b'.repeat(1000) });

    // Fire both writes concurrently — unique temp paths prevent them from
    // overwriting each other's in-flight temp file.
    await Promise.all([atomicWrite(filePath, contentA), atomicWrite(filePath, contentB)]);

    const result = await readFile(filePath, 'utf-8');
    // The result must be exactly one of the two valid contents — never a mix.
    expect([contentA, contentB]).toContain(result);
    // Verify the content is well-formed JSON, not truncated or corrupted.
    expect(() => {
      JSON.parse(result);
    }).not.toThrow();
  });
});

describe('npmSpawnOpts', () => {
  test('always sets windowsHide to suppress console flash', () => {
    // windowsHide prevents each spawned child from opening its own visible
    // console window on Windows; it is ignored on other platforms.
    expect(npmSpawnOpts().windowsHide).toBe(true);
  });

  test('enables shell only on Windows for .cmd resolution', () => {
    expect(npmSpawnOpts().shell).toBe(isWindows());
  });
});
