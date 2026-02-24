/**
 * Shared type definitions for the OpenTabs Platform.
 *
 * Types used across both the MCP server and Chrome extension are defined here
 * to provide compile-time safety for the JSON-RPC wire protocol and shared
 * domain concepts.
 */

// ---------------------------------------------------------------------------
// Cross-platform utilities
// ---------------------------------------------------------------------------

export { atomicWrite, isWindows, platformExec, safeChmod } from './cross-platform.js';

// ---------------------------------------------------------------------------
// Error utilities
// ---------------------------------------------------------------------------

export { toErrorMessage } from './error.js';

// ---------------------------------------------------------------------------
// Shared constants — port, filenames, config paths, crypto
// ---------------------------------------------------------------------------

export {
  DEFAULT_PORT,
  ADAPTER_FILENAME,
  ADAPTER_SOURCE_MAP_FILENAME,
  TOOLS_FILENAME,
  getConfigDir,
  getConfigPath,
  getExtensionDir,
  getLogFilePath,
  generateSecret,
  OFFICIAL_SCOPE,
  PLUGIN_PREFIX,
  normalizePluginName,
  resolvePluginPackageCandidates,
} from './constants.js';

// ---------------------------------------------------------------------------
// Result type — structured error handling
// ---------------------------------------------------------------------------

export { type Ok, type Err, type Result, ok, err, isOk, isErr, unwrap, unwrapOr, mapResult } from './result.js';

// ---------------------------------------------------------------------------
// Plugin package.json manifest — new plugin metadata format
// ---------------------------------------------------------------------------

export { parsePluginPackageJson, isValidPluginPackageName } from './manifest.js';
export type { PluginOpentabsField, PluginPackageJson } from './manifest.js';

// ---------------------------------------------------------------------------
// Domain types — shared between MCP server and Chrome extension
// ---------------------------------------------------------------------------

/** Tab state for a plugin */
export type TabState = 'closed' | 'unavailable' | 'ready';

/** Trust tier for a plugin */
export type TrustTier = 'official' | 'community' | 'local';

/** Manifest shape as written by `opentabs-plugin build` */
export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  url_patterns: string[];
  /** SDK version the plugin was built with (set by `opentabs-plugin build` since SDK 0.0.17) */
  sdkVersion?: string;
  tools: ManifestTool[];
  resources?: ManifestResource[];
  prompts?: ManifestPrompt[];
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
  /** Lucide icon name (kebab-case) displayed in the side panel */
  icon: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  /** Optional SVG icon for the tool */
  iconSvg?: string;
  /** Optional SVG icon for the inactive state */
  iconInactiveSvg?: string;
}

/** Resource definition within a plugin manifest (serialized form — no runtime functions) */
export interface ManifestResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** Prompt argument within a manifest prompt definition */
export interface ManifestPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/** Prompt definition within a plugin manifest (serialized form — no runtime functions) */
export interface ManifestPrompt {
  name: string;
  description?: string;
  arguments?: ManifestPromptArgument[];
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
  /** Lucide icon name (kebab-case) displayed in the side panel */
  icon: string;
  enabled: boolean;
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
  trustTier: TrustTier;
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
  plugin: string;
  tool: string;
  input: Record<string, unknown>;
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

/** tab.stateChanged notification: extension → server */
export interface TabStateChangedParams {
  plugin: string;
  state: TabState;
  tabId: number | null;
  url: string | null;
}

/** tab.syncAll notification: extension → server */
export interface TabSyncAllParams {
  tabs: Record<string, { state: TabState; tabId: number | null; url: string | null }>;
}

/** config.getState response payload */
export interface ConfigStatePlugin {
  name: string;
  displayName: string;
  version: string;
  trustTier: TrustTier;
  source: 'npm' | 'local';
  tabState: TabState;
  urlPatterns: string[];
  /** SDK version the plugin was built with (from tools.json). Undefined for old plugins. */
  sdkVersion?: string;
  tools: WireToolDef[];
  /** Optional SVG icon for the plugin */
  iconSvg?: string;
  /** Optional SVG icon for the inactive state */
  iconInactiveSvg?: string;
  /** Present when a newer version of this plugin is available on npm */
  update?: { latestVersion: string; updateCommand: string };
}

/** A plugin that failed discovery, sent to the side panel for display */
export interface ConfigStateFailedPlugin {
  specifier: string;
  error: string;
}

/** config.getState result */
export interface ConfigStateResult {
  plugins: ConfigStatePlugin[];
  failedPlugins: ConfigStateFailedPlugin[];
}

/** config.setToolEnabled request params */
export interface ConfigSetToolEnabledParams {
  plugin: string;
  tool: string;
  enabled: boolean;
}

/** config.setAllToolsEnabled request params */
export interface ConfigSetAllToolsEnabledParams {
  plugin: string;
  enabled: boolean;
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

/** URL schemes that must be rejected by browser tools to prevent injection attacks */
export const BLOCKED_URL_SCHEMES: readonly string[] = [
  'javascript:',
  'data:',
  'file:',
  'chrome:',
  'chrome-extension:',
  'blob:',
];

/** Check if a URL uses a blocked scheme. Returns true if the URL is dangerous or unparseable. */
export const isBlockedUrlScheme = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return BLOCKED_URL_SCHEMES.includes(parsed.protocol);
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
 * host: *, *.example.com, example.com
 * path: any string starting with /
 *
 * Returns an error message string, or null if valid.
 */
export const validateUrlPattern = (pattern: string): string | null => {
  // Reject overly broad patterns
  if (pattern === '*://*/*' || pattern === '<all_urls>') {
    return `URL pattern "${pattern}" is too broad — restrict to specific domains`;
  }

  const match = pattern.match(/^(\*|https?):\/\/(.+?)(\/.*)$/);
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

  // Host must be *, *.domain, a specific domain, or localhost (with optional port).
  // Chrome match patterns natively support localhost — essential for local development
  // and E2E testing where plugins target local web servers.
  if (
    host !== '*' &&
    !/^localhost(:\d+)?$/.test(host) &&
    !/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host) &&
    !/^(\*\.)?[a-z0-9]+([-.]?[a-z0-9]+)*\.[a-z]{2,}$/i.test(host)
  ) {
    return `URL pattern "${pattern}" has an invalid host "${host}"`;
  }

  return null;
};
