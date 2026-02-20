/**
 * Outdated plugin version check.
 *
 * On startup, queries the npm registry for each npm-installed plugin
 * to check if a newer version is available. Non-blocking — runs in
 * the background and stores results in server state.
 */

import { log } from './logger.js';
import type { ServerState, OutdatedPlugin } from './state.js';

/** npm registry response shape (minimal) */
interface NpmRegistryResponse {
  'dist-tags'?: {
    latest?: string;
  };
}

/**
 * Query the npm registry for the latest version of a package.
 * Returns null if the fetch fails or the response is unexpected.
 */
export const fetchLatestVersion = async (packageName: string): Promise<string | null> => {
  try {
    // Scoped packages use @scope%2Fpkg-name format in the registry URL.
    // Encode each segment separately to preserve the @ prefix.
    const encodedName = packageName.startsWith('@')
      ? '@' + packageName.slice(1).replace('/', '%2F')
      : encodeURIComponent(packageName);
    const url = `https://registry.npmjs.org/${encodedName}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const registryResponse = (await response.json()) as NpmRegistryResponse;
    return registryResponse['dist-tags']?.latest ?? null;
  } catch {
    return null;
  }
};

/**
 * Compare two semver version strings.
 * Returns true if `latest` is newer than `current`.
 *
 * Strips prerelease suffixes (e.g., "1.0.0-beta.1" → [1, 0, 0]) so
 * that version strings with hyphens don't produce NaN during parsing.
 */
export const isNewer = (current: string, latest: string): boolean => {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('.')
      .map(segment => {
        const hyphen = segment.indexOf('-');
        const n = Number(hyphen >= 0 ? segment.slice(0, hyphen) : segment);
        return Number.isFinite(n) ? n : 0;
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

/**
 * Check all npm-installed plugins for newer versions.
 * Non-blocking — runs checks in parallel, logs results, and stores in state.
 * Skips local plugins (filesystem paths).
 */
export const checkForUpdates = async (state: ServerState): Promise<void> => {
  const npmPlugins = Array.from(state.plugins.values()).filter(p => p.trustTier !== 'local' && p.npmPackageName);

  if (npmPlugins.length === 0) return;

  log.info(`Checking ${npmPlugins.length} npm plugin(s) for updates...`);

  const results = await Promise.allSettled(
    npmPlugins.map(async plugin => {
      const pkgName = plugin.npmPackageName;
      if (!pkgName) return null;

      const latest = await fetchLatestVersion(pkgName);
      if (!latest) return null;

      if (isNewer(plugin.version, latest)) {
        const outdated: OutdatedPlugin = {
          name: pkgName,
          currentVersion: plugin.version,
          latestVersion: latest,
          updateCommand: `bun update ${pkgName}`,
        };
        return outdated;
      }
      return null;
    }),
  );

  const outdated: OutdatedPlugin[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      outdated.push(result.value);
    }
  }

  state.outdatedPlugins = outdated;

  for (const entry of outdated) {
    log.info(`${entry.name}: ${entry.currentVersion} → ${entry.latestVersion} (run: ${entry.updateCommand})`);
  }

  if (outdated.length === 0 && npmPlugins.length > 0) {
    log.info('All npm plugins are up to date');
  }
};
