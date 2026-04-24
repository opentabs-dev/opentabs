/**
 * Plugin loader module.
 *
 * Reads plugin artifacts from a resolved directory: package.json (validated
 * via parsePluginPackageJson), dist/adapter.iife.js, and dist/tools.json.
 * Returns a Result so errors are explicitly propagated, not thrown.
 *
 * Pure function: takes a directory path and trust tier, reads files, validates,
 * returns a Result. No side effects, no state mutation.
 */

import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConfigSchema, ManifestTool, Result } from '@opentabs-dev/shared';
import {
  ADAPTER_FILENAME,
  ADAPTER_SOURCE_MAP_FILENAME,
  BROWSER_TOOLS_CATALOG,
  err,
  ok,
  PRE_SCRIPT_FILENAME,
  parsePluginPackageJson,
  pluginNameFromPackage,
  TOOLS_FILENAME,
  validatePluginName,
  validateUrlPattern,
} from '@opentabs-dev/shared';
import { log } from './logger.js';
import { sdkVersion as serverSdkVersion } from './sdk-version.js';
import type { PluginSource } from './state.js';

/** Browser tool names derived from the static catalog — used for prompt injection detection. */
const browserToolNames: readonly string[] = BROWSER_TOOLS_CATALOG.map(t => t.name);

/** Maximum allowed size for the adapter IIFE (5 MB) */
const MAX_IIFE_SIZE = 5 * 1024 * 1024;

/** A fully loaded plugin ready for registration */
interface LoadedPlugin {
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly urlPatterns: string[];
  readonly excludePatterns: string[];
  readonly homepage: string | undefined;
  readonly iife: string;
  readonly tools: ManifestTool[];
  readonly source: PluginSource;
  readonly sourcePath: string;
  readonly adapterHash: string | undefined;
  readonly npmPackageName: string | undefined;
  /** SDK version the plugin was built with (from tools.json sdkVersion field). Undefined for old plugins. */
  readonly sdkVersion: string | undefined;
  /** Source map content for the adapter IIFE (from dist/adapter.iife.js.map). Undefined for old plugins. */
  readonly iifeSourceMap: string | undefined;
  /** Optional SVG icon for the plugin (from tools.json) */
  readonly iconSvg: string | undefined;
  /** Optional SVG icon for the inactive state (from tools.json) */
  readonly iconInactiveSvg: string | undefined;
  /** Optional SVG icon for dark mode (from tools.json) */
  readonly iconDarkSvg: string | undefined;
  /** Optional SVG icon for dark mode inactive state (from tools.json) */
  readonly iconDarkInactiveSvg: string | undefined;
  /** Optional config schema from tools.json manifest */
  readonly configSchema: ConfigSchema | undefined;
  /** Pre-script IIFE content (when plugin declares preScript in package.json) */
  readonly preScript: string | undefined;
  /** SHA-256 hex hash of the pre-script IIFE content (from manifest) */
  readonly preScriptHash: string | undefined;
}

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
    for (const btName of browserToolNames) {
      if (descLower.includes(btName)) {
        matches.push({ toolName: tool.name, browserToolName: btName });
      }
    }
  }
  return matches;
};

/**
 * Extract the tools array from a parsed tools.json manifest.
 * Supports two formats:
 *   - Legacy: a plain array of tool definitions
 *   - Current: { tools: [...] }
 * Returns null if the format is unrecognized or tools is not an array.
 */
const extractToolsArray = (raw: unknown): unknown[] | null => {
  if (Array.isArray(raw)) {
    return raw as unknown[];
  }
  if (typeof raw === 'object' && raw !== null && 'tools' in raw) {
    const candidate = (raw as Record<string, unknown>).tools;
    if (Array.isArray(candidate)) {
      return candidate as unknown[];
    }
  }
  return null;
};

/**
 * Validate an array of tool definitions from dist/tools.json.
 * Each tool must have name, displayName, description, icon, input_schema, output_schema.
 */
