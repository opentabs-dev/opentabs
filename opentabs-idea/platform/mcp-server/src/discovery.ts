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
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import type { RegisteredPlugin, TrustTier, ServerState } from "./state.js";

/** Manifest shape as written by `opentabs build` */
interface PluginManifest {
  name: string;
  version: string;
  displayName?: string;
  description: string;
  url_patterns: string[];
  tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
  }>;
}

/** Result of attempting to load a single plugin */
interface DiscoveryResult {
  plugin: RegisteredPlugin;
  source: string;
}

const RESERVED_NAMES = new Set([
  "system",
  "browser",
  "opentabs",
  "extension",
  "config",
  "plugin",
  "tool",
  "mcp",
]);

const NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Extract the plugin name from an npm package name.
 * opentabs-plugin-slack → slack
 * @myorg/opentabs-plugin-jira → myorg-jira
 */
const pluginNameFromPackage = (pkgName: string): string => {
  if (pkgName.startsWith("@")) {
    // Scoped: @scope/opentabs-plugin-name → scope-name
    const parts = pkgName.split("/");
    const scope = parts[0].slice(1); // remove @
    const rest = parts[1].replace(/^opentabs-plugin-/, "");
    return `${scope}-${rest}`;
  }
  return pkgName.replace(/^opentabs-plugin-/, "");
};

/**
 * Determine trust tier from how the plugin was discovered.
 */
const determineTrustTier = (
  pkgName: string | null,
  isLocal: boolean
): TrustTier => {
  if (isLocal) return "local";
  if (pkgName && pkgName.startsWith("@opentabs/")) return "official";
  return "community";
};

/**
 * Validate URL patterns — reject overly broad ones.
 */
const validateUrlPatterns = (patterns: string[]): string | null => {
  if (!patterns || patterns.length === 0) {
    return "At least one URL pattern is required";
  }
  for (const pattern of patterns) {
    if (pattern === "*://*/*" || pattern === "<all_urls>") {
      return `URL pattern "${pattern}" is too broad`;
    }
  }
  return null;
};

/**
 * Load a single plugin from a directory.
 * Reads opentabs-plugin.json and dist/adapter.iife.js.
 */
const loadPluginFromDir = async (
  dir: string,
  trustTier: TrustTier,
  npmPkgName: string | null,
  sourcePath?: string
): Promise<RegisteredPlugin> => {
  const manifestPath = join(dir, "opentabs-plugin.json");
  const iifePath = join(dir, "dist", "adapter.iife.js");

  // Read manifest
  const manifestRaw = await readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestRaw) as PluginManifest;

  // Derive the internal plugin name
  // For npm packages: derive from package name
  // For local plugins: use the manifest's name field (minus opentabs-plugin- prefix)
  let pluginName: string;
  if (npmPkgName) {
    pluginName = pluginNameFromPackage(npmPkgName);
    // Validate: plugin name in manifest should match derived name
    const manifestDerived = manifest.name.replace(/^opentabs-plugin-/, "");
    if (manifestDerived !== pluginName) {
      console.warn(
        `[opentabs] Warning: Plugin manifest name "${manifest.name}" doesn't match package name "${npmPkgName}" (expected plugin name: ${pluginName}, got: ${manifestDerived})`
      );
    }
  } else {
    // Local plugin — use manifest name
    pluginName = manifest.name.replace(/^opentabs-plugin-/, "");
  }

  // Validate plugin name
  if (!NAME_REGEX.test(pluginName)) {
    throw new Error(
      `Plugin name "${pluginName}" must be lowercase alphanumeric with hyphens`
    );
  }
  if (RESERVED_NAMES.has(pluginName)) {
    throw new Error(`Plugin name "${pluginName}" is reserved`);
  }

  // Validate URL patterns
  const patternError = validateUrlPatterns(manifest.url_patterns);
  if (patternError) {
    throw new Error(patternError);
  }

  // Read IIFE
  const iife = await readFile(iifePath, "utf-8");

  return {
    name: pluginName,
    version: manifest.version,
    displayName: manifest.displayName,
    urlPatterns: manifest.url_patterns,
    trustTier,
    iife,
    tools: manifest.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
      output_schema: t.output_schema,
    })),
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
const fileExists = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
};

