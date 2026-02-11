/**
 * Outdated plugin version check.
 *
 * On startup, queries the npm registry for each npm-installed plugin
 * to check if a newer version is available. Non-blocking — runs in
 * the background and stores results in server state.
 */

import type { ServerState, OutdatedPlugin } from "./state.js";

/** npm registry response shape (minimal) */
interface NpmRegistryResponse {
  "dist-tags"?: {
    latest?: string;
  };
}

/**
 * Query the npm registry for the latest version of a package.
 * Returns null if the fetch fails or the response is unexpected.
 */
const fetchLatestVersion = async (
  packageName: string
): Promise<string | null> => {
  try {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as NpmRegistryResponse;
    return data["dist-tags"]?.latest ?? null;
  } catch {
    return null;
  }
};

/**
 * Compare two semver version strings.
 * Returns true if `latest` is newer than `current`.
 */
const isNewer = (current: string, latest: string): boolean => {
  const parse = (v: string): number[] =>
    v.replace(/^v/, "").split(".").map(Number);

  const c = parse(current);
  const l = parse(latest);

  for (let i = 0; i < 3; i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
};

/**
 * Check all npm-installed plugins for newer versions.
 * Non-blocking — runs checks in parallel, logs results, and stores in state.
 * Skips local plugins (filesystem paths).
 */
export const checkForUpdates = async (state: ServerState): Promise<void> => {
  const npmPlugins = Array.from(state.plugins.values()).filter(
    (p) => p.trustTier !== "local" && p.npmPackageName
  );

  if (npmPlugins.length === 0) return;

  console.log(
    `[opentabs] Checking ${npmPlugins.length} npm plugin(s) for updates...`
  );

  const results = await Promise.allSettled(
    npmPlugins.map(async (plugin) => {
      const latest = await fetchLatestVersion(plugin.npmPackageName!);
      if (!latest) return null;

      if (isNewer(plugin.version, latest)) {
        const outdated: OutdatedPlugin = {
          name: plugin.npmPackageName!,
          currentVersion: plugin.version,
          latestVersion: latest,
          updateCommand: `bun update ${plugin.npmPackageName!}`,
        };
        return outdated;
      }
      return null;
    })
  );

  const outdated: OutdatedPlugin[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      outdated.push(result.value);
    }
  }

  state.outdatedPlugins = outdated;

  for (const o of outdated) {
    console.log(
      `[opentabs] ${o.name}: ${o.currentVersion} → ${o.latestVersion} (run: ${o.updateCommand})`
    );
  }

  if (outdated.length === 0 && npmPlugins.length > 0) {
    console.log("[opentabs] All npm plugins are up to date");
  }
};
