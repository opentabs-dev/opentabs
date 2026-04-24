/**
 * Shared type definitions for the OpenTabs Platform.
 *
 * Types used across both the MCP server and Chrome extension are defined here
 * to provide compile-time safety for the JSON-RPC wire protocol and shared
 * domain concepts.
 */

// ---------------------------------------------------------------------------
// Browser tools catalog — static metadata generated at build time
// ---------------------------------------------------------------------------

export {
  BROWSER_TOOLS_CATALOG,
  type BrowserToolMeta,
} from './generated/browser-tools-catalog.js';

// ---------------------------------------------------------------------------
// Chrome tab group colors — single source of truth
// ---------------------------------------------------------------------------

export { isTabGroupColor, TAB_GROUP_COLORS, type TabGroupColor } from './tab-group-colors.js';

// ---------------------------------------------------------------------------
// Cross-platform utilities
// ---------------------------------------------------------------------------

export {
  atomicWrite,
  isWindows,
  platformExec,
  safeChmod,
  sanitizeEnv,
} from './cross-platform.js';

// ---------------------------------------------------------------------------
// Error utilities
// ---------------------------------------------------------------------------

export { toErrorMessage } from './error.js';

// ---------------------------------------------------------------------------
// Shared constants — port, filenames, config paths, crypto
// ---------------------------------------------------------------------------

export {
  ADAPTER_FILENAME,
  ADAPTER_SOURCE_MAP_FILENAME,
  DEFAULT_HOST,
  DEFAULT_PORT,
  generateSecret,
  getConfigDir,
  getConfigPath,
  getExtensionDir,
  getLogFilePath,
  getPidFilePath,
  getTelemetryIdPath,
  normalizePluginName,
  PLATFORM_PACKAGES,
  PLUGIN_PREFIX,
  PRE_SCRIPT_FILENAME,
  pluginNameFromPackage,
  resolvePluginPackageCandidates,
  TOOLS_FILENAME,
} from './constants.js';

// ---------------------------------------------------------------------------
// Result type — structured error handling
// ---------------------------------------------------------------------------

export {
  type Err,
  err,
  isErr,
  isOk,
  mapResult,
  type Ok,
  ok,
  type Result,
  unwrap,
  unwrapOr,
} from './result.js';

// ---------------------------------------------------------------------------
// Plugin package.json manifest — new plugin metadata format
// ---------------------------------------------------------------------------

export type {
  ConfigSchema,
  ConfigSettingDefinition,
  ConfigSettingType,
  PluginOpentabsField,
  PluginPackageJson,
} from './manifest.js';
export {
  isValidPluginPackageName,
  parsePluginPackageJson,
} from './manifest.js';

// ---------------------------------------------------------------------------
// Domain types — shared between MCP server and Chrome extension
// ---------------------------------------------------------------------------

/** Tab state for a plugin */
export type TabState = 'closed' | 'unavailable' | 'ready';

/** Permission state for a tool or plugin: off (disabled), ask (prompt before each use), auto (always allow) */
export type ToolPermission = 'off' | 'ask' | 'auto';

/** Per-plugin permission configuration */
export interface PluginPermissionConfig {
  /** Default permission for all tools in this plugin */
  permission?: ToolPermission;
  /** Per-tool permission overrides (tool base name → permission) */
  tools?: Record<string, ToolPermission>;
  /** Plugin version that was reviewed. When present and matching the installed version, the plugin is considered reviewed. */
  reviewedVersion?: string;
}

/** Confirmation request sent to the extension when a tool requires user approval */
export interface ConfirmationRequest {
  id: string;
  tool: string;
  plugin: string;
  params: Record<string, unknown>;
}

/** Confirmation response from the extension */
export interface ConfirmationResponse {
  id: string;
  decision: 'allow' | 'deny';
  /** When true, the user wants to auto-allow this tool in the future */
  alwaysAllow?: boolean;
}

/** Manifest shape as written by `opentabs-plugin build` */
export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  url_patterns: string[];
  exclude_patterns?: string[];
  homepage?: string;
  /** SDK version the plugin was built with (set by `opentabs-plugin build` since SDK 0.0.17) */
  sdkVersion?: string;
  tools: ManifestTool[];
  /** SHA-256 hex hash of the adapter IIFE content (set by `opentabs-plugin build`) */
  adapterHash?: string;
  /** Optional SVG icon for the plugin */
  iconSvg?: string;
  /** Optional SVG icon for the inactive state */
  iconInactiveSvg?: string;
}

