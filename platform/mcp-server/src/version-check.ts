/**
 * Outdated plugin version check.
 *
 * On startup, queries the npm registry for each npm-installed plugin
 * to check if a newer version is available. Non-blocking — runs in
 * the background and stores results in server state.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWindows, toErrorMessage } from '@opentabs-dev/shared';
import { log } from './logger.js';
import type { OutdatedPlugin, ServerState } from './state.js';
import { getSessionId, trackEvent } from './telemetry.js';
import { version } from './version.js';

/** Result of checking a single plugin for updates */
type CheckResult = { kind: 'outdated'; entry: OutdatedPlugin } | { kind: 'up-to-date' } | { kind: 'unreachable' };

/** Timeout for a single `npm view` query (10 seconds). */
const NPM_VIEW_TIMEOUT_MS = 10_000;

/**
 * Query the latest published version of a package via `npm view`.
 * Delegates auth to npm itself, which reads ~/.npmrc for tokens —
 * this handles private/scoped packages without manual token management.
 * Uses async `spawn` to avoid blocking the event loop.
 *
 * @param packageName - npm package name (e.g., 'opentabs-plugin-slack' or '@scope/opentabs-plugin-foo')
 * @returns The latest version string, or null on failure
 */
export const fetchLatestVersion = async (packageName: string): Promise<string | null> => {
  try {
    const child = spawn('npm', ['view', packageName, 'version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows(),
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`npm view timed out for ${packageName}`));
      }, NPM_VIEW_TIMEOUT_MS);

      child.on('error', err => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', code => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdoutChunks).toString(),
          stderr: Buffer.concat(stderrChunks).toString(),
        });
      });
    });

    if (result.exitCode !== 0) {
      log.debug(`npm view failed for ${packageName}: ${result.stderr.trim()}`);
      return null;
    }
    const version = result.stdout.trim();
    return version || null;
  } catch (e: unknown) {
    log.debug(`Failed to fetch latest version for ${packageName}: ${toErrorMessage(e)}`);
    return null;
  }
};

/**
 * Compare two semver version strings (major.minor.patch only).
 * Strips prerelease suffixes (e.g., "1.0.0-beta.1" → [1, 0, 0]) and leading 'v'
 * prefixes so that version strings with hyphens don't produce NaN during parsing.
 *
 * @param current - The currently installed version string
 * @param latest - The latest available version string
 * @returns True if `latest` is strictly newer than `current`
 */
export const isNewer = (current: string, latest: string): boolean => {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('.')
      .map(segment => {
        const hyphen = segment.indexOf('-');
        const numericVersion = Number(hyphen >= 0 ? segment.slice(0, hyphen) : segment);
        return Number.isFinite(numericVersion) ? numericVersion : 0;
      });

  const currentParts = parse(current);
  const latestParts = parse(latest);

  for (let i = 0; i < 3; i++) {
    const currentSegment = currentParts[i] ?? 0;
    const latestSegment = latestParts[i] ?? 0;
    if (latestSegment > currentSegment) return true;
    if (latestSegment < currentSegment) return false;
  }
  return false;
};

/** Absolute path to the MCP server's package directory (parent of dist/) */
const _serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A production npm install has 'node_modules' in the resolved server directory path */
const isProductionInstall = (): boolean => _serverDir.includes('node_modules');

const CLI_PACKAGE_NAME = '@opentabs-dev/cli';

/**
 * Check if a newer version of @opentabs-dev/cli is available on npm.
 * Only runs when the server is running from a production npm install
 * (serverSourcePath contains 'node_modules'), not from source.
 * Stores results in state.serverUpdate.
 *
 * @param state - Server state containing the serverUpdate target
 */
export const checkServerUpdate = async (state: ServerState): Promise<void> => {
  if (!isProductionInstall()) {
    state.serverUpdate = undefined;
    return;
  }

  const latest = await fetchLatestVersion(CLI_PACKAGE_NAME);
  if (!latest) return;

  if (isNewer(version, latest)) {
    state.serverUpdate = { latestVersion: latest, updateCommand: `npm install -g ${CLI_PACKAGE_NAME}` };
    trackEvent('server_update_available', {
      session_id: getSessionId(),
    });
    log.info(`${CLI_PACKAGE_NAME}: ${version} → ${latest}`);
  } else {
    state.serverUpdate = undefined;
  }
};

/**
 * Check all npm-installed plugins for newer versions on the registry.
 * Runs `npm view` queries concurrently via Promise.allSettled, logs
 * outdated entries, and stores results in `state.outdatedPlugins`.
 * Skips local plugins.
 *
 * @param state - Server state containing the plugin registry and outdatedPlugins target
 */
export const checkForUpdates = async (state: ServerState): Promise<void> => {
  const npmPlugins = Array.from(state.registry.plugins.values()).filter(p => p.source !== 'local' && p.npmPackageName);

  if (npmPlugins.length === 0) return;

  log.info(`Checking ${npmPlugins.length} npm plugin(s) for updates...`);

  const settled = await Promise.allSettled(
    npmPlugins.map(async (plugin): Promise<CheckResult> => {
      const pkgName = plugin.npmPackageName;
      if (!pkgName) return { kind: 'unreachable' };

      const latest = await fetchLatestVersion(pkgName);
      if (!latest) return { kind: 'unreachable' };

      if (isNewer(plugin.version, latest)) {
        return {
          kind: 'outdated',
          entry: {
            name: pkgName,
            currentVersion: plugin.version,
            latestVersion: latest,
            updateCommand: `npm update -g ${pkgName}`,
          },
        };
      }
      return { kind: 'up-to-date' };
    }),
  );

  const results: CheckResult[] = settled.map(s => (s.status === 'fulfilled' ? s.value : { kind: 'unreachable' }));

  const outdated: OutdatedPlugin[] = [];
  let unreachableCount = 0;
  for (const result of results) {
    if (result.kind === 'outdated') {
      outdated.push(result.entry);
    } else if (result.kind === 'unreachable') {
      unreachableCount++;
    }
  }

  state.outdatedPlugins = outdated;

  for (const entry of outdated) {
    log.info(`${entry.name}: ${entry.currentVersion} → ${entry.latestVersion} (run: ${entry.updateCommand})`);
  }

  const total = npmPlugins.length;
  if (unreachableCount === total) {
    log.warn('Could not check for plugin updates — npm registry unreachable');
  } else if (unreachableCount > 0 && outdated.length === 0) {
    log.info(
      `Checked ${total - unreachableCount} of ${total} npm plugins for updates (${unreachableCount} unreachable)`,
    );
  } else if (outdated.length === 0) {
    log.info('All npm plugins are up to date');
  }
};