const validateTools = (tools: unknown, sourcePath: string): Result<ManifestTool[], string> => {
  if (!Array.isArray(tools)) {
    return err(`Invalid tools.json at ${sourcePath}: expected an array`);
  }

  const validated: ManifestTool[] = [];
  for (let i = 0; i < tools.length; i++) {
    const raw: unknown = tools[i];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}] must be an object`);
    }
    const toolRecord = raw as Record<string, unknown>;

    const name = toolRecord.name;
    if (typeof name !== 'string' || name.length === 0) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].name must be a non-empty string`);
    }

    const displayName = toolRecord.displayName;
    if (typeof displayName !== 'string' || displayName.length === 0) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].displayName must be a non-empty string`);
    }

    const description = toolRecord.description;
    if (typeof description !== 'string' || description.length === 0) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].description must be a non-empty string`);
    }
    if (description.length > 1000) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].description must be at most 1000 characters`);
    }

    const icon = toolRecord.icon;
    if (typeof icon !== 'string' || icon.length === 0) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].icon must be a non-empty string`);
    }

    // Optional SVG icons
    const iconSvg = typeof toolRecord.iconSvg === 'string' ? toolRecord.iconSvg : undefined;
    const iconInactiveSvg = typeof toolRecord.iconInactiveSvg === 'string' ? toolRecord.iconInactiveSvg : undefined;

    // Optional short human-readable summary for the UI
    const summary = typeof toolRecord.summary === 'string' ? toolRecord.summary : undefined;

    // Optional group for visual grouping in the side panel
    const group = typeof toolRecord.group === 'string' ? toolRecord.group : undefined;

    const inputSchema = toolRecord.input_schema;
    if (typeof inputSchema !== 'object' || inputSchema === null || Array.isArray(inputSchema)) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].input_schema must be an object`);
    }

    const outputSchema = toolRecord.output_schema;
    if (typeof outputSchema !== 'object' || outputSchema === null || Array.isArray(outputSchema)) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].output_schema must be an object`);
    }

    validated.push({
      name,
      displayName,
      description,
      ...(summary ? { summary } : {}),
      icon,
      ...(group ? { group } : {}),
      iconSvg,
      iconInactiveSvg,
      input_schema: inputSchema as Record<string, unknown>,
      output_schema: outputSchema as Record<string, unknown>,
    });
  }

  return ok(validated);
};

/**
 * Extract the adapter hash embedded in the IIFE by the hashAndFreeze snippet.
 *
 * The build tool appends a snippet that sets adapter.__adapterHash to the
 * SHA-256 of the IIFE content *before* the snippet was appended. Computing
 * SHA-256 of the full file (including the hash-setter) produces a different
 * value and causes spurious hash-mismatch errors in the extension.
 */
const extractEmbeddedAdapterHash = (iife: string): string | undefined => {
  const match = iife.match(/\.__adapterHash="([0-9a-f]{64})"/);
  return match?.[1];
};

/**
 * Parse a semver string into [major, minor] components.
 * Returns null if the string is not a valid semver-like version.
 */
