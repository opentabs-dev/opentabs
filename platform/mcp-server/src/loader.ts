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

import { BROWSER_TOOL_NAMES } from './browser-tool-names.js';
import { log } from './logger.js';
import { sdkVersion as serverSdkVersion } from './sdk-version.js';
import {
  ADAPTER_FILENAME,
  ADAPTER_SOURCE_MAP_FILENAME,
  OFFICIAL_SCOPE,
  PLUGIN_PREFIX,
  TOOLS_FILENAME,
  err,
  ok,
  parsePluginPackageJson,
  validatePluginName,
  validateUrlPattern,
} from '@opentabs-dev/shared';
import { join } from 'node:path';
import type { PluginSource } from './state.js';
import type {
  ManifestPrompt,
  ManifestPromptArgument,
  ManifestResource,
  ManifestTool,
  Result,
  TrustTier,
} from '@opentabs-dev/shared';

/** Maximum allowed size for the adapter IIFE (5 MB) */
const MAX_IIFE_SIZE = 5 * 1024 * 1024;

/** A fully loaded plugin ready for registration */
interface LoadedPlugin {
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly urlPatterns: string[];
  readonly trustTier: TrustTier;
  readonly iife: string;
  readonly tools: ManifestTool[];
  readonly resources: ManifestResource[];
  readonly prompts: ManifestPrompt[];
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
}

/**
 * Extract the internal plugin name from an npm package name.
 *
 * Unscoped:                opentabs-plugin-slack                      → slack
 * Official @opentabs-dev:  @opentabs-dev/opentabs-plugin-e2e-test     → e2e-test
 * Third-party scope:       @myorg/opentabs-plugin-jira                → myorg-jira
 */
const pluginNameFromPackage = (pkgName: string): string => {
  const prefixPattern = new RegExp(`^${PLUGIN_PREFIX}`);
  if (pkgName.startsWith('@')) {
    const parts = pkgName.split('/');
    const scopePart = parts[0] ?? '';
    const namePart = parts[1] ?? '';
    const pluginSuffix = namePart.replace(prefixPattern, '');

    // Official scope is invisible — treat like an unscoped package
    if (scopePart === OFFICIAL_SCOPE) {
      return pluginSuffix;
    }

    const scope = scopePart.slice(1);
    return `${scope}-${pluginSuffix}`;
  }
  return pkgName.replace(prefixPattern, '');
};

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
 * Extract the tools array from a parsed tools.json manifest.
 * Supports two formats:
 *   - Legacy: a plain array of tool definitions
 *   - Current: { tools: [...], resources: [...], prompts: [...] }
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
      icon,
      iconSvg,
      iconInactiveSvg,
      input_schema: inputSchema as Record<string, unknown>,
      output_schema: outputSchema as Record<string, unknown>,
    });
  }

  return ok(validated);
};

/**
 * Validate an array of resource definitions from dist/tools.json.
 * Invalid entries are filtered out with a warning, not a hard failure.
 */
const validateResources = (resources: unknown[], pluginName: string, sourcePath: string): ManifestResource[] => {
  const validated: ManifestResource[] = [];
  for (let i = 0; i < resources.length; i++) {
    const raw: unknown = resources[i];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      log.warn(`Plugin "${pluginName}" resources[${i}] at ${sourcePath} is not an object — skipping`);
      continue;
    }
    const r = raw as Record<string, unknown>;

    if (typeof r.uri !== 'string' || r.uri.length === 0) {
      log.warn(`Plugin "${pluginName}" resources[${i}] at ${sourcePath} has invalid uri — skipping`);
      continue;
    }
    if (typeof r.name !== 'string' || r.name.length === 0) {
      log.warn(`Plugin "${pluginName}" resources[${i}] at ${sourcePath} has invalid name — skipping`);
      continue;
    }
    if (r.description !== undefined && typeof r.description !== 'string') {
      log.warn(`Plugin "${pluginName}" resources[${i}] at ${sourcePath} has invalid description — skipping`);
      continue;
    }
    if (r.mimeType !== undefined && typeof r.mimeType !== 'string') {
      log.warn(`Plugin "${pluginName}" resources[${i}] at ${sourcePath} has invalid mimeType — skipping`);
      continue;
    }

    validated.push({
      uri: r.uri,
      name: r.name,
      description: typeof r.description === 'string' ? r.description : undefined,
      mimeType: typeof r.mimeType === 'string' ? r.mimeType : undefined,
    });
  }
  return validated;
};