/** Single tool definition within a plugin manifest */
export interface ManifestTool {
  name: string;
  /** Human-readable display name shown in the side panel */
  displayName: string;
  description: string;
  /** Short human-readable summary for the UI. Falls back to description if omitted. */
  summary?: string;
  /** Lucide icon name (kebab-case) displayed in the side panel */
  icon: string;
  /** Tool group for visual grouping in the side panel */
  group?: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  /** Optional SVG icon for the tool */
  iconSvg?: string;
  /** Optional SVG icon for the inactive state */
  iconInactiveSvg?: string;
}

/** Minimal WebSocket handle — the subset of ServerWebSocket used by handlers */
export interface WsHandle {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 base types
// ---------------------------------------------------------------------------

/** JSON-RPC 2.0 notification (no id — no response expected) */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 request (has id — response expected) */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id: string | number;
}

/** JSON-RPC 2.0 success response */
export interface JsonRpcResult {
  jsonrpc: '2.0';
  result: unknown;
  id: string | number;
}

/** JSON-RPC 2.0 error response (id is null when the request id was unparseable) */
export interface JsonRpcError {
  jsonrpc: '2.0';
  error: { code: number; message: string; data?: Record<string, unknown> };
  id: string | number | null;
}

// ---------------------------------------------------------------------------
// Wire message types — MCP server ↔ Chrome extension protocol
//
// These interfaces describe the JSON-RPC messages exchanged over WebSocket
// between the MCP server and the Chrome extension. Each message type is a
// specialization of the base JSON-RPC types above.
// ---------------------------------------------------------------------------

/** Tool definition as sent over the wire (sync.full / plugin.update) */
export interface WireToolDef {
  name: string;
  /** Human-readable display name shown in the side panel */
  displayName: string;
  description: string;
  /** Short human-readable summary for the UI. Falls back to description if omitted. */
  summary?: string;
  /** Lucide icon name (kebab-case) displayed in the side panel */
  icon: string;
  /** Tool group for visual grouping in the side panel */
  group?: string;
  permission: ToolPermission;
  /** Optional SVG icon for the tool */
  iconSvg?: string;
  /** Optional SVG icon for the inactive state */
  iconInactiveSvg?: string;
}

/** Plugin payload as sent in sync.full and plugin.update messages */
export interface WirePluginPayload {
  name: string;
  version: string;
  displayName: string;
  urlPatterns: string[];
  excludePatterns?: string[];
  homepage?: string;
  permission: ToolPermission;
  sourcePath?: string;
  adapterHash?: string;
  tools: WireToolDef[];
  /** Optional SVG icon for the plugin */
  iconSvg?: string;
  /** Optional SVG icon for the inactive state */
  iconInactiveSvg?: string;
}

/** sync.full notification: server → extension (all plugins on connect) */
export interface SyncFullParams {
  plugins: WirePluginPayload[];
}

/** tool.dispatch request: server → extension */
export interface ToolDispatchParams {
  /** Plugin name (e.g. "googledocs") */
  plugin: string;
  /** Tool base name without plugin prefix (e.g. "get_document") */
  tool: string;
  /** Validated tool input — tabId has been stripped before this reaches the plugin */
  input: Record<string, unknown>;
  /** Optional tab ID for targeted dispatch to a specific browser tab. When present, the extension dispatches to exactly this tab (with URL pattern validation). When absent, the extension auto-selects the best-ranked ready tab. */
  tabId?: number;
}

/** tool.invocationStart notification: server → extension (side panel animation) */
export interface ToolInvocationStartParams {
  plugin: string;
  tool: string;
  ts: number;
}

/** tool.invocationEnd notification: server → extension (side panel animation) */
export interface ToolInvocationEndParams {
  plugin: string;
  tool: string;
  durationMs: number;
  success: boolean;
}

/** plugin.update notification: server → extension (file watcher / hot reload) */
export type PluginUpdateParams = WirePluginPayload;

/** Per-tab info reported by the extension for multi-tab state tracking */
export interface PluginTabInfo {
  /** Chrome tab ID */
  tabId: number;
  /** Current URL of the tab */
  url: string;
  /** Document title of the tab */
  title: string;
  /** Whether the plugin adapter is ready in this tab */
  ready: boolean;
}

/** tab.stateChanged notification: extension → server — sent whenever any tab state changes for a plugin */
export interface TabStateChangedParams {
  /** Plugin name */
  plugin: string;
  /** Aggregate state: 'ready' if any tab is ready, 'unavailable' if tabs exist but none ready, 'closed' if no tabs */
  state: TabState;
  /** All matching tabs for this plugin with per-tab readiness */
  tabs: PluginTabInfo[];
}

/** tab.syncAll notification: extension → server — sent on connect/reconnect with full state for all plugins */
export interface TabSyncAllParams {
  /** Map from plugin name to its aggregate state and full tab list */
  tabs: Record<string, { state: TabState; tabs: PluginTabInfo[] }>;
}