const parseMajorMinor = (version: string): [number, number] | null => {
  const match = version.match(/^(\d+)\.(\d+)\.\d+/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
};

/**
 * Check SDK version compatibility between a plugin and the server.
 *
 * Compatibility rule: the plugin's sdkVersion major.minor must be <= the
 * server's SDK major.minor. A plugin built with a newer SDK than the server
 * might use APIs the server doesn't have. A plugin built with an older SDK
 * is assumed backward-compatible.
 */
const checkSdkCompatibility = (
  pluginSdkVersion: string | undefined,
  currentServerSdkVersion: string,
): { compatible: boolean; error?: string } => {
  if (pluginSdkVersion === undefined) {
    return { compatible: true };
  }

  const pluginMM = parseMajorMinor(pluginSdkVersion);
  if (!pluginMM) {
    return { compatible: true };
  }

  const serverMM = parseMajorMinor(currentServerSdkVersion);
  if (!serverMM) {
    return { compatible: true };
  }

  const [pluginMajor, pluginMinor] = pluginMM;
  const [serverMajor, serverMinor] = serverMM;

  if (pluginMajor > serverMajor || (pluginMajor === serverMajor && pluginMinor > serverMinor)) {
    return {
      compatible: false,
      error: `Plugin built with SDK ${pluginSdkVersion}, server has SDK ${currentServerSdkVersion}`,
    };
  }

  return { compatible: true };
};

/**
 * Load a plugin from a resolved directory.
 *
 * Reads package.json (validated via parsePluginPackageJson), dist/adapter.iife.js,
 * and dist/tools.json. Derives the internal plugin name from the npm package name.
 *
 * @param dir - Absolute path to the plugin directory containing package.json
 * @param source - How the plugin was discovered: 'npm' or 'local'
 */
const loadPlugin = async (dir: string, source: PluginSource): Promise<Result<LoadedPlugin, string>> => {
  // Read and validate package.json
  const pkgJsonPath = join(dir, 'package.json');
  let pkgJsonRaw: unknown;
  try {
    pkgJsonRaw = JSON.parse(await readFile(pkgJsonPath, 'utf-8')) as unknown;
  } catch {
    return err(`Failed to read package.json at ${dir}: file missing or invalid JSON`);
  }

  const pkgResult = parsePluginPackageJson(pkgJsonRaw, dir);
  if (!pkgResult.ok) {
    return err(pkgResult.error);
  }
  const pkg = pkgResult.value;

  // Derive internal plugin name from npm package name
  const pluginName = pluginNameFromPackage(pkg.name);
  const nameError = validatePluginName(pluginName);
  if (nameError) {
    return err(`Invalid plugin name derived from "${pkg.name}" at ${dir}: ${nameError}`);
  }

  // Validate URL patterns
  for (const pattern of pkg.opentabs.urlPatterns) {
    const patternError = validateUrlPattern(pattern);
    if (patternError) {
      return err(`Invalid URL pattern in ${dir}: ${patternError}`);
    }
  }

  // Validate exclude patterns
  for (const pattern of pkg.opentabs.excludePatterns ?? []) {
    const patternError = validateUrlPattern(pattern);
    if (patternError) {
      return err(`Invalid exclude pattern in ${dir}: ${patternError}`);
    }
  }

  // Read adapter IIFE
  const iifePath = join(dir, 'dist', ADAPTER_FILENAME);
  if (
    !(await access(iifePath).then(
      () => true,
      () => false,
    ))
  ) {
    return err(`Adapter IIFE not found at ${iifePath}`);
  }
  let iife: string;
  try {
    iife = await readFile(iifePath, 'utf-8');
  } catch {
    return err(`Failed to read adapter IIFE at ${iifePath}`);
  }
  if (iife.length > MAX_IIFE_SIZE) {
    return err(
      `Adapter IIFE for "${pluginName}" is ${(iife.length / 1024 / 1024).toFixed(1)}MB, exceeding the 5MB limit`,
    );
  }
  if (iife.length === 0) {
    return err(`Adapter IIFE at ${iifePath} is empty — rebuild the plugin`);
  }

  // Read and validate tools.json
  // Supports two formats:
  //   - Legacy: a plain array of tool definitions
  //   - Current: { tools: [...] }
  const toolsJsonPath = join(dir, 'dist', TOOLS_FILENAME);
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(await readFile(toolsJsonPath, 'utf-8')) as unknown;
  } catch {
    return err(`Failed to read dist/${TOOLS_FILENAME} at ${dir}: file missing or invalid JSON`);
  }

  // Extract the tools array from either format
  const manifestObj =
    typeof manifestRaw === 'object' && manifestRaw !== null && !Array.isArray(manifestRaw)
      ? (manifestRaw as Record<string, unknown>)
      : null;
  const toolsArray = extractToolsArray(manifestRaw);
  if (!toolsArray) {
    return err(`Invalid tools.json at ${dir}: expected an array or { tools: [...] }`);
  }

  const toolsResult = validateTools(toolsArray, dir);
  if (!toolsResult.ok) {
    return err(toolsResult.error);
  }
  const tools = toolsResult.value;

  // Extract sdkVersion and check compatibility
  const pluginSdkVersion =
    manifestObj && typeof manifestObj.sdkVersion === 'string' ? manifestObj.sdkVersion : undefined;

  if (pluginSdkVersion === undefined) {
    log.warn(`Plugin "${pluginName}" does not declare sdkVersion — skipping compatibility check`);
  } else {
    const compat = checkSdkCompatibility(pluginSdkVersion, serverSdkVersion);
    if (!compat.compatible && compat.error) {
      return err(`${compat.error}. Rebuild the plugin: cd ${dir} && npm install && npm run build`);
    }
  }

  // Warn about browser tool references in tool descriptions (prompt injection detection)
  for (const match of checkBrowserToolReferences(tools)) {
    log.warn(
      `Plugin "${pluginName}" tool "${match.toolName}" description references browser tool "${match.browserToolName}" — possible prompt injection attempt`,
    );
  }

  // Extract the adapter hash embedded by the build tool's hashAndFreeze snippet.
  // This matches what adapter.__adapterHash reports at runtime in the browser.
  const adapterHash = extractEmbeddedAdapterHash(iife);

  // Read source map if available (optional — older plugins won't have one)
  const sourceMapPath = join(dir, 'dist', ADAPTER_SOURCE_MAP_FILENAME);
  let iifeSourceMap: string | undefined;
  try {
    if (
      await access(sourceMapPath).then(
        () => true,
        () => false,
      )
    ) {
      iifeSourceMap = await readFile(sourceMapPath, 'utf-8');
    }
  } catch {
    // Source map not available — not an error
  }

  // Extract optional configSchema from manifest
  const configSchema =
    manifestObj && typeof manifestObj.configSchema === 'object' && manifestObj.configSchema !== null
      ? (manifestObj.configSchema as ConfigSchema)
      : undefined;

  // Extract optional SVG icons from manifest
  const iconSvg = manifestObj && typeof manifestObj.iconSvg === 'string' ? manifestObj.iconSvg : undefined;
  const iconInactiveSvg =
    manifestObj && typeof manifestObj.iconInactiveSvg === 'string' ? manifestObj.iconInactiveSvg : undefined;
  const iconDarkSvg = manifestObj && typeof manifestObj.iconDarkSvg === 'string' ? manifestObj.iconDarkSvg : undefined;
  const iconDarkInactiveSvg =
    manifestObj && typeof manifestObj.iconDarkInactiveSvg === 'string' ? manifestObj.iconDarkInactiveSvg : undefined;

  // Load optional pre-script IIFE. The plugin declares `preScript` in
  // package.json's opentabs field; the build tool emits PRE_SCRIPT_FILENAME
  // alongside the adapter. Absent preScriptFile → plugin has no pre-script.
  let preScript: string | undefined;
  let preScriptHash: string | undefined;
  const declaredPreScriptFile =
    manifestObj && typeof manifestObj.preScriptFile === 'string' ? manifestObj.preScriptFile : undefined;
  const declaredPreScriptHash =
    manifestObj && typeof manifestObj.preScriptHash === 'string' ? manifestObj.preScriptHash : undefined;
  if (declaredPreScriptFile) {
    const preScriptPath = join(dir, 'dist', PRE_SCRIPT_FILENAME);
    try {
      preScript = await readFile(preScriptPath, 'utf-8');
      preScriptHash = declaredPreScriptHash;
    } catch {
      log.warn(
        `Plugin "${pluginName}" declares preScriptFile in manifest but ${PRE_SCRIPT_FILENAME} is missing at ${preScriptPath} — pre-script disabled`,
      );
    }
  }

  return ok({
    name: pluginName,
    version: pkg.version,
    displayName: pkg.opentabs.displayName,
    description: pkg.opentabs.description,
    urlPatterns: pkg.opentabs.urlPatterns,
    excludePatterns: pkg.opentabs.excludePatterns ?? [],
    homepage: pkg.opentabs.homepage,
    iife,
    tools,
    source,
    sourcePath: dir,
    adapterHash,
    npmPackageName: pkg.name,
    sdkVersion: pluginSdkVersion,
    iifeSourceMap,
    iconSvg,
    iconInactiveSvg,
    iconDarkSvg,
    iconDarkInactiveSvg,
    configSchema,
    preScript,
    preScriptHash,
  });
};

export type { LoadedPlugin };
export {
  checkBrowserToolReferences,
  checkSdkCompatibility,
  extractToolsArray,
  loadPlugin,
  parseMajorMinor,
  validateTools,
};
