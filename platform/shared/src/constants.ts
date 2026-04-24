/**
 * Shared constants for the OpenTabs platform.
 *
 * These values are used by multiple packages (MCP server, CLI, plugin-tools,
 * browser-extension). Defining them once here prevents drift and duplication.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/** Default port for the MCP server (HTTP + WebSocket) */
export const DEFAULT_PORT = 9515;

/** Default host for the MCP server — use 127.0.0.1 instead of 'localhost' to avoid
 *  IPv6 resolution issues on systems where localhost resolves to ::1 first. */
export const DEFAULT_HOST = '127.0.0.1';

// ---------------------------------------------------------------------------
// Plugin build artifacts
// ---------------------------------------------------------------------------

/** Filename of the bundled adapter IIFE produced by `opentabs-plugin build` */
export const ADAPTER_FILENAME = 'adapter.iife.js';

/** Filename of the source map for the adapter IIFE */
export const ADAPTER_SOURCE_MAP_FILENAME = 'adapter.iife.js.map';

/** Filename of the tool manifest produced by `opentabs-plugin build` */
export const TOOLS_FILENAME = 'tools.json';

/** Filename of the bundled pre-script IIFE (when declared by a plugin) */
export const PRE_SCRIPT_FILENAME = 'pre-script.iife.js';

// ---------------------------------------------------------------------------
// Config directory paths
// ---------------------------------------------------------------------------

/** Returns the config directory path (~/.opentabs or OPENTABS_CONFIG_DIR override).
 *  Re-evaluated on each call so test overrides via OPENTABS_CONFIG_DIR take effect. */
export const getConfigDir = (): string => process.env.OPENTABS_CONFIG_DIR || join(homedir(), '.opentabs');

/** Returns the path to config.json inside the config directory. */
export const getConfigPath = (): string => join(getConfigDir(), 'config.json');

/** Returns the managed extension install directory (~/.opentabs/extension/). */
export const getExtensionDir = (): string => join(getConfigDir(), 'extension');

/** Returns the path to the server log file (~/.opentabs/server.log). */
export const getLogFilePath = (): string => join(getConfigDir(), 'server.log');

/** Returns the path to the server PID file (~/.opentabs/server.pid). */
export const getPidFilePath = (): string => join(getConfigDir(), 'server.pid');

/** Returns the path to the anonymous telemetry ID file (~/.opentabs/telemetry-id). */
export const getTelemetryIdPath = (): string => join(getConfigDir(), 'telemetry-id');

// ---------------------------------------------------------------------------
// Plugin naming conventions
// ---------------------------------------------------------------------------

/** Prefix for opentabs plugin npm package names */
export const PLUGIN_PREFIX = 'opentabs-plugin-';

/** Core @opentabs-dev platform packages that are not installable plugins. */
export const PLATFORM_PACKAGES = new Set([
  '@opentabs-dev/browser-extension',
  '@opentabs-dev/cli',
  '@opentabs-dev/create-plugin',
  '@opentabs-dev/mcp-server',
  '@opentabs-dev/plugin-sdk',
  '@opentabs-dev/plugin-tools',
  '@opentabs-dev/shared',
]);

/**
 * Resolve all possible npm package names for a given plugin shorthand.
 *
 * Returns candidates in priority order (official first, then community unscoped).
 * Already-qualified names (scoped or full `opentabs-plugin-*`) return as-is.
 *
 * Examples:
 *   "slack"                              → ["@opentabs-dev/opentabs-plugin-slack", "opentabs-plugin-slack"]
 *   "opentabs-plugin-slack"              → ["opentabs-plugin-slack"]
 *   "@opentabs-dev/opentabs-plugin-slack"→ ["@opentabs-dev/opentabs-plugin-slack"]
 *   "@myorg/opentabs-plugin-jira"        → ["@myorg/opentabs-plugin-jira"]
 */
export const resolvePluginPackageCandidates = (name: string): string[] => {
  if (name.startsWith('@')) return [name];
  if (name.startsWith(PLUGIN_PREFIX)) return [name];
  return [`@opentabs-dev/${PLUGIN_PREFIX}${name}`, `${PLUGIN_PREFIX}${name}`];
};

/**
 * Normalize a shorthand plugin name to its full npm package name.
 *
 * Shorthand names expand to the official scoped package first. Already-qualified
 * names (scoped or prefixed with `opentabs-plugin-`) pass through unchanged.
 *
 * Examples:
 *   "slack"                               → "@opentabs-dev/opentabs-plugin-slack"
 *   "opentabs-plugin-slack"               → "opentabs-plugin-slack"
 *   "@opentabs-dev/opentabs-plugin-slack" → "@opentabs-dev/opentabs-plugin-slack"
 *   "@myorg/opentabs-plugin-jira"         → "@myorg/opentabs-plugin-jira"
 */
export const normalizePluginName = (name: string): string => {
  const candidates = resolvePluginPackageCandidates(name);
  return candidates[0] ?? `@opentabs-dev/${PLUGIN_PREFIX}${name}`;
};

/**
 * Derive the canonical plugin ID from an npm package name.
 *
 * The official `@opentabs-dev` scope is stripped (treated as unscoped). All
 * other scopes are prepended with a hyphen separator. The `opentabs-plugin-`
 * prefix is removed from the package name in all cases.
 *
 * Examples:
 *   "opentabs-plugin-slack"                    → "slack"
 *   "@opentabs-dev/opentabs-plugin-e2e-test"   → "e2e-test"
 *   "@myorg/opentabs-plugin-jira"              → "myorg-jira"
 */
export const pluginNameFromPackage = (pkgName: string): string => {
  const prefixPattern = new RegExp(`^${PLUGIN_PREFIX}`);
  if (pkgName.startsWith('@')) {
    const parts = pkgName.split('/');
    const scopePart = parts[0] ?? '';
    const namePart = parts[1] ?? '';
    const pluginSuffix = namePart.replace(prefixPattern, '');

    // Official scope is invisible — treat like an unscoped package
    if (scopePart === '@opentabs-dev') {
      return pluginSuffix;
    }

    const scope = scopePart.slice(1);
    return `${scope}-${pluginSuffix}`;
  }
  return pkgName.replace(prefixPattern, '');
};

// ---------------------------------------------------------------------------
// Cryptography
// ---------------------------------------------------------------------------

/** Generate a 256-bit cryptographic random secret as a 64-character hex string. */
export const generateSecret = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};
