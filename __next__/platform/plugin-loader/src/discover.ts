import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TrustTier } from '@opentabs/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** How a plugin was discovered */
type DiscoverySource = 'npm-convention' | 'npm-keyword' | 'config' | 'project-config';

/** Metadata about a discovered plugin (before loading) */
interface DiscoveredPlugin {
  /** Absolute path to the plugin package root */
  readonly packagePath: string;
  /** npm package name (e.g., "@opentabs/plugin-slack") */
  readonly packageName: string;
  /** How the plugin was discovered */
  readonly source: DiscoverySource;
  /** Trust tier based on how the plugin was discovered */
  readonly trustTier: TrustTier;
}

/** Options for discoverPlugins() */
interface DiscoverOptions {
  /** Working directory for node_modules scanning (defaults to process.cwd()) */
  readonly cwd?: string;
  /** Plugin entries from config files (e.g., ~/.opentabs/config.json) */
  readonly configPlugins?: readonly string[];
  /** Plugin entries from project-level opentabs.config */
  readonly projectPlugins?: readonly string[];
}

/** Result of plugin discovery */
interface DiscoverResult {
  readonly plugins: readonly DiscoveredPlugin[];
  readonly errors: readonly string[];
}

// ---------------------------------------------------------------------------
// Naming conventions
// ---------------------------------------------------------------------------

/** Official plugin prefix: @opentabs/plugin-<name> */
const OFFICIAL_PREFIX = '@opentabs/plugin-';

/** Community plugin prefix: opentabs-plugin-<name> */
const COMMUNITY_PREFIX = 'opentabs-plugin-';

/** Keyword that identifies OpenTabs plugins in package.json */
const PLUGIN_KEYWORD = 'opentabs-plugin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PackageJson {
  readonly name?: string;
  readonly keywords?: readonly string[];
}

/**
 * Reads and parses a package.json at the given directory.
 * Returns undefined if the file doesn't exist or is invalid JSON.
 */
const readPackageJson = (dir: string): PackageJson | undefined => {
  const pkgPath = path.join(dir, 'package.json');
  try {
    const content = fs.readFileSync(pkgPath, 'utf8');
    return JSON.parse(content) as PackageJson;
  } catch {
    return undefined;
  }
};

/**
 * Checks whether a plugin manifest file exists at the given package path.
 */
const hasPluginManifest = (packagePath: string): boolean => {
  const manifestPath = path.join(packagePath, 'opentabs-plugin.json');
  return fs.existsSync(manifestPath);
};

/**
 * Determines trust tier from discovery context.
 * - @opentabs/plugin-* packages are official
 * - npm packages discovered via keyword or community prefix are community
 * - Local filesystem paths are local
 */
const determineTrustTier = (packageName: string, source: DiscoverySource): TrustTier => {
  if (source === 'config' || source === 'project-config') {
    if (packageName.startsWith(OFFICIAL_PREFIX)) return 'official';
    if (packageName.startsWith(COMMUNITY_PREFIX)) return 'community';
    return 'local';
  }
  if (packageName.startsWith(OFFICIAL_PREFIX)) return 'official';
  return 'community';
};

/**
 * Checks if a path is a local filesystem path (starts with ./, ../, or is absolute).
 */
const isLocalPath = (entry: string): boolean =>
  entry.startsWith('./') || entry.startsWith('../') || path.isAbsolute(entry);

/**
 * Resolves a local plugin path to absolute path and reads its package name.
 */
const resolveLocalPlugin = (entry: string, basePath: string, source: DiscoverySource): DiscoveredPlugin | string => {
  const absolutePath = path.isAbsolute(entry) ? entry : path.resolve(basePath, entry);

  if (!fs.existsSync(absolutePath)) {
    return `Local plugin path does not exist: ${absolutePath}`;
  }

  if (!fs.statSync(absolutePath).isDirectory()) {
    return `Local plugin path is not a directory: ${absolutePath}`;
  }

  const pkg = readPackageJson(absolutePath);
  const packageName = pkg?.name ?? path.basename(absolutePath);

  if (!hasPluginManifest(absolutePath)) {
    return `No opentabs-plugin.json found at: ${absolutePath}`;
  }

  return {
    packagePath: absolutePath,
    packageName,
    source,
    trustTier: 'local',
  };
};