/**
 * Scan node_modules for opentabs plugins.
 * Looks for:
 * 1. node_modules/opentabs-plugin-* directories
 * 2. node_modules/@* /opentabs-plugin-* directories (scoped packages)
 * 3. Any package with 'opentabs-plugin' keyword in package.json
 */
const discoverFromNodeModules = async (
  rootDir: string
): Promise<DiscoveryResult[]> => {
  const results: DiscoveryResult[] = [];
  const nodeModulesDir = join(rootDir, "node_modules");

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
    if (!entry.startsWith("opentabs-plugin-")) continue;
    const pkgDir = join(nodeModulesDir, entry);
    if (!(await dirExists(pkgDir))) continue;
    if (!(await fileExists(join(pkgDir, "opentabs-plugin.json")))) continue;

    const trustTier = determineTrustTier(entry, false);
    try {
      const plugin = await loadPluginFromDir(pkgDir, trustTier, entry);
      results.push({ plugin, source: `node_modules/${entry}` });
      discoveredDirs.add(pkgDir);
    } catch (err) {
      console.error(
        `[opentabs] Failed to load plugin from node_modules/${entry}:`,
        (err as Error).message
      );
    }
  }

  // 2. Scoped packages: @scope/opentabs-plugin-*
  for (const entry of entries) {
    if (!entry.startsWith("@")) continue;
    const scopeDir = join(nodeModulesDir, entry);
    if (!(await dirExists(scopeDir))) continue;

    let scopeEntries: string[];
    try {
      scopeEntries = await readdir(scopeDir);
    } catch {
      continue;
    }

    for (const scopeEntry of scopeEntries) {
      if (!scopeEntry.startsWith("opentabs-plugin-")) continue;
      const pkgDir = join(scopeDir, scopeEntry);
      if (!(await dirExists(pkgDir))) continue;
      if (!(await fileExists(join(pkgDir, "opentabs-plugin.json")))) continue;

      const fullPkgName = `${entry}/${scopeEntry}`;
      const trustTier = determineTrustTier(fullPkgName, false);
      try {
        const plugin = await loadPluginFromDir(pkgDir, trustTier, fullPkgName);
        results.push({
          plugin,
          source: `node_modules/${fullPkgName}`,
        });
        discoveredDirs.add(pkgDir);
      } catch (err) {
        console.error(
          `[opentabs] Failed to load plugin from node_modules/${fullPkgName}:`,
          (err as Error).message
        );
      }
    }
  }

  // 3. Keyword fallback: scan remaining packages for 'opentabs-plugin' keyword
  for (const entry of entries) {
    if (entry.startsWith(".") || entry.startsWith("@")) continue;
    if (entry.startsWith("opentabs-plugin-")) continue; // Already checked

    const pkgDir = join(nodeModulesDir, entry);
    if (discoveredDirs.has(pkgDir)) continue;
    if (!(await dirExists(pkgDir))) continue;

    const pkgJsonPath = join(pkgDir, "package.json");
    if (!(await fileExists(pkgJsonPath))) continue;

    try {
      const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf-8")) as Record<string, unknown>;
      const keywords = pkgJson.keywords as string[] | undefined;
      if (!Array.isArray(keywords) || !keywords.includes("opentabs-plugin"))
        continue;

      if (!(await fileExists(join(pkgDir, "opentabs-plugin.json")))) continue;

      const trustTier = determineTrustTier(entry, false);
      const plugin = await loadPluginFromDir(pkgDir, trustTier, entry);
      results.push({ plugin, source: `node_modules/${entry} (keyword)` });
      discoveredDirs.add(pkgDir);
    } catch (err) {
      console.error(
        `[opentabs] Failed to load plugin from node_modules/${entry} (keyword):`,
        (err as Error).message
      );
    }
  }

  // Keyword scan for scoped packages too
  for (const entry of entries) {
    if (!entry.startsWith("@")) continue;
    const scopeDir = join(nodeModulesDir, entry);
    if (!(await dirExists(scopeDir))) continue;

    let scopeEntries: string[];
    try {
      scopeEntries = await readdir(scopeDir);
    } catch {
      continue;
    }

    for (const scopeEntry of scopeEntries) {
      if (scopeEntry.startsWith("opentabs-plugin-")) continue; // Already checked
      const pkgDir = join(scopeDir, scopeEntry);
      if (discoveredDirs.has(pkgDir)) continue;
      if (!(await dirExists(pkgDir))) continue;

      const pkgJsonPath = join(pkgDir, "package.json");
      if (!(await fileExists(pkgJsonPath))) continue;

      try {
        const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf-8")) as Record<string, unknown>;
        const keywords = pkgJson.keywords as string[] | undefined;
        if (!Array.isArray(keywords) || !keywords.includes("opentabs-plugin"))
          continue;

        if (!(await fileExists(join(pkgDir, "opentabs-plugin.json")))) continue;

        const fullPkgName = `${entry}/${scopeEntry}`;
        const trustTier = determineTrustTier(fullPkgName, false);
        const plugin = await loadPluginFromDir(pkgDir, trustTier, fullPkgName);
        results.push({
          plugin,
          source: `node_modules/${fullPkgName} (keyword)`,
        });
        discoveredDirs.add(pkgDir);
      } catch {
        // Skip silently for keyword scan
      }
    }
  }

  return results;
};

