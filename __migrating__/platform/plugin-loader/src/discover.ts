// =============================================================================
// Plugin Discovery
//
// Scans the filesystem for installed OpenTabs plugins. Supports three
// discovery mechanisms:
//
// 1. **Automatic**: Scan node_modules for packages matching the naming
//    convention (@opentabs/plugin-* or opentabs-plugin-*) or containing
//    the "opentabs-plugin" keyword in package.json.
//
// 2. **Explicit**: Read a list of plugin package names from an
//    opentabs.config.ts or opentabs.config.json configuration file.
//
// 3. **Local**: Resolve plugins from relative filesystem paths (for
//    development and monorepo setups).
//
// Discovery produces DiscoveredPlugin objects — raw manifest + paths — which
// are then validated by validate.ts and resolved by merge.ts.
// =============================================================================

import { readFile, readdir, access, stat } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * A plugin discovered on the filesystem but not yet validated or resolved.
 * Contains the raw manifest JSON and filesystem paths.
 */
export interface DiscoveredPlugin {
  /** The npm package name (e.g. 'opentabs-plugin-jira', '@opentabs/plugin-slack'). */
  readonly packageName: string;

  /** Absolute path to the plugin package root directory. */
  readonly packagePath: string;

  /** Absolute path to the opentabs-plugin.json manifest file. */
  readonly manifestPath: string;

  /** The raw parsed manifest (not yet validated). */
  readonly rawManifest: unknown;

  /**
   * How the plugin was discovered:
   * - 'automatic': Found by scanning node_modules
   * - 'explicit': Listed in opentabs.config
   * - 'local': Resolved from a relative path
   */
  readonly discoverySource: 'automatic' | 'explicit' | 'local';
}

/**
 * Configuration for explicit plugin loading. Corresponds to the content
 * of opentabs.config.ts or opentabs.config.json.
 */
export interface OpenTabsConfig {
  /**
   * List of plugins to load. Each entry can be:
   * - An npm package name: 'opentabs-plugin-jira'
   * - A scoped package: '@company/opentabs-plugin-internal'
   * - A relative path: './plugins/my-plugin'
   */
  readonly plugins?: readonly string[];

  /**
   * Per-plugin settings overrides.
   * Keys are plugin names (not package names), values are arbitrary settings.
   */
  readonly settings?: Record<string, Record<string, unknown>>;

  /**
   * Whether to also run automatic discovery in addition to the explicit list.
   * Default: true. Set to false to only load explicitly listed plugins.
   */
  readonly autoDiscover?: boolean;
}

/**
 * Options for the discovery process.
 */
export interface DiscoveryOptions {
  /**
   * The root directory to start searching from. Typically the project root
   * (where package.json and node_modules live).
   * Default: process.cwd()
   */
  readonly rootDir?: string;

  /**
   * Explicit configuration. When provided, takes precedence over searching
   * for an opentabs.config file on disk.
   */
  readonly config?: OpenTabsConfig;

  /**
   * Whether to log discovery progress to stderr.
   * Default: false
   */
  readonly verbose?: boolean;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** The manifest filename that every plugin must have in its package root. */
const MANIFEST_FILENAME = 'opentabs-plugin.json';

/** The npm keyword used for automatic discovery. */
const PLUGIN_KEYWORD = 'opentabs-plugin';

/** Naming patterns for automatic discovery (without keyword scanning). */
const PLUGIN_NAME_PATTERNS = {
  /** Official plugins: @opentabs/plugin-<name> */
  official: /^@opentabs\/plugin-.+$/,
  /** Community plugins: opentabs-plugin-<name> */
  community: /^opentabs-plugin-.+$/,
};

/** Config file names to search for, in priority order. */
const CONFIG_FILENAMES = [
  'opentabs.config.ts',
  'opentabs.config.js',
  'opentabs.config.json',
];

// -----------------------------------------------------------------------------
// Filesystem Helpers
// -----------------------------------------------------------------------------

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const readJsonFile = async (path: string): Promise<unknown> => {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
};

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
};

// -----------------------------------------------------------------------------
// Config File Loading
// -----------------------------------------------------------------------------

/**
 * Search for and load an opentabs.config file from the project root.
 * Returns undefined if no config file is found.
 */
