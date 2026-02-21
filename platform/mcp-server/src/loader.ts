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

import { browserTools } from './browser-tools/index.js';
import { log } from './logger.js';
import { err, ok, parsePluginPackageJson, validatePluginName, validateUrlPattern } from '@opentabs-dev/shared';
import { join } from 'node:path';
import type { PluginSource } from './state.js';
import type { ManifestTool, Result, TrustTier } from '@opentabs-dev/shared';

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
  readonly source: PluginSource;
  readonly sourcePath: string;
  readonly adapterHash: string | undefined;
  readonly npmPackageName: string | undefined;
}

/**
 * Extract the internal plugin name from an npm package name.
 * opentabs-plugin-slack → slack
 * @myorg/opentabs-plugin-jira → myorg-jira
 */
const pluginNameFromPackage = (pkgName: string): string => {
  if (pkgName.startsWith('@')) {
    const parts = pkgName.split('/');
    const scopePart = parts[0] ?? '';
    const namePart = parts[1] ?? '';
    const scope = scopePart.slice(1);
    const pluginSuffix = namePart.replace(/^opentabs-plugin-/, '');
    return `${scope}-${pluginSuffix}`;
  }
  return pkgName.replace(/^opentabs-plugin-/, '');
};

/**
 * Browser tool names that should not appear in plugin tool descriptions.
 * Presence of these names may indicate a prompt injection attempt where
 * a plugin tries to instruct the AI agent to invoke browser-level tools.
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
    const t = raw as Record<string, unknown>;

    const name = t.name;
    if (typeof name !== 'string' || name.length === 0) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].name must be a non-empty string`);
    }

    const displayName = t.displayName;
    if (typeof displayName !== 'string' || displayName.length === 0) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].displayName must be a non-empty string`);
    }

    const description = t.description;
    if (typeof description !== 'string' || description.length === 0) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].description must be a non-empty string`);
    }
    if (description.length > 1000) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].description must be at most 1000 characters`);
    }

    const icon = t.icon;
    if (typeof icon !== 'string' || icon.length === 0) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].icon must be a non-empty string`);
    }

    const inputSchema = t.input_schema;
    if (typeof inputSchema !== 'object' || inputSchema === null || Array.isArray(inputSchema)) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].input_schema must be an object`);
    }

    const outputSchema = t.output_schema;
    if (typeof outputSchema !== 'object' || outputSchema === null || Array.isArray(outputSchema)) {
      return err(`Invalid tools.json at ${sourcePath}: tools[${i}].output_schema must be an object`);
    }

    validated.push({
      name,
      displayName,
      description,
      icon,
      input_schema: inputSchema as Record<string, unknown>,
      output_schema: outputSchema as Record<string, unknown>,
    });
  }

  return ok(validated);
};

/**
 * Compute SHA-256 hex hash of content using the Web Crypto API.
 */
const computeHash = async (content: string): Promise<string> => {
  const encoded = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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
  const iifePath = join(dir, 'dist', 'adapter.iife.js');
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
  const toolsJsonPath = join(dir, 'dist', 'tools.json');
  let manifestRaw: unknown;
  try {
    manifestRaw = await Bun.file(toolsJsonPath).json();
  } catch {
    return err(`Failed to read dist/tools.json at ${dir}: file missing or invalid JSON`);
  }

  // Extract the tools array from either format
  const toolsArray = Array.isArray(manifestRaw)
    ? manifestRaw
    : typeof manifestRaw === 'object' && manifestRaw !== null && 'tools' in manifestRaw
      ? (manifestRaw as Record<string, unknown>).tools
      : manifestRaw;

  const toolsResult = validateTools(toolsArray, dir);
  if (!toolsResult.ok) {
    return err(toolsResult.error);
  }
  const tools = toolsResult.value;

  // Warn about browser tool references in tool descriptions (prompt injection detection)
  for (const match of checkBrowserToolReferences(tools)) {
    log.warn(
      `Plugin "${pluginName}" tool "${match.toolName}" description references browser tool "${match.browserToolName}" — possible prompt injection attempt`,
    );
  }

  // Compute adapter hash from IIFE content
  const adapterHash = await computeHash(iife);

  return ok({
    name: pluginName,
    version: pkg.version,
    displayName: pkg.opentabs.displayName,
    description: pkg.opentabs.description,
    urlPatterns: pkg.opentabs.urlPatterns,
    trustTier,
    iife,
    tools,
    source,
    sourcePath: dir,
    adapterHash,
    npmPackageName: pkg.name,
  });
};

export { checkBrowserToolReferences, loadPlugin, pluginNameFromPackage, validateTools };
export type { LoadedPlugin };
