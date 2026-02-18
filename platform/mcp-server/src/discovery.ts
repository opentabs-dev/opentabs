/**
 * Plugin discovery module.
 *
 * Discovers plugins from:
 * 1. node_modules (packages matching opentabs-plugin-* or @* /opentabs-plugin-*)
 * 2. Packages with 'opentabs-plugin' keyword in package.json
 * 3. Local filesystem paths from ~/.opentabs/config.json
 *
 * For each plugin: reads opentabs-plugin.json manifest and dist/adapter.iife.js,
 * determines trust tier, validates, and registers in server state.
 *
 * Returns a new Map of plugins — the caller swaps it onto state atomically
 * to avoid a window where state.plugins is empty during async discovery.
 */

import { log } from './logger.js';
import { parseManifest } from './manifest-schema.js';
import { validatePluginName, validateUrlPattern } from '@opentabs-dev/shared';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RegisteredPlugin } from './state.js';
import type { TrustTier } from '@opentabs-dev/shared';

/**
 * The mcp-server package root directory, resolved from this module's URL.
 * Used as the default rootDir for npm plugin discovery so that `node_modules`
 * scanning works regardless of the process's working directory.
 */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Result of attempting to load a single plugin */
interface DiscoveryResult {
  plugin: RegisteredPlugin;
  source: string;
}

/**
 * Extract the plugin name from an npm package name.
 * opentabs-plugin-slack → slack
 * @myorg/opentabs-plugin-jira → myorg-jira
 */
const pluginNameFromPackage = (pkgName: string): string => {
  if (pkgName.startsWith('@')) {
    // Scoped: @scope/opentabs-plugin-name → scope-name
    const parts = pkgName.split('/');
    const scopePart = parts[0] ?? '';
    const namePart = parts[1] ?? '';
    const scope = scopePart.slice(1); // remove @
    const pluginSuffix = namePart.replace(/^opentabs-plugin-/, '');
    return `${scope}-${pluginSuffix}`;
  }
  return pkgName.replace(/^opentabs-plugin-/, '');
};

/**
 * Determine trust tier from how the plugin was discovered.
 */
const determineTrustTier = (pkgName: string | null, isLocal: boolean): TrustTier => {
  if (isLocal) return 'local';
  if (pkgName && pkgName.startsWith('@opentabs-dev/')) return 'official';
  return 'community';
};

/**
 * Load a single plugin from a directory.
 * Reads opentabs-plugin.json and dist/adapter.iife.js.
 */
const loadPluginFromDir = async (
  dir: string,
  trustTier: TrustTier,
  npmPkgName: string | null,
  sourcePath?: string,
): Promise<RegisteredPlugin> => {
  const manifestPath = join(dir, 'opentabs-plugin.json');
  const iifePath = join(dir, 'dist', 'adapter.iife.js');

  // Read and validate manifest
  const manifestRaw = await Bun.file(manifestPath).text();
  const manifest = parseManifest(manifestRaw, manifestPath);

  // Derive the internal plugin name.
  // Handles both bare names ("slack") and legacy prefixed names ("opentabs-plugin-slack").
  let pluginName: string;
  if (npmPkgName) {
    pluginName = pluginNameFromPackage(npmPkgName);
    const manifestBare = manifest.name.replace(/^opentabs-plugin-/, '');
    if (manifestBare !== pluginName) {
      log.warn(
        `Plugin manifest name "${manifest.name}" doesn't match package name "${npmPkgName}" (expected plugin name: ${pluginName}, got: ${manifestBare})`,
      );
    }
  } else {
    // Local plugin — strip legacy prefix if present
    pluginName = manifest.name.replace(/^opentabs-plugin-/, '');
  }

  // Validate plugin name
  const nameError = validatePluginName(pluginName);
  if (nameError) {
    throw new Error(nameError);
  }

  // Validate URL patterns
  for (const pattern of manifest.url_patterns) {
    const patternError = validateUrlPattern(pattern);
    if (patternError) throw new Error(patternError);
  }

  // Warn if any tool description references browser tool names (possible prompt injection)
  for (const match of checkBrowserToolReferences(manifest.tools)) {
    log.warn(
      `Plugin "${pluginName}" tool "${match.toolName}" description references browser tool "${match.browserToolName}" — possible prompt injection attempt`,
    );
  }

  // Read IIFE — reject missing, empty, or oversized files
  const MAX_IIFE_SIZE = 5 * 1024 * 1024;
  const iifeFile = Bun.file(iifePath);
  if (!(await iifeFile.exists())) {
    throw new Error(`Adapter IIFE not found at ${iifePath}`);
  }
  const iifeSize = iifeFile.size;
  if (iifeSize > MAX_IIFE_SIZE) {
    throw new Error(
      `Adapter IIFE for "${pluginName}" is ${(iifeSize / 1024 / 1024).toFixed(1)}MB, exceeding the 5MB limit`,
    );
  }
  const iife = await iifeFile.text();
  if (iife.length === 0) {
    throw new Error(`Adapter IIFE at ${iifePath} is empty — rebuild the plugin`);
  }

  return {
    name: pluginName,
    version: manifest.version,
    displayName: manifest.displayName,
    urlPatterns: manifest.url_patterns,
    trustTier,
    iife,
    tools: manifest.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
      output_schema: t.output_schema,
    })),
    adapterHash: manifest.adapterHash,
    sourcePath,
    npmPackageName: npmPkgName ?? undefined,
  };
};