/**
 * Validate an array of prompt definitions from dist/tools.json.
 * Invalid entries are filtered out with a warning, not a hard failure.
 */
const validatePrompts = (prompts: unknown[], pluginName: string, sourcePath: string): ManifestPrompt[] => {
  const validated: ManifestPrompt[] = [];
  for (let i = 0; i < prompts.length; i++) {
    const raw: unknown = prompts[i];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      log.warn(`Plugin "${pluginName}" prompts[${i}] at ${sourcePath} is not an object — skipping`);
      continue;
    }
    const p = raw as Record<string, unknown>;

    if (typeof p.name !== 'string' || p.name.length === 0) {
      log.warn(`Plugin "${pluginName}" prompts[${i}] at ${sourcePath} has invalid name — skipping`);
      continue;
    }
    if (p.description !== undefined && typeof p.description !== 'string') {
      log.warn(`Plugin "${pluginName}" prompts[${i}] at ${sourcePath} has invalid description — skipping`);
      continue;
    }
    if (p.arguments !== undefined && !Array.isArray(p.arguments)) {
      log.warn(`Plugin "${pluginName}" prompts[${i}] at ${sourcePath} has invalid arguments — skipping`);
      continue;
    }

    validated.push({
      name: p.name,
      description: typeof p.description === 'string' ? p.description : undefined,
      arguments: Array.isArray(p.arguments)
        ? validatePromptArguments(p.arguments, pluginName, i, sourcePath)
        : undefined,
    });
  }
  return validated;
};

/**
 * Validate prompt arguments within a prompt entry.
 * Invalid arguments are filtered out with a warning.
 */
const validatePromptArguments = (
  args: unknown[],
  pluginName: string,
  promptIndex: number,
  sourcePath: string,
): ManifestPromptArgument[] => {
  const validated: ManifestPromptArgument[] = [];
  for (let j = 0; j < args.length; j++) {
    const raw: unknown = args[j];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      log.warn(
        `Plugin "${pluginName}" prompts[${promptIndex}].arguments[${j}] at ${sourcePath} is not an object — skipping`,
      );
      continue;
    }
    const a = raw as Record<string, unknown>;
    if (typeof a.name !== 'string' || a.name.length === 0) {
      log.warn(
        `Plugin "${pluginName}" prompts[${promptIndex}].arguments[${j}] at ${sourcePath} has invalid name — skipping`,
      );
      continue;
    }
    validated.push({
      name: a.name,
      description: typeof a.description === 'string' ? a.description : undefined,
      required: typeof a.required === 'boolean' ? a.required : undefined,
    });
  }
  return validated;
};

/**
 * Compute SHA-256 hex hash of content using the Web Crypto API.
 */
