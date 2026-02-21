/**
 * Legacy plugin discovery (opentabs-plugin.json based).
 *
 * Provides the old discoverPlugins and loadPluginFromDir functions that read
 * opentabs-plugin.json manifests. Used by reload.ts and file-watcher.ts until
 * they are migrated to the new package.json-based pipeline in later stories.
 *
 * This file will be deleted once US-009 (reload.ts), US-012 (file-watcher.ts),
 * and US-020 (cleanup) are complete.
 */

import { browserTools } from './browser-tools/index.js';
import { log } from './logger.js';
import { parseManifest } from './manifest-schema.js';
import { isAllowedPluginPath } from './resolver.js';
import { validatePluginName, validateUrlPattern } from '@opentabs-dev/shared';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FailedPlugin, RegisteredPlugin } from './state.js';
import type { TrustTier } from '@opentabs-dev/shared';

/**
 * The mcp-server package root directory, resolved from this module's URL.
 * Used as the default rootDir for npm plugin discovery so that `node_modules`
 * scanning works regardless of the process's working directory.
 */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Result of attempting to load a single plugin */
interface LegacyDiscoveryResult {
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
const determineTrustTierLegacy = (pkgName: string | null, isLocal: boolean): TrustTier => {
  if (isLocal) return 'local';
  if (pkgName && pkgName.startsWith('@opentabs-dev/')) return 'official';
  return 'community';
};

/**
 * Browser tool names that should not appear in plugin tool descriptions.
 * Presence of these names may indicate a prompt injection attempt where
 * a plugin tries to instruct the AI agent to invoke browser-level tools.
 * Derived from the browserTools array so the list stays in sync automatically.
 */
const BROWSER_TOOL_NAMES = browserTools.map(t => t.name);

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
      displayName: t.displayName,
      description: t.description,
      icon: t.icon,
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
const discoverFromNodeModules = async (
  rootDir: string,
  allowedPackages: string[],
): Promise<LegacyDiscoveryResult[]> => {
  const allowedSet = new Set(allowedPackages);
  const results: LegacyDiscoveryResult[] = [];
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

    const trustTier = determineTrustTierLegacy(entry, false);
    try {
      const plugin = await loadPluginFromDir(pkgDir, trustTier, entry);
      results.push({ plugin, source: `node_modules/${entry}` });
      discoveredDirs.add(pkgDir);
    } catch (err) {
      log.error(`Failed to load plugin from node_modules/${entry}:`, err);
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

      const trustTier = determineTrustTierLegacy(fullPkgName, false);
      try {
        const plugin = await loadPluginFromDir(pkgDir, trustTier, fullPkgName);
        results.push({
          plugin,
          source: `node_modules/${fullPkgName}`,
        });
        discoveredDirs.add(pkgDir);
      } catch (err) {
        log.error(`Failed to load plugin from node_modules/${fullPkgName}:`, err);
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

      const trustTier = determineTrustTierLegacy(entry, false);
      const plugin = await loadPluginFromDir(pkgDir, trustTier, entry);
      results.push({ plugin, source: `node_modules/${entry} (keyword)` });
      discoveredDirs.add(pkgDir);
    } catch (err) {
      log.error(`Failed to load plugin from node_modules/${entry} (keyword):`, err);
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

        const trustTier = determineTrustTierLegacy(fullPkgName, false);
        const plugin = await loadPluginFromDir(pkgDir, trustTier, fullPkgName);
        results.push({
          plugin,
          source: `node_modules/${fullPkgName} (keyword)`,
        });
        discoveredDirs.add(pkgDir);
      } catch (err) {
        log.error(`Failed to load plugin from node_modules/${entry}/${scopeEntry} (keyword):`, err);
      }
    }
  }

  return results;
};

const discoverFromLocalPaths = async (
  paths: string[],
): Promise<{ results: LegacyDiscoveryResult[]; failures: FailedPlugin[] }> => {
  const results: LegacyDiscoveryResult[] = [];
  const failures: FailedPlugin[] = [];

  for (const pluginPath of paths) {
    const resolvedPath = resolve(pluginPath);

    if (!(await isAllowedPluginPath(resolvedPath))) {
      const msg = `Rejected plugin path outside allowed directories: ${resolvedPath}`;
      log.warn(msg);
      failures.push({ path: resolvedPath, error: 'Path is outside allowed directories' });
      continue;
    }

    if (!(await dirExists(resolvedPath))) {
      const msg = `Local plugin path does not exist: ${resolvedPath}`;
      log.warn(msg);
      failures.push({ path: resolvedPath, error: 'Directory does not exist' });
      continue;
    }

    if (!(await fileExists(join(resolvedPath, 'opentabs-plugin.json')))) {
      const msg = `No opentabs-plugin.json found at: ${resolvedPath}`;
      log.warn(msg);
      failures.push({ path: resolvedPath, error: 'No opentabs-plugin.json found' });
      continue;
    }

    try {
      const plugin = await loadPluginFromDir(resolvedPath, 'local', null, resolvedPath);
      results.push({ plugin, source: resolvedPath });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to load local plugin from ${resolvedPath}:`, err);
      failures.push({ path: resolvedPath, error: errorMsg });
    }
  }

  return { results, failures };
};

/** Result of full plugin discovery: successfully loaded plugins and failed paths */
interface DiscoveryOutcome {
  plugins: Map<string, RegisteredPlugin>;
  failures: FailedPlugin[];
}

/**
 * Legacy plugin discovery using opentabs-plugin.json manifests.
 * Discovers from both node_modules and local filesystem paths.
 *
 * This function will be replaced by the new discoverPlugins in discovery.ts
 * once reload.ts (US-009) and file-watcher.ts (US-012) are migrated.
 */
const discoverPluginsLegacy = async (
  localPaths: string[],
  allowedNpmPackages: string[],
  rootDir?: string,
): Promise<DiscoveryOutcome> => {
  const resolvedRoot = rootDir ?? PACKAGE_DIR;

  log.info('Starting plugin discovery...');

  // Discover from both sources in parallel
  const [npmResults, localDiscovery] = await Promise.all([
    discoverFromNodeModules(resolvedRoot, allowedNpmPackages),
    discoverFromLocalPaths(localPaths),
  ]);

  // Local results first so local plugins take precedence over npm in dedup
  const allResults = [...localDiscovery.results, ...npmResults];
  const failures = [...localDiscovery.failures];

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

  return { plugins, failures };
};

export { discoverPluginsLegacy, loadPluginFromDir };