/** config.getState response payload */
export interface ConfigStatePlugin {
  name: string;
  displayName: string;
  version: string;
  permission: ToolPermission;
  source: 'npm' | 'local';
  /** Full npm package name (e.g., '@opentabs-dev/opentabs-plugin-github'). Only present for npm-sourced plugins. */
  npmPackageName?: string;
  tabState: TabState;
  /** Individual matching tabs with per-tab details. Only present when tabState is not 'closed'. */
  tabs?: PluginTabInfo[];
  urlPatterns: string[];
  excludePatterns?: string[];
  homepage?: string;
  /** Whether the extension has a last-seen URL for this plugin (fallback when no homepage). */
  hasLastSeenUrl?: boolean;
  /** SDK version the plugin was built with (from tools.json). Undefined for old plugins. */
  sdkVersion?: string;
  tools: WireToolDef[];
  /** Optional SVG icon for the plugin */
  iconSvg?: string;
  /** Optional SVG icon for the inactive state */
  iconInactiveSvg?: string;
  /** Optional SVG icon for dark mode */
  iconDarkSvg?: string;
  /** Optional SVG icon for dark mode inactive state */
  iconDarkInactiveSvg?: string;
  /** Whether this plugin's current version has been reviewed (reviewedVersion matches installed version) */
  reviewed: boolean;
  /** Present when a newer version of this plugin is available on npm */
  update?: { latestVersion: string; updateCommand: string };
  /** Plugin's configuration schema, if declared */
  configSchema?: import('./manifest.js').ConfigSchema;
  /** Resolved setting values for this plugin. url fields store the full Record<string, string> map. */
  resolvedSettings?: Record<string, unknown>;
  /** Instance name → Chrome match pattern mapping for multi-instance url settings */
  instanceMap?: Record<string, string>;
  /** Whether this plugin ships a pre-script that runs at document_start in MAIN world */
  hasPreScript: boolean;
}

/** A plugin that failed discovery, sent to the side panel for display */
export interface ConfigStateFailedPlugin {
  specifier: string;
  error: string;
}

/** A browser tool entry in config.getState result */
export interface ConfigStateBrowserTool {
  name: string;
  description: string;
  /** Short human-readable summary for the UI. Falls back to description if omitted. */
  summary?: string;
  permission: ToolPermission;
  /** Lucide icon name (kebab-case) for the side panel */
  icon?: string;
  /** Logical group name for displaying this tool in the side panel (e.g. 'Tabs', 'Network'). */
  group?: string;
}

/** config.getState result */
export interface ConfigStateResult {
  plugins: ConfigStatePlugin[];
  failedPlugins: ConfigStateFailedPlugin[];
  browserTools: ConfigStateBrowserTool[];
  /** Plugin-level default permission for the browser pseudo-plugin */
  browserPermission?: ToolPermission;
  serverVersion?: string;
  /** Absolute path to the MCP server's package directory on disk */
  serverSourcePath?: string;
  /** When true, all permission checks are bypassed (all tools run as auto) */
  skipPermissions?: boolean;
  /** SHA-256 content hash of the extension bundle files, computed at build time */
  extensionHash?: string;
  /** Available CLI update detected by the server. Omitted when up-to-date or running from source. */
  serverUpdate?: { latestVersion: string; updateCommand: string };
}

/** config.setToolPermission request params */
export interface ConfigSetToolPermissionParams {
  plugin: string;
  tool: string;
  permission: ToolPermission;
}

/** config.setPluginPermission request params (sets plugin-level default) */
export interface ConfigSetPluginPermissionParams {
  plugin: string;
  permission: ToolPermission;
  /** When provided, sets the plugin's reviewedVersion (used by "Enable Anyway" in the side panel) */
  reviewedVersion?: string;
}

/** extension.reload request: server → extension (no params needed) */
export type ExtensionReloadParams = Record<string, never>;

/** browser.openTab request params */
export interface BrowserOpenTabParams {
  url: string;
}

/** browser.navigateTab request params */
export interface BrowserNavigateTabParams {
  tabId: number;
  url: string;
}

/** browser.closeTab request params */
export interface BrowserCloseTabParams {
  tabId: number;
}

/** browser.executeScript request params */
export interface BrowserExecuteScriptParams {
  tabId: number;
  /** Filename of the exec script written by the MCP server to the adapters/ directory */
  execFile: string;
}

/** plugin.uninstall request params */
export interface PluginUninstallParams {
  name: string;
}

// ---------------------------------------------------------------------------
// Security constants — shared between MCP server and Chrome extension
// ---------------------------------------------------------------------------