const computeHash = async (content: string): Promise<string> => {
  const encoded = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
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
 * @param trustTier - Trust classification for this plugin
 * @param source - How the plugin was discovered: 'npm' or 'local'
 */
const loadPlugin = async (
  dir: string,
  trustTier: TrustTier,
  source: PluginSource,
): Promise<Result<LoadedPlugin, string>> => {
  // Read and validate package.json
  const pkgJsonPath = join(dir, 'package.json');
  let pkgJsonRaw: unknown;
  try {
    pkgJsonRaw = await Bun.file(pkgJsonPath).json();
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

  // Read adapter IIFE
  const iifePath = join(dir, 'dist', ADAPTER_FILENAME);
  const iifeFile = Bun.file(iifePath);
  if (!(await iifeFile.exists())) {
    return err(`Adapter IIFE not found at ${iifePath}`);
  }
  const iifeSize = iifeFile.size;
  if (iifeSize > MAX_IIFE_SIZE) {
    return err(`Adapter IIFE for "${pluginName}" is ${(iifeSize / 1024 / 1024).toFixed(1)}MB, exceeding the 5MB limit`);
  }
  const iife = await iifeFile.text();
  if (iife.length === 0) {
    return err(`Adapter IIFE at ${iifePath} is empty — rebuild the plugin`);
  }

  // Read and validate tools.json
  // Supports two formats:
  //   - Legacy: a plain array of tool definitions (pre-resources/prompts)
  //   - Current: { tools: [...], resources: [...], prompts: [...] }
  const toolsJsonPath = join(dir, 'dist', TOOLS_FILENAME);
  let manifestRaw: unknown;
  try {
    manifestRaw = await Bun.file(toolsJsonPath).json();
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

  // Extract and validate resources and prompts (default to [] for legacy format)
  const resources: ManifestResource[] =
    manifestObj && Array.isArray(manifestObj.resources)
      ? validateResources(manifestObj.resources as unknown[], pluginName, dir)
      : [];
  const prompts: ManifestPrompt[] =
    manifestObj && Array.isArray(manifestObj.prompts)
      ? validatePrompts(manifestObj.prompts as unknown[], pluginName, dir)
      : [];

  // Extract sdkVersion and check compatibility
  const pluginSdkVersion =
    manifestObj && typeof manifestObj.sdkVersion === 'string' ? manifestObj.sdkVersion : undefined;

  if (pluginSdkVersion === undefined) {
    log.warn(`Plugin "${pluginName}" does not declare sdkVersion — skipping compatibility check`);
  } else {
    const compat = checkSdkCompatibility(pluginSdkVersion, serverSdkVersion);
    if (!compat.compatible && compat.error) {
      return err(`${compat.error}. Rebuild the plugin: cd ${dir} && bun install && bun run build`);
    }
  }

  // Warn about browser tool references in tool descriptions (prompt injection detection)
  for (const match of checkBrowserToolReferences(tools)) {
    log.warn(
      `Plugin "${pluginName}" tool "${match.toolName}" description references browser tool "${match.browserToolName}" — possible prompt injection attempt`,
    );
  }

  // Compute adapter hash from IIFE content
  const adapterHash = await computeHash(iife);

  // Read source map if available (optional — older plugins won't have one)
  const sourceMapPath = join(dir, 'dist', ADAPTER_SOURCE_MAP_FILENAME);
  let iifeSourceMap: string | undefined;
  try {
    const sourceMapFile = Bun.file(sourceMapPath);
    if (await sourceMapFile.exists()) {
      iifeSourceMap = await sourceMapFile.text();
    }
  } catch {
    // Source map not available — not an error
  }

  // Extract optional SVG icons from manifest
  const iconSvg = manifestObj && typeof manifestObj.iconSvg === 'string' ? manifestObj.iconSvg : undefined;
  const iconInactiveSvg =
    manifestObj && typeof manifestObj.iconInactiveSvg === 'string' ? manifestObj.iconInactiveSvg : undefined;

  return ok({
    name: pluginName,
    version: pkg.version,
    displayName: pkg.opentabs.displayName,
    description: pkg.opentabs.description,
    urlPatterns: pkg.opentabs.urlPatterns,
    trustTier,
    iife,
    tools,
    resources,
    prompts,
    source,
    sourcePath: dir,
    adapterHash,
    npmPackageName: pkg.name,
    sdkVersion: pluginSdkVersion,
    iifeSourceMap,
    iconSvg,
    iconInactiveSvg,
  });
};

export {
  checkBrowserToolReferences,
  checkSdkCompatibility,
  extractToolsArray,
  loadPlugin,
  parseMajorMinor,
  pluginNameFromPackage,
  validatePrompts,
  validateResources,
  validateTools,
};
export type { LoadedPlugin };