const findConfigFile = async (
  rootDir: string,
): Promise<OpenTabsConfig | undefined> => {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = join(rootDir, filename);
    if (!(await fileExists(configPath))) continue;

    if (filename.endsWith('.json')) {
      const raw = await readJsonFile(configPath);
      return raw as OpenTabsConfig;
    }

    // For .ts and .js configs, use dynamic import
    // The file must export a default OpenTabsConfig
    try {
      const configUrl = pathToFileURL(configPath).href;
      const mod = (await import(configUrl)) as {
        default?: OpenTabsConfig;
      };
      return mod.default;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[OpenTabs] Failed to load config file ${configPath}: ${message}`,
      );
    }
  }

  return undefined;
};

// -----------------------------------------------------------------------------
// Automatic Discovery — Scan node_modules
// -----------------------------------------------------------------------------

/**
 * Check if a package.json has the opentabs-plugin keyword.
 */
const hasPluginKeyword = (packageJson: Record<string, unknown>): boolean => {
  const keywords = packageJson.keywords;
  if (!Array.isArray(keywords)) return false;
  return keywords.includes(PLUGIN_KEYWORD);
};

/**
 * Check if a package name matches the plugin naming convention.
 */
const matchesPluginNamePattern = (name: string): boolean =>
  PLUGIN_NAME_PATTERNS.official.test(name) ||
  PLUGIN_NAME_PATTERNS.community.test(name);

/**
 * Try to discover a plugin from a package directory.
 * Returns a DiscoveredPlugin if the package has an opentabs-plugin.json,
 * or undefined if it's not a plugin.
 */
const tryDiscoverPackage = async (
  packageDir: string,
  packageName: string,
  source: 'automatic' | 'explicit' | 'local',
): Promise<DiscoveredPlugin | undefined> => {
  const manifestPath = join(packageDir, MANIFEST_FILENAME);

  if (!(await fileExists(manifestPath))) {
    return undefined;
  }

  try {
    const rawManifest = await readJsonFile(manifestPath);
    return {
      packageName,
      packagePath: packageDir,
      manifestPath,
      rawManifest,
      discoverySource: source,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[OpenTabs] Failed to read manifest from ${manifestPath}: ${message}`,
    );
    return undefined;
  }
};

/**
 * Scan a node_modules directory for plugin packages.
 * Handles both regular packages and scoped packages (@scope/package).
 */
const scanNodeModules = async (
  nodeModulesDir: string,
  verbose: boolean,
): Promise<DiscoveredPlugin[]> => {
  const discovered: DiscoveredPlugin[] = [];

  if (!(await isDirectory(nodeModulesDir))) {
    return discovered;
  }

  let entries: string[];
  try {
    entries = await readdir(nodeModulesDir);
  } catch {
    return discovered;
  }

  for (const entry of entries) {
    // Skip hidden directories and common non-package directories
    if (entry.startsWith('.') || entry === 'node_modules') continue;

    const entryPath = join(nodeModulesDir, entry);

    // Handle scoped packages (@opentabs/plugin-*)
    if (entry.startsWith('@')) {
      if (!(await isDirectory(entryPath))) continue;

      let scopedEntries: string[];
      try {
        scopedEntries = await readdir(entryPath);
      } catch {
        continue;
      }

      for (const scopedEntry of scopedEntries) {
        const scopedName = `${entry}/${scopedEntry}`;
        const scopedPath = join(entryPath, scopedEntry);

        // Check name pattern first (fast path)
        if (!matchesPluginNamePattern(scopedName)) {
          // Fall back to keyword check
          const pkgJsonPath = join(scopedPath, 'package.json');
          if (await fileExists(pkgJsonPath)) {
            try {
              const pkgJson = (await readJsonFile(pkgJsonPath)) as Record<
                string,
                unknown
              >;
              if (!hasPluginKeyword(pkgJson)) continue;
            } catch {
              continue;
            }
          } else {
            continue;
          }
        }

        const plugin = await tryDiscoverPackage(
          scopedPath,
          scopedName,
          'automatic',
        );
        if (plugin) {
          if (verbose) {
            console.error(`[OpenTabs] Discovered plugin: ${scopedName}`);
          }
          discovered.push(plugin);
        }
      }
      continue;
    }

    // Handle regular packages (opentabs-plugin-*)
    if (!matchesPluginNamePattern(entry)) {
      // Fall back to keyword check for packages that don't match the name pattern
      // but have the keyword (unlikely but supported)
      const pkgJsonPath = join(entryPath, 'package.json');
      if (await fileExists(pkgJsonPath)) {
        try {
          const pkgJson = (await readJsonFile(pkgJsonPath)) as Record<
            string,
            unknown
          >;
          if (!hasPluginKeyword(pkgJson)) continue;
        } catch {
          continue;
        }
      } else {
        continue;
      }
    }

    const plugin = await tryDiscoverPackage(entryPath, entry, 'automatic');
    if (plugin) {
      if (verbose) {
        console.error(`[OpenTabs] Discovered plugin: ${entry}`);
      }
      discovered.push(plugin);
    }
  }

  return discovered;
};

// -----------------------------------------------------------------------------
// Explicit Discovery — Resolve Named Packages
// -----------------------------------------------------------------------------

/**
 * Resolve a plugin by its package name or relative path.
 *
 * For npm package names: looks in node_modules.
 * For relative paths (starting with './' or '../'): resolves relative to rootDir.
 * For absolute paths: uses directly.
 */
