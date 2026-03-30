/**
 * Anonymous telemetry — follows the Next.js/Turborepo model.
 *
 * Completely anonymous (random UUIDv4, no PII, no IP logging), opt-out via
 * CLI command (`opentabs telemetry disable`), environment variable
 * (`OPENTABS_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`), or config file
 * (`telemetry: false` in config.json).
 *
 * Events are fire-and-forget — errors are caught silently and never propagate.
 * Debug mode (`OPENTABS_TELEMETRY_DEBUG=1`) prints events to stderr instead.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getConfigPath, getTelemetryIdPath } from '@opentabs-dev/shared';

const POSTHOG_API_KEY = 'phc_FeCHxj0woIHEoNjWPArv7gXr949jiCJUcF3JQr6gx9f';
const POSTHOG_HOST = 'https://us.i.posthog.com';

// Module-level state — initialized once per process via initTelemetry().
let client:
  | {
      capture: (opts: { distinctId: string; event: string; properties?: Record<string, unknown> }) => void;
      shutdown: () => Promise<void>;
    }
  | undefined;
let anonymousId: string | undefined;
let enabled = false;
let debugMode = false;

/**
 * Check whether telemetry is enabled by inspecting environment variables
 * and config.json. Checked in order (first match wins):
 *
 * 1. OPENTABS_TELEMETRY_DISABLED=1 → disabled
 * 2. DO_NOT_TRACK=1 → disabled (community standard)
 * 3. config.json `telemetry: false` → disabled
 * 4. Otherwise → enabled
 */
const isTelemetryEnabled = async (): Promise<boolean> => {
  if (process.env.OPENTABS_TELEMETRY_DISABLED === '1') return false;
  if (process.env.DO_NOT_TRACK === '1') return false;

  try {
    const raw = await readFile(getConfigPath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const config = parsed as Record<string, unknown>;
      if (config.telemetry === false) return false;
    }
  } catch {
    // Config file missing or unreadable — default to enabled
  }

  return true;
};

/**
 * Read or create the anonymous telemetry ID.
 * Stored at ~/.opentabs/telemetry-id as a plain UUIDv4 string.
 */
const getOrCreateAnonymousId = async (): Promise<string> => {
  const idPath = getTelemetryIdPath();

  try {
    const existing = await readFile(idPath, 'utf-8');
    const trimmed = existing.trim();
    if (trimmed.length > 0) return trimmed;
  } catch {
    // File doesn't exist — create one
  }

  const id = crypto.randomUUID();
  await mkdir(dirname(idPath), { recursive: true });
  await writeFile(idPath, `${id}\n`, 'utf-8');
  return id;
};

/**
 * Initialize telemetry. Call once on first server load (not on hot reload).
 * Creates the PostHog client and reads/creates the anonymous ID.
 * Safe to call even if posthog-node is not installed.
 */
const initTelemetry = async (): Promise<void> => {
  try {
    debugMode = process.env.OPENTABS_TELEMETRY_DEBUG === '1';

    if (!(await isTelemetryEnabled())) {
      enabled = false;
      return;
    }

    anonymousId = await getOrCreateAnonymousId();
    enabled = true;

    if (debugMode) return;

    const { PostHog } = await import('posthog-node');
    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  } catch {
    // posthog-node not installed or other init failure — telemetry disabled
    enabled = false;
  }
};

/**
 * Capture a telemetry event. Fire-and-forget: errors are caught silently.
 * In debug mode, prints the event to stderr instead of sending to PostHog.
 */
const trackEvent = (event: string, properties?: Record<string, unknown>): void => {
  if (!enabled || !anonymousId) return;

  try {
    if (debugMode) {
      process.stderr.write(`[telemetry] ${event} ${JSON.stringify(properties ?? {})}\n`);
      return;
    }

    client?.capture({ distinctId: anonymousId, event, properties });
  } catch {
    // Silently swallow — telemetry must never affect the server
  }
};

/**
 * Flush pending telemetry events. Call before process exit.
 * Has a 2-second timeout so it cannot prevent process exit.
 */
const shutdownTelemetry = async (): Promise<void> => {
  if (!client) return;

  try {
    await Promise.race([client.shutdown(), new Promise<void>(resolve => setTimeout(resolve, 2000))]);
  } catch {
    // Silently swallow — shutdown must never block
  }
};

export { getOrCreateAnonymousId, initTelemetry, isTelemetryEnabled, shutdownTelemetry, trackEvent };