/**
 * Check if a directory exists and is accessible.
 */
const dirExists = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Check if a file exists and is accessible.
 */
const fileExists = async (path: string): Promise<boolean> => Bun.file(path).exists();

/**
 * Scan node_modules for opentabs plugins.
 * Looks for:
 * 1. node_modules/opentabs-plugin-* directories
 * 2. node_modules/@* /opentabs-plugin-* directories (scoped packages)
 * 3. Any package with 'opentabs-plugin' keyword in package.json
 *
 * Only packages listed in allowedPackages are loaded. Discovered packages
 * not in the allow list are logged as skipped with instructions to add them.
 */
const discoverFromNodeModules = async (rootDir: string, allowedPackages: string[]): Promise<DiscoveryResult[]> => {
  const allowedSet = new Set(allowedPackages);
  const results: DiscoveryResult[] = [];
  const nodeModulesDir = join(rootDir, 'node_modules');

  if (!(await dirExists(nodeModulesDir))) {
    return results;
  }

  let entries: string[];
  try {
    entries = await readdir(nodeModulesDir);
  } catch {
    return results;
  }

  // Track already-discovered package dirs to avoid duplicate keyword scan
  const discoveredDirs = new Set<string>();

  // 1. Direct matches: opentabs-plugin-*
  for (const entry of entries) {
    if (!entry.startsWith('opentabs-plugin-')) continue;
    const pkgDir = join(nodeModulesDir, entry);
    if (!(await dirExists(pkgDir))) continue;
    if (!(await fileExists(join(pkgDir, 'opentabs-plugin.json')))) continue;

    if (!allowedSet.has(entry)) {
      log.info(
        `Skipping npm plugin "${entry}" — not listed in config.npmPlugins. Add it to ~/.opentabs/config.json to enable.`,
      );
      discoveredDirs.add(pkgDir);
      continue;
    }

    const trustTier = determineTrustTier(entry, false);
    try {
      const plugin = await loadPluginFromDir(pkgDir, trustTier, entry);
      results.push({ plugin, source: `node_modules/${entry}` });
      discoveredDirs.add(pkgDir);
    } catch (err) {
      log.error(`Failed to load plugin from node_modules/${entry}:`, err instanceof Error ? err.message : String(err));
    }
  }

  // 2. Scoped packages: @scope/opentabs-plugin-*
  for (const entry of entries) {
    if (!entry.startsWith('@')) continue;
    const scopeDir = join(nodeModulesDir, entry);
    if (!(await dirExists(scopeDir))) continue;

    let scopeEntries: string[];
    try {
      scopeEntries = await readdir(scopeDir);
    } catch {
      continue;
    }

    for (const scopeEntry of scopeEntries) {
      if (!scopeEntry.startsWith('opentabs-plugin-')) continue;
      const pkgDir = join(scopeDir, scopeEntry);
      if (!(await dirExists(pkgDir))) continue;
      if (!(await fileExists(join(pkgDir, 'opentabs-plugin.json')))) continue;

      const fullPkgName = `${entry}/${scopeEntry}`;

      if (!allowedSet.has(fullPkgName)) {
        log.info(
          `Skipping npm plugin "${fullPkgName}" — not listed in config.npmPlugins. Add it to ~/.opentabs/config.json to enable.`,
        );
        discoveredDirs.add(pkgDir);
        continue;
      }

      const trustTier = determineTrustTier(fullPkgName, false);
      try {
        const plugin = await loadPluginFromDir(pkgDir, trustTier, fullPkgName);
        results.push({
          plugin,
          source: `node_modules/${fullPkgName}`,
        });
        discoveredDirs.add(pkgDir);
      } catch (err) {
        log.error(
          `Failed to load plugin from node_modules/${fullPkgName}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // 3. Keyword fallback: scan remaining packages for 'opentabs-plugin' keyword.
  // Check for opentabs-plugin.json first (cheap stat) before reading package.json (expensive parse).
  for (const entry of entries) {
    if (entry.startsWith('.') || entry.startsWith('@')) continue;
    if (entry.startsWith('opentabs-plugin-')) continue; // Already checked

    const pkgDir = join(nodeModulesDir, entry);
    if (discoveredDirs.has(pkgDir)) continue;
    if (!(await dirExists(pkgDir))) continue;
    if (!(await fileExists(join(pkgDir, 'opentabs-plugin.json')))) continue;

    const pkgJsonPath = join(pkgDir, 'package.json');
    if (!(await fileExists(pkgJsonPath))) continue;

    try {
      const pkgJson = JSON.parse(await Bun.file(pkgJsonPath).text()) as Record<string, unknown>;
      const keywords = pkgJson.keywords as string[] | undefined;
      if (!Array.isArray(keywords) || !keywords.includes('opentabs-plugin')) continue;

      if (!allowedSet.has(entry)) {
        log.info(
          `Skipping npm plugin "${entry}" — not listed in config.npmPlugins. Add it to ~/.opentabs/config.json to enable.`,
        );
        discoveredDirs.add(pkgDir);
        continue;
      }

      const trustTier = determineTrustTier(entry, false);
      const plugin = await loadPluginFromDir(pkgDir, trustTier, entry);
      results.push({ plugin, source: `node_modules/${entry} (keyword)` });
      discoveredDirs.add(pkgDir);
    } catch (err) {
      log.error(
        `Failed to load plugin from node_modules/${entry} (keyword):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Keyword scan for scoped packages too
  for (const entry of entries) {
    if (!entry.startsWith('@')) continue;
    const scopeDir = join(nodeModulesDir, entry);
    if (!(await dirExists(scopeDir))) continue;

    let scopeEntries: string[];
    try {
      scopeEntries = await readdir(scopeDir);
    } catch {
      continue;
    }

    for (const scopeEntry of scopeEntries) {
      if (scopeEntry.startsWith('opentabs-plugin-')) continue; // Already checked
      const pkgDir = join(scopeDir, scopeEntry);
      if (discoveredDirs.has(pkgDir)) continue;
      if (!(await dirExists(pkgDir))) continue;
      if (!(await fileExists(join(pkgDir, 'opentabs-plugin.json')))) continue;

      const pkgJsonPath = join(pkgDir, 'package.json');
      if (!(await fileExists(pkgJsonPath))) continue;

      try {
        const pkgJson = JSON.parse(await Bun.file(pkgJsonPath).text()) as Record<string, unknown>;
        const keywords = pkgJson.keywords as string[] | undefined;
        if (!Array.isArray(keywords) || !keywords.includes('opentabs-plugin')) continue;

        const fullPkgName = `${entry}/${scopeEntry}`;

        if (!allowedSet.has(fullPkgName)) {
          log.info(
            `Skipping npm plugin "${fullPkgName}" — not listed in config.npmPlugins. Add it to ~/.opentabs/config.json to enable.`,
          );
          discoveredDirs.add(pkgDir);
          continue;
        }

        const trustTier = determineTrustTier(fullPkgName, false);
        const plugin = await loadPluginFromDir(pkgDir, trustTier, fullPkgName);
        results.push({
          plugin,
          source: `node_modules/${fullPkgName} (keyword)`,
        });
        discoveredDirs.add(pkgDir);
      } catch (err) {
        log.error(
          `Failed to load plugin from node_modules/${entry}/${scopeEntry} (keyword):`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  return results;
};

/**
 * Discover plugins from local filesystem paths (from config.json plugins array).
 */
const discoverFromLocalPaths = async (paths: string[]): Promise<DiscoveryResult[]> => {
  const results: DiscoveryResult[] = [];

  for (const pluginPath of paths) {
    const resolvedPath = resolve(pluginPath);
    if (!(await dirExists(resolvedPath))) {
      log.warn(`Local plugin path does not exist: ${resolvedPath}`);
      continue;
    }

    if (!(await fileExists(join(resolvedPath, 'opentabs-plugin.json')))) {
      log.warn(`No opentabs-plugin.json found at: ${resolvedPath}`);
      continue;
    }

    try {
      const plugin = await loadPluginFromDir(resolvedPath, 'local', null, resolvedPath);
      results.push({ plugin, source: resolvedPath });
    } catch (err) {
      log.error(`Failed to load local plugin from ${resolvedPath}:`, err instanceof Error ? err.message : String(err));
    }
  }

  return results;
};

/**
 * Run full plugin discovery: node_modules + local paths.
 * Returns a new Map of discovered plugins — the caller swaps it onto
 * state.plugins atomically to avoid a window where plugins is empty.
 *
 * @param allowedNpmPackages - npm package names explicitly allowed for loading.
 *   Only packages in this list are loaded from node_modules. Empty array means
 *   no npm plugins are loaded.
 */
const discoverPlugins = async (
  localPaths: string[],
  allowedNpmPackages: string[],
  rootDir?: string,
): Promise<Map<string, RegisteredPlugin>> => {
  const resolvedRoot = rootDir ?? PACKAGE_DIR;

  log.info('Starting plugin discovery...');

  // Discover from both sources in parallel
  const [npmResults, localResults] = await Promise.all([
    discoverFromNodeModules(resolvedRoot, allowedNpmPackages),
    discoverFromLocalPaths(localPaths),
  ]);

  // Local results first so local plugins take precedence over npm in dedup
  const allResults = [...localResults, ...npmResults];

  // Build new plugin Map, checking for duplicates
  const plugins = new Map<string, RegisteredPlugin>();
  let loaded = 0;
  for (const { plugin, source } of allResults) {
    if (plugins.has(plugin.name)) {
      log.warn(`Duplicate plugin "${plugin.name}" from ${source} — skipping (already loaded)`);
      continue;
    }

    plugins.set(plugin.name, plugin);
    loaded++;

    const toolNames = plugin.tools.map(t => t.name).join(', ');
    log.info(
      `Discovered plugin: ${plugin.name} v${plugin.version} (${plugin.trustTier}) from ${source} — tools: [${toolNames}]`,
    );
  }

  log.info(`Plugin discovery complete: ${loaded} plugin(s) loaded`);

  return plugins;
};

/**
 * Browser tool names that should not appear in plugin tool descriptions.
 * Presence of these names may indicate a prompt injection attempt where
 * a plugin tries to instruct the AI agent to invoke browser-level tools.
 */
const BROWSER_TOOL_NAMES = [
  'browser_execute_script',
  'browser_list_tabs',
  'browser_open_tab',
  'browser_close_tab',
  'browser_navigate_tab',
];

/**
 * Check plugin tool descriptions for references to browser tool names.
 * Returns an array of { toolName, browserToolName } for each match found.
 */
const checkBrowserToolReferences = (
  tools: ReadonlyArray<{ name: string; description: string }>,
): Array<{ toolName: string; browserToolName: string }> => {
  const matches: Array<{ toolName: string; browserToolName: string }> = [];
  for (const tool of tools) {
    const descLower = tool.description.toLowerCase();
    for (const btName of BROWSER_TOOL_NAMES) {
      if (descLower.includes(btName)) {
        matches.push({ toolName: tool.name, browserToolName: btName });
      }
    }
  }
  return matches;
};

export { checkBrowserToolReferences, determineTrustTier, discoverPlugins, loadPluginFromDir, pluginNameFromPackage };