const resolveExplicitPlugin = async (
  specifier: string,
  rootDir: string,
  verbose: boolean,
): Promise<DiscoveredPlugin | undefined> => {
  let packageDir: string;
  let packageName: string;
  let source: 'explicit' | 'local';

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    // Relative path — local plugin
    packageDir = resolve(rootDir, specifier);
    source = 'local';

    // Read package name from package.json
    const pkgJsonPath = join(packageDir, 'package.json');
    if (await fileExists(pkgJsonPath)) {
      try {
        const pkgJson = (await readJsonFile(pkgJsonPath)) as Record<
          string,
          unknown
        >;
        packageName =
          typeof pkgJson.name === 'string' ? pkgJson.name : specifier;
      } catch {
        packageName = specifier;
      }
    } else {
      packageName = specifier;
    }
  } else if (isAbsolute(specifier)) {
    // Absolute path — local plugin
    packageDir = specifier;
    source = 'local';

    const pkgJsonPath = join(packageDir, 'package.json');
    if (await fileExists(pkgJsonPath)) {
      try {
        const pkgJson = (await readJsonFile(pkgJsonPath)) as Record<
          string,
          unknown
        >;
        packageName =
          typeof pkgJson.name === 'string' ? pkgJson.name : specifier;
      } catch {
        packageName = specifier;
      }
    } else {
      packageName = specifier;
    }
  } else {
    // npm package name — look in node_modules
    packageDir = join(rootDir, 'node_modules', specifier);
    packageName = specifier;
    source = 'explicit';
  }

  if (!(await isDirectory(packageDir))) {
    console.error(
      `[OpenTabs] Plugin "${specifier}" not found at ${packageDir}`,
    );
    return undefined;
  }

  const plugin = await tryDiscoverPackage(packageDir, packageName, source);
  if (plugin) {
    if (verbose) {
      console.error(
        `[OpenTabs] Resolved ${source} plugin: ${packageName} (${packageDir})`,
      );
    }
  } else {
    console.error(
      `[OpenTabs] Plugin "${specifier}" found at ${packageDir} but missing ${MANIFEST_FILENAME}`,
    );
  }

  return plugin;
};

// -----------------------------------------------------------------------------
// Main Discovery Function
// -----------------------------------------------------------------------------

/**
 * Discover all installed OpenTabs plugins.
 *
 * Combines automatic discovery (scanning node_modules) with explicit
 * configuration (opentabs.config file or provided config object).
 *
 * Deduplicates by package name — explicit entries take precedence over
 * automatically discovered ones. This allows users to pin specific plugin
 * versions or paths while still benefiting from auto-discovery.
 *
 * @param options - Discovery options (root directory, config, verbosity)
 * @returns Array of discovered plugins (not yet validated)
 *
 * @example
 * ```ts
 * // Discover all plugins in the current project
 * const plugins = await discoverPlugins();
 *
 * // Discover with explicit config
 * const plugins = await discoverPlugins({
 *   config: {
 *     plugins: ['opentabs-plugin-jira', './my-local-plugin'],
 *     autoDiscover: true,
 *   },
 * });
 * ```
 */
export const discoverPlugins = async (
  options: DiscoveryOptions = {},
): Promise<DiscoveredPlugin[]> => {
  const rootDir = options.rootDir ?? process.cwd();
  const verbose = options.verbose ?? false;

  if (verbose) {
    console.error(`[OpenTabs] Discovering plugins from ${rootDir}`);
  }

  // Load config (explicit or from file)
  const config =
    options.config ?? (await findConfigFile(rootDir)) ?? { plugins: [] };

  const autoDiscover = config.autoDiscover !== false;
  const explicitPlugins = config.plugins ?? [];

  // Collect all discovered plugins, deduplicating by package name.
  // Explicit entries are processed first and take precedence.
  const byPackageName = new Map<string, DiscoveredPlugin>();

  // Phase 1: Resolve explicitly listed plugins
  for (const specifier of explicitPlugins) {
    const plugin = await resolveExplicitPlugin(specifier, rootDir, verbose);
    if (plugin) {
      byPackageName.set(plugin.packageName, plugin);
    }
  }

  // Phase 2: Automatic discovery from node_modules
  if (autoDiscover) {
    const nodeModulesDir = join(rootDir, 'node_modules');
    const autoPlugins = await scanNodeModules(nodeModulesDir, verbose);

    for (const plugin of autoPlugins) {
      // Explicit entries take precedence — don't overwrite
      if (!byPackageName.has(plugin.packageName)) {
        byPackageName.set(plugin.packageName, plugin);
      }
    }
  }

  const discovered = [...byPackageName.values()];

  if (verbose) {
    console.error(
      `[OpenTabs] Discovered ${discovered.length} plugin(s): ${discovered.map(p => p.packageName).join(', ') || '(none)'}`,
    );
  }

  return discovered;
};

/**
 * Determine the trust tier for a discovered plugin based on its package name
 * and discovery source.
 *
 * Trust tiers affect how the plugin is presented in the UI and whether the
 * user is prompted for approval.
 *
 * @param plugin - The discovered plugin
 * @returns The trust tier for the plugin
 */
export const determineTrustTier = (
  plugin: DiscoveredPlugin,
): 'official' | 'verified' | 'community' | 'local' => {
  if (plugin.discoverySource === 'local') return 'local';

  if (PLUGIN_NAME_PATTERNS.official.test(plugin.packageName)) {
    return 'official';
  }

  // Community plugins could be 'verified' if they're in the registry,
  // but that requires a registry lookup which is async. For now, all
  // non-official npm plugins are 'community'. The registry check can
  // be layered on top.
  return 'community';
};