/** Returns true if the URL uses a blocked (non-http/https) scheme or is unparseable. */
export const isBlockedUrlScheme = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    // Allowlist approach: only http(s) are safe. This catches javascript:, data:, file:, etc.
    return parsed.protocol !== 'http:' && parsed.protocol !== 'https:';
  } catch {
    return true;
  }
};

/**
 * Matches paths to exclude when copying the browser extension to ~/.opentabs/extension/.
 *
 * Excluded categories:
 * - Directories: node_modules, src, .git, .storybook, storybook-static
 * - File patterns: tsconfig*, build-*.ts
 * - Root-level metadata: package.json, CLAUDE.md
 */
export const EXTENSION_COPY_EXCLUDE_PATTERN =
  /(?:^|[\\/])(?:node_modules|src|\.git|\.storybook|storybook-static)(?:[\\/]|$)|(?:^|[\\/])tsconfig[^/\\]*|(?:^|[\\/])build-[^/\\]*\.ts$|(?:^|[\\/])package\.json$|(?:^|[\\/])CLAUDE\.md$/;

// ---------------------------------------------------------------------------
// Plugin name validation
// ---------------------------------------------------------------------------

/** Regex for valid plugin names: lowercase alphanumeric with hyphens */
export const NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Plugin names that conflict with platform internals */
export const RESERVED_NAMES = new Set([
  'system',
  'browser',
  'opentabs',
  'extension',
  'config',
  'plugin',
  'tool',
  'mcp',
]);

/** Validate a plugin name. Returns an error message string, or null if valid. */
export const validatePluginName = (name: string): string | null => {
  if (name.length === 0) return 'Plugin name is required';
  if (!NAME_REGEX.test(name))
    return `Plugin name "${name}" must be lowercase alphanumeric with hyphens (e.g., "my-plugin")`;
  if (RESERVED_NAMES.has(name)) return `Plugin name "${name}" is reserved — choose a different name`;
  return null;
};

// ---------------------------------------------------------------------------
// URL pattern validation
// ---------------------------------------------------------------------------

/**
 * Validates a Chrome match pattern.
 * Valid formats: <scheme>://<host>/<path>
 * scheme: *, http, https (Chrome removed FTP support)
 * host: *.example.com, example.com (bare '*' is rejected as too broad)
 * path: any string starting with /
 *
 * Returns an error message string, or null if valid.
 */
export const validateUrlPattern = (pattern: string): string | null => {
  // Reject overly broad patterns
  if (pattern === '*://*/*' || pattern === '<all_urls>') {
    return `URL pattern "${pattern}" is too broad — restrict to specific domains`;
  }

  const match = pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/s);
  if (!match) {
    return `URL pattern "${pattern}" is not a valid Chrome match pattern — expected <scheme>://<host>/<path> where scheme is *, http, or https and path starts with / (e.g., https://example.com/*)`;
  }

  const path = match[3] ?? '/';
  const wildcardCount = path.split('*').length - 1;
  if (wildcardCount > 5) {
    return 'URL pattern has too many wildcards in path (max 5)';
  }

  const host = match[2] ?? '';

  // Reject bare TLD wildcards (e.g., *.com, *.org) — these match nearly every website.
  // A wildcard host must include at least a second-level domain (e.g., *.example.com).
  if (/^\*\.[a-z]{2,}$/i.test(host)) {
    return `URL pattern "${pattern}" is too broad — "${host}" matches all domains under a TLD. Use a more specific domain (e.g., *.example.com)`;
  }

  // Reject bare wildcard host '*' — matches every domain, equivalent to <all_urls>.
  if (host === '*') {
    return `URL pattern "${pattern}" is too broad — "*" matches all domains. Use a specific domain or wildcard subdomain (e.g., *.example.com)`;
  }

  // Host must be *.domain, a specific domain, or localhost (with optional port).
  // Chrome match patterns natively support localhost — essential for local development
  // and E2E testing where plugins target local web servers.
  if (
    !/^localhost(:\d+)?$/.test(host) &&
    !/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host) &&
    !/^(\*\.)?[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/i.test(host)
  ) {
    return `URL pattern "${pattern}" has an invalid host "${host}"`;
  }

  // Validate IPv4 octet ranges (0-255) to reject addresses like 999.999.999.999.
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) {
    const hostWithoutPort = host.replace(/:\d+$/, '');
    const octets = hostWithoutPort.split('.').map(Number);
    if (octets.some(o => o > 255)) {
      return `Invalid IPv4 address in URL pattern: octets must be 0-255, got '${hostWithoutPort}'`;
    }
  }

  return null;
};
