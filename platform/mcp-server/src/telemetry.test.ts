import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// --- PostHog mock via vi.mock ---

const { mockCapture, mockIdentify, mockShutdown, mockConstructorOptions } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
  mockIdentify: vi.fn(),
  mockShutdown: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  mockConstructorOptions: { captured: undefined as Record<string, unknown> | undefined },
}));

vi.mock('posthog-node', () => ({
  PostHog: class MockPostHog {
    constructor(_key: string, options?: Record<string, unknown>) {
      mockConstructorOptions.captured = options;
    }
    capture = mockCapture;
    identify = mockIdentify;
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
  mockIdentify.mockClear();
  mockShutdown.mockClear().mockResolvedValue(undefined);
  mockConstructorOptions.captured = undefined;
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

// ---------------------------------------------------------------------------
// disableGeoip
// ---------------------------------------------------------------------------

describe('disableGeoip', () => {
  test('passes disableGeoip: true to PostHog constructor', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));

    const { initTelemetry } = await importTelemetry();
    await initTelemetry();

    expect(mockConstructorOptions.captured).toMatchObject({ disableGeoip: true });
  });
});

// ---------------------------------------------------------------------------
// getSessionId
// ---------------------------------------------------------------------------

describe('getSessionId', () => {
  test('returns empty string before initTelemetry', async () => {
    makeTestDir();

    const { getSessionId } = await importTelemetry();
    expect(getSessionId()).toBe('');
  });

  test('returns a UUIDv4 after initTelemetry', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));

    const { initTelemetry, getSessionId } = await importTelemetry();
    await initTelemetry();

    const id = getSessionId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('returns consistent value within same module instance', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));

    const { initTelemetry, getSessionId } = await importTelemetry();
    await initTelemetry();

    expect(getSessionId()).toBe(getSessionId());
  });

  test('session_id differs from persistent telemetry-id file', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));

    const { initTelemetry, getSessionId, getOrCreateAnonymousId } = await importTelemetry();
    await initTelemetry();

    const anonId = await getOrCreateAnonymousId();
    expect(getSessionId()).not.toBe(anonId);
  });
});

// ---------------------------------------------------------------------------
// identifyPerson
// ---------------------------------------------------------------------------

describe('identifyPerson', () => {
  test('calls client.identify with $set and $set_once properties', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));

    const { initTelemetry, identifyPerson } = await importTelemetry();
    await initTelemetry();

    identifyPerson({
      $set: { version: '1.0.0', mode: 'production' },
      $set_once: { os: 'darwin', arch: 'arm64', node_version: 'v22.11.0' },
    });

    expect(mockIdentify).toHaveBeenCalledOnce();
    expect(mockIdentify.mock.calls[0]?.[0]).toMatchObject({
      distinctId: expect.any(String),
      properties: {
        $set: { version: '1.0.0', mode: 'production' },
        $set_once: { os: 'darwin', arch: 'arm64', node_version: 'v22.11.0' },
      },
    });
  });

  test('is a no-op when telemetry is disabled', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({ telemetry: false }));

    const { initTelemetry, identifyPerson } = await importTelemetry();
    await initTelemetry();

    identifyPerson({
      $set: { version: '1.0.0' },
      $set_once: { os: 'darwin' },
    });

    expect(mockIdentify).not.toHaveBeenCalled();
  });

  test('is a no-op before initTelemetry', async () => {
    makeTestDir();

    const { identifyPerson } = await importTelemetry();
    identifyPerson({
      $set: { version: '1.0.0' },
      $set_once: { os: 'darwin' },
    });

    expect(mockIdentify).not.toHaveBeenCalled();
  });

  test('does not throw when client.identify throws', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));
    mockIdentify.mockImplementation(() => {
      throw new Error('identify failed');
    });

    const { initTelemetry, identifyPerson } = await importTelemetry();
    await initTelemetry();

    expect(() =>
      identifyPerson({
        $set: { version: '1.0.0' },
        $set_once: { os: 'darwin' },
      }),
    ).not.toThrow();
  });

  test('prints to stderr in debug mode instead of calling client.identify', async () => {
    const dir = makeTestDir();
    await writeFile(join(dir, 'config.json'), JSON.stringify({}));
    vi.stubEnv('OPENTABS_TELEMETRY_DEBUG', '1');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const { initTelemetry, identifyPerson } = await importTelemetry();
    await initTelemetry();

    identifyPerson({
      $set: { version: '1.0.0' },
      $set_once: { os: 'darwin' },
    });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[telemetry] identify'));
    expect(mockIdentify).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// computeErrorRateBucket
// ---------------------------------------------------------------------------

describe('computeErrorRateBucket', () => {
  test('returns 0% when both total and errors are 0', async () => {
    const { computeErrorRateBucket } = await importTelemetry();
    expect(computeErrorRateBucket(0, 0)).toBe('0%');
  });

  test('returns 0% when total is positive but errors is 0', async () => {
    const { computeErrorRateBucket } = await importTelemetry();
    expect(computeErrorRateBucket(100, 0)).toBe('0%');
  });

  test('returns <5% when error rate is below 5%', async () => {
    const { computeErrorRateBucket } = await importTelemetry();
    expect(computeErrorRateBucket(100, 1)).toBe('<5%');
  });

  test('returns <25% when error rate is between 5% and 25%', async () => {
    const { computeErrorRateBucket } = await importTelemetry();
    expect(computeErrorRateBucket(100, 10)).toBe('<25%');
  });

  test('returns >=25% when error rate is 25% or above', async () => {
    const { computeErrorRateBucket } = await importTelemetry();
    expect(computeErrorRateBucket(100, 50)).toBe('>=25%');
  });
});

// ---------------------------------------------------------------------------
// classifyLoadFailures
// ---------------------------------------------------------------------------

describe('classifyLoadFailures', () => {
  test('correctly categorizes failure types', async () => {
    const { classifyLoadFailures } = await importTelemetry();

    const failures = [
      { path: '/some/path', error: 'ENOENT: no such file or directory, open dist/adapter.iife.js' },
      { path: '/other', error: 'Invalid tools.json: missing name field' },
      { path: '/third', error: 'Schema compilation failed: invalid pattern keyword' },
      { path: '/fourth', error: 'Unexpected token in package.json' },
      { path: '/fifth', error: 'Completely unknown error' },
    ];

    const result = classifyLoadFailures(failures);
    expect(result).toEqual({
      missing_adapter: 1,
      invalid_manifest: 2,
      schema_error: 1,
      unknown: 1,
    });
  });

  test('returns all zeros for empty array', async () => {
    const { classifyLoadFailures } = await importTelemetry();

    expect(classifyLoadFailures([])).toEqual({
      missing_adapter: 0,
      invalid_manifest: 0,
      schema_error: 0,
      unknown: 0,
    });
  });

  test('classifies adapter-related errors as missing_adapter', async () => {
    const { classifyLoadFailures } = await importTelemetry();

    const failures = [
      { path: '/a', error: 'Adapter IIFE not found at dist/adapter.iife.js' },
      { path: '/b', error: 'ENOENT: no such file or directory' },
    ];

    expect(classifyLoadFailures(failures).missing_adapter).toBe(2);
  });

  test('classifies sdk-related errors as schema_error', async () => {
    const { classifyLoadFailures } = await importTelemetry();

    const failures = [{ path: '/a', error: 'SDK version mismatch' }];

    expect(classifyLoadFailures(failures).schema_error).toBe(1);
  });
});