/**
 * Resolves an npm package name to its path in node_modules.
 */
const resolveNpmPlugin = (packageName: string, cwd: string, source: DiscoverySource): DiscoveredPlugin | string => {
  const packagePath = path.join(cwd, 'node_modules', ...packageName.split('/'));

  if (!fs.existsSync(packagePath)) {
    return `Package not found in node_modules: ${packageName}`;
  }

  if (!hasPluginManifest(packagePath)) {
    return `No opentabs-plugin.json found for package: ${packageName}`;
  }

  return {
    packagePath,
    packageName,
    source,
    trustTier: determineTrustTier(packageName, source),
  };
};

// ---------------------------------------------------------------------------
// Auto-discovery from node_modules
// ---------------------------------------------------------------------------

/**
 * Scans node_modules for packages matching OpenTabs plugin naming conventions
 * and the opentabs-plugin keyword.
 */
const scanNodeModules = (cwd: string): { plugins: DiscoveredPlugin[]; errors: string[] } => {
  const nodeModulesPath = path.join(cwd, 'node_modules');
  const plugins: DiscoveredPlugin[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  if (!fs.existsSync(nodeModulesPath)) {
    return { plugins, errors };
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(nodeModulesPath);
  } catch {
    return { plugins, errors };
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;

    if (entry.startsWith('@')) {
      // Scoped packages: scan @scope/plugin-* directories
      const scopePath = path.join(nodeModulesPath, entry);
      let scopedEntries: string[];
      try {
        scopedEntries = fs.readdirSync(scopePath);
      } catch {
        continue;
      }

      for (const scopedEntry of scopedEntries) {
        const fullName = `${entry}/${scopedEntry}`;
        const packagePath = path.join(scopePath, scopedEntry);

        // Check naming convention match
        if (fullName.startsWith(OFFICIAL_PREFIX) || fullName.startsWith(COMMUNITY_PREFIX)) {
          if (!seen.has(fullName) && hasPluginManifest(packagePath)) {
            seen.add(fullName);
            plugins.push({
              packagePath,
              packageName: fullName,
              source: 'npm-convention',
              trustTier: determineTrustTier(fullName, 'npm-convention'),
            });
          }
          continue;
        }

        // Fallback: check keyword
        if (!seen.has(fullName)) {
          const pkg = readPackageJson(packagePath);
          if (pkg?.keywords?.includes(PLUGIN_KEYWORD) && hasPluginManifest(packagePath)) {
            seen.add(fullName);
            plugins.push({
              packagePath,
              packageName: fullName,
              source: 'npm-keyword',
              trustTier: 'community',
            });
          }
        }
      }
    } else {
      const packagePath = path.join(nodeModulesPath, entry);

      // Check naming convention match (unscoped community plugins)
      if (entry.startsWith(COMMUNITY_PREFIX)) {
        if (!seen.has(entry) && hasPluginManifest(packagePath)) {
          seen.add(entry);
          plugins.push({
            packagePath,
            packageName: entry,
            source: 'npm-convention',
            trustTier: 'community',
          });
        }
        continue;
      }

      // Fallback: check keyword
      if (!seen.has(entry)) {
        const pkg = readPackageJson(packagePath);
        if (pkg?.keywords?.includes(PLUGIN_KEYWORD) && hasPluginManifest(packagePath)) {
          seen.add(entry);
          plugins.push({
            packagePath,
            packageName: entry,
            source: 'npm-keyword',
            trustTier: 'community',
          });
        }
      }
    }
  }

  return { plugins, errors };
};

// ---------------------------------------------------------------------------
// Config-based discovery
// ---------------------------------------------------------------------------

/**
 * Resolves plugin entries from config files.
 * Entries can be npm package names or local filesystem paths.
 */
const resolveConfigEntries = (
  entries: readonly string[],
  cwd: string,
  source: DiscoverySource,
): { plugins: DiscoveredPlugin[]; errors: string[] } => {
  const plugins: DiscoveredPlugin[] = [];
  const errors: string[] = [];

  for (const entry of entries) {
    if (isLocalPath(entry)) {
      const result = resolveLocalPlugin(entry, cwd, source);
      if (typeof result === 'string') {
        errors.push(result);
      } else {
        plugins.push(result);
      }
    } else {
      const result = resolveNpmPlugin(entry, cwd, source);
      if (typeof result === 'string') {
        errors.push(result);
      } else {
        plugins.push({ ...result, source, trustTier: determineTrustTier(entry, source) });
      }
    }
  }

  return { plugins, errors };
};

// ---------------------------------------------------------------------------
// Project config (opentabs.config.json)
// ---------------------------------------------------------------------------

interface OpenTabsProjectConfig {
  readonly plugins?: readonly string[];
}

/**
 * Reads the project-level opentabs.config.json from the working directory.
 * Returns an empty config if the file doesn't exist.
 */
const readProjectConfig = (cwd: string): OpenTabsProjectConfig => {
  const configPath = path.join(cwd, 'opentabs.config.json');
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content) as OpenTabsProjectConfig;
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------------

/**
 * Discovers all available OpenTabs plugins from multiple sources.
 *
 * Discovery sources (in priority order — later sources override earlier):
 * 1. Auto-scan node_modules for naming conventions and keywords
 * 2. Config file entries (e.g., from ~/.opentabs/config.json)
 * 3. Project-level opentabs.config.json entries
 *
 * Explicit config entries take precedence over auto-discovered duplicates.
 */
const discoverPlugins = (options: DiscoverOptions = {}): DiscoverResult => {
  const cwd = options.cwd ?? process.cwd();
  const allErrors: string[] = [];

  // 1. Auto-discover from node_modules
  const autoDiscovered = scanNodeModules(cwd);
  allErrors.push(...autoDiscovered.errors);

  // 2. Resolve config file entries
  const configResolved = options.configPlugins
    ? resolveConfigEntries(options.configPlugins, cwd, 'config')
    : { plugins: [], errors: [] };
  allErrors.push(...configResolved.errors);

  // 3. Read and resolve project-level opentabs.config.json
  const projectConfig = readProjectConfig(cwd);
  const projectPlugins = options.projectPlugins ?? projectConfig.plugins ?? [];
  const projectResolved =
    projectPlugins.length > 0
      ? resolveConfigEntries(projectPlugins, cwd, 'project-config')
      : { plugins: [], errors: [] };
  allErrors.push(...projectResolved.errors);

  // Merge: explicit entries take precedence over auto-discovered duplicates.
  // Use packageName as the dedup key. Later additions override earlier ones.
  const pluginMap = new Map<string, DiscoveredPlugin>();

  // Auto-discovered first (lowest priority)
  for (const plugin of autoDiscovered.plugins) {
    pluginMap.set(plugin.packageName, plugin);
  }

  // Config entries override auto-discovered
  for (const plugin of configResolved.plugins) {
    pluginMap.set(plugin.packageName, plugin);
  }

  // Project config entries have highest priority
  for (const plugin of projectResolved.plugins) {
    pluginMap.set(plugin.packageName, plugin);
  }

  return {
    plugins: [...pluginMap.values()],
    errors: allErrors,
  };
};

export {
  discoverPlugins,
  readProjectConfig,
  scanNodeModules,
  isLocalPath,
  OFFICIAL_PREFIX,
  COMMUNITY_PREFIX,
  PLUGIN_KEYWORD,
  type DiscoveredPlugin,
  type DiscoverOptions,
  type DiscoverResult,
  type DiscoverySource,
  type OpenTabsProjectConfig,
};