/**
 * Discover plugins from local filesystem paths (from config.json plugins array).
 */
const discoverFromLocalPaths = async (
  paths: string[]
): Promise<DiscoveryResult[]> => {
  const results: DiscoveryResult[] = [];

  for (const pluginPath of paths) {
    const resolvedPath = resolve(pluginPath);
    if (!(await dirExists(resolvedPath))) {
      console.warn(
        `[opentabs] Local plugin path does not exist: ${resolvedPath}`
      );
      continue;
    }

    if (!(await fileExists(join(resolvedPath, "opentabs-plugin.json")))) {
      console.warn(
        `[opentabs] No opentabs-plugin.json found at: ${resolvedPath}`
      );
      continue;
    }

    try {
      const plugin = await loadPluginFromDir(resolvedPath, "local", null, resolvedPath);
      results.push({ plugin, source: resolvedPath });
    } catch (err) {
      console.error(
        `[opentabs] Failed to load local plugin from ${resolvedPath}:`,
        (err as Error).message
      );
    }
  }

  return results;
};

/**
 * Run full plugin discovery: node_modules + local paths.
 * Registers discovered plugins in server state.
 * Returns the number of successfully loaded plugins.
 */
export const discoverPlugins = async (
  state: ServerState,
  localPaths: string[],
  rootDir?: string
): Promise<number> => {
  const resolvedRoot = rootDir ?? process.cwd();

  console.log("[opentabs] Starting plugin discovery...");

  // Discover from both sources in parallel
  const [npmResults, localResults] = await Promise.all([
    discoverFromNodeModules(resolvedRoot),
    discoverFromLocalPaths(localPaths),
  ]);

  const allResults = [...npmResults, ...localResults];

  // Register in state, checking for duplicates
  let loaded = 0;
  for (const { plugin, source } of allResults) {
    if (state.plugins.has(plugin.name)) {
      console.warn(
        `[opentabs] Duplicate plugin "${plugin.name}" from ${source} — skipping (already loaded)`
      );
      continue;
    }

    state.plugins.set(plugin.name, plugin);
    loaded++;

    const toolNames = plugin.tools.map((t) => t.name).join(", ");
    console.log(
      `[opentabs] Discovered plugin: ${plugin.name} v${plugin.version} (${plugin.trustTier}) from ${source} — tools: [${toolNames}]`
    );
  }

  console.log(
    `[opentabs] Plugin discovery complete: ${loaded} plugin(s) loaded`
  );

  return loaded;
};
