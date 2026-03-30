import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// --- PostHog mock via vi.mock ---

const { mockCapture, mockShutdown } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
  mockShutdown: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock('posthog-node', () => ({
  PostHog: class MockPostHog {
    capture = mockCapture;
    shutdown = mockShutdown;
  },
}));

// --- Test isolation via temp config directory ---

const TEST_BASE_DIR = mkdtempSync(join(tmpdir(), 'opentabs-telemetry-test-'));
const originalConfigDir = process.env.OPENTABS_CONFIG_DIR;

afterAll(() => {
  if (originalConfigDir !== undefined) {
    process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.OPENTABS_CONFIG_DIR;
  }
  rmSync(TEST_BASE_DIR, { recursive: true, force: true });
});

/**
 * Fresh-import the telemetry module to reset module-level state.
 * Uses vi.resetModules() to bust Vite's module cache, then re-imports.
 */
const importTelemetry = async () => {
  vi.resetModules();
  return import('./telemetry.js') as Promise<typeof import('./telemetry.js')>;
};

/** Create an isolated config directory for a single test. */
const makeTestDir = (): string => {
  const dir = mkdtempSync(join(TEST_BASE_DIR, 'case-'));
  process.env.OPENTABS_CONFIG_DIR = dir;
  return dir;
};

beforeEach(() => {
  vi.unstubAllEnvs();
  mockCapture.mockClear();
  mockShutdown.mockClear().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isTelemetryEnabled
// ---------------------------------------------------------------------------

describe('isTelemetryEnabled', () => {
  test('returns false when OPENTABS_TELEMETRY_DISABLED=1', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));
    vi.stubEnv('OPENTABS_TELEMETRY_DISABLED', '1');

    const { isTelemetryEnabled } = await importTelemetry();
    expect(await isTelemetryEnabled()).toBe(false);
  });

  test('returns false when DO_NOT_TRACK=1', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));
    vi.stubEnv('DO_NOT_TRACK', '1');

    const { isTelemetryEnabled } = await importTelemetry();
    expect(await isTelemetryEnabled()).toBe(false);
  });

  test('returns false when config.json has telemetry: false', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({ telemetry: false }));

    const { isTelemetryEnabled } = await importTelemetry();
    expect(await isTelemetryEnabled()).toBe(false);
  });

  test('returns true by default when no opt-out is configured', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));

    const { isTelemetryEnabled } = await importTelemetry();
    expect(await isTelemetryEnabled()).toBe(true);
  });

  test('returns true when config.json does not exist', async () => {
    makeTestDir();

    const { isTelemetryEnabled } = await importTelemetry();
    expect(await isTelemetryEnabled()).toBe(true);
  });

  test('OPENTABS_TELEMETRY_DISABLED takes priority over config telemetry: true', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({ telemetry: true }));
    vi.stubEnv('OPENTABS_TELEMETRY_DISABLED', '1');

    const { isTelemetryEnabled } = await importTelemetry();
    expect(await isTelemetryEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getOrCreateAnonymousId
// ---------------------------------------------------------------------------

describe('getOrCreateAnonymousId', () => {
  test('creates a new UUID file when none exists', async () => {
    const dir = makeTestDir();

    const { getOrCreateAnonymousId } = await importTelemetry();
    const id = await getOrCreateAnonymousId();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const written = await readFile(join(dir, 'telemetry-id'), 'utf-8');
    expect(written.trim()).toBe(id);
  });

  test('reads existing file when present', async () => {
    const dir = makeTestDir();
    const existingId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await writeFile(join(dir, 'telemetry-id'), `${existingId}\n`, 'utf-8');

    const { getOrCreateAnonymousId } = await importTelemetry();
    const id = await getOrCreateAnonymousId();

    expect(id).toBe(existingId);
  });

  test('generates a new ID when file is empty', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'telemetry-id'), '', 'utf-8');

    const { getOrCreateAnonymousId } = await importTelemetry();
    const id = await getOrCreateAnonymousId();

    expect(id).toMatch(/^[0-9a-f]{8}-/);

    const written = await readFile(join(dir, 'telemetry-id'), 'utf-8');
    expect(written.trim()).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// initTelemetry + trackEvent
// ---------------------------------------------------------------------------

describe('initTelemetry + trackEvent', () => {
  test('initializes PostHog client when telemetry is enabled', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));

    const { initTelemetry, trackEvent } = await importTelemetry();
    await initTelemetry();

    trackEvent('test_event', { key: 'value' });
    expect(mockCapture).toHaveBeenCalledOnce();
    expect(mockCapture.mock.calls[0]?.[0]).toMatchObject({
      event: 'test_event',
      properties: { key: 'value' },
    });
  });

  test('does not create PostHog client when telemetry is disabled', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({ telemetry: false }));

    const { initTelemetry, trackEvent } = await importTelemetry();
    await initTelemetry();

    trackEvent('ignored_event');
    expect(mockCapture).not.toHaveBeenCalled();
  });

  test('trackEvent is a no-op before initTelemetry', async () => {
    makeTestDir();

    const { trackEvent } = await importTelemetry();
    trackEvent('orphan_event');

    expect(mockCapture).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// trackEvent — error resilience
// ---------------------------------------------------------------------------

describe('trackEvent error resilience', () => {
  test('does not throw when PostHog capture throws', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));
    mockCapture.mockImplementation(() => {
      throw new Error('PostHog failed');
    });

    const { initTelemetry, trackEvent } = await importTelemetry();
    await initTelemetry();

    expect(() => trackEvent('bad_event')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Debug mode
// ---------------------------------------------------------------------------

describe('debug mode', () => {
  test('prints events to stderr instead of sending to PostHog', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));
    vi.stubEnv('OPENTABS_TELEMETRY_DEBUG', '1');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const { initTelemetry, trackEvent } = await importTelemetry();
    await initTelemetry();

    trackEvent('debug_event', { foo: 'bar' });

    expect(stderrSpy).toHaveBeenCalledWith('[telemetry] debug_event {"foo":"bar"}\n');
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// shutdownTelemetry
// ---------------------------------------------------------------------------

describe('shutdownTelemetry', () => {
  test('calls client.shutdown when client exists', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));

    const { initTelemetry, shutdownTelemetry } = await importTelemetry();
    await initTelemetry();

    await shutdownTelemetry();
    expect(mockShutdown).toHaveBeenCalledOnce();
  });

  test('resolves without error when no client', async () => {
    makeTestDir();

    const { shutdownTelemetry } = await importTelemetry();
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });

  test('does not throw when client.shutdown rejects', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));
    mockShutdown.mockRejectedValue(new Error('shutdown failed'));

    const { initTelemetry, shutdownTelemetry } = await importTelemetry();
    await initTelemetry();

    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});
