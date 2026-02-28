/**
 * In-memory state for the MCP server.
 * Tracks plugins, tab-to-plugin mapping, tool config, and pending dispatches.
 *
 * Fields that must survive hot reload (file watcher handles, timers) are stored
 * here rather than at module scope, because module-level variables reset to
 * fresh empty instances on each hot reload re-evaluation.
 */

import { appendAuditEntryToDisk } from './audit-disk.js';
import type { BrowserToolDefinition } from './browser-tools/definition.js';
import type { PermissionsConfig } from './config.js';
import type {
  TabState,
  TrustTier,
  ManifestTool,
  ManifestResource,
  ManifestPrompt,
  WsHandle,
} from '@opentabs-dev/shared';
import type { FSWatcher } from 'node:fs';

/**
 * Creates an empty Map whose mutating methods throw TypeError, preventing
 * accidental corruption of the EMPTY_REGISTRY sentinel via misrouted .set() calls.
 * Object.freeze alone does not block Map.prototype.set (it accesses internal slots).
 */
const createFrozenRegistryMap = <K, V>(): ReadonlyMap<K, V> => {
  const m = new Map<K, V>();
  const throwFn = (): never => {
    throw new TypeError('Cannot mutate a frozen registry map');
  };
  Object.defineProperty(m, 'set', { value: throwFn, writable: false, configurable: false });
  Object.defineProperty(m, 'delete', { value: throwFn, writable: false, configurable: false });
  Object.defineProperty(m, 'clear', { value: throwFn, writable: false, configurable: false });
  return Object.freeze(m) as ReadonlyMap<K, V>;
};

/** Timeout for tool dispatch and browser command requests (ms) */
export const DISPATCH_TIMEOUT_MS = 30_000;

/** Absolute upper bound for a single dispatch, even with continuous progress (5 minutes) */
export const MAX_DISPATCH_TIMEOUT_MS = 300_000;

/** Active file watcher entry for a single plugin directory */
export interface FileWatcherEntry {
  pluginDir: string;
  pluginName: string;
  watchers: FSWatcher[];
  /** Last-seen mtime (ms) for each watched file path — used by mtime polling fallback */
  lastSeenMtimes: Map<string, number>;
}

/** Grouped state for file watching (plugin watchers, config watcher, mtime polling) */
export interface FileWatchingState {
  /** Active file watcher entries — stored on state so hot reload can clean up the previous iteration's handles */
  entries: FileWatcherEntry[];
  /** File watcher debounce timers — stored on state so hot reload can clear them */
  timers: Map<string, ReturnType<typeof setTimeout>>;
  /** Generation counter for file watchers — incremented each time startFileWatching runs.
   *  Debounce callbacks capture the current generation and bail out if it has changed,
   *  preventing stale closures from the previous module evaluation from executing. */
  generation: number;
  /** FSWatcher for ~/.opentabs/ directory, detecting config.json changes */
  configWatcher: FSWatcher | null;
  /** Last-seen mtime (ms) of ~/.opentabs/config.json — used by mtime polling fallback */
  configLastSeenMtime: number | null;
  /** Timer ID for periodic mtime polling — cleared by stopFileWatching */
  mtimePollTimerId: ReturnType<typeof setInterval> | null;
  /** Timestamp (ms since epoch) of the last mtime polling tick, or null if polling hasn't run yet */
  mtimeLastPollAt: number | null;
  /** Running count of times mtime polling detected a change that fs.watch missed */
  mtimePollDetections: number;
  /** Timestamps (ms since epoch) of recent mtime poll detections — used for stale watcher warning */
  mtimePollDetectionTimestamps: number[];
}

/** How a plugin was discovered: auto-discovered from global node_modules or explicitly listed in localPlugins */
export type PluginSource = 'npm' | 'local';

/** Plugin registered in the server */
export interface RegisteredPlugin {
  name: string;
  version: string;
  displayName: string;
  urlPatterns: string[];
  trustTier: TrustTier;
  iife: string;
  tools: ManifestTool[];
  resources: ManifestResource[];
  prompts: ManifestPrompt[];
  /** How this plugin was discovered: 'npm' (global auto-discovery) or 'local' (config localPlugins) */
  source: PluginSource;
  /** SHA-256 hex hash of the adapter IIFE content (from manifest, set by `opentabs-plugin build`) */
  adapterHash?: string;
  /** Source map content for the adapter IIFE (from dist/adapter.iife.js.map). Undefined for old plugins. */
  iifeSourceMap?: string;
  /** Filesystem path for local plugins (used for file watching) */
  sourcePath?: string;
  /** Original npm package name (e.g., 'opentabs-plugin-slack') — only for npm-installed plugins */
  npmPackageName?: string;
  /** SDK version the plugin was built with (from tools.json sdkVersion field). Undefined for old plugins. */
  sdkVersion?: string;
  /** Optional SVG icon for the plugin */
  iconSvg?: string;
  /** Optional SVG icon for the inactive state */
  iconInactiveSvg?: string;
}

/** Tab mapping entry for a plugin */
export interface TabMapping {
  state: TabState;
  tabId: number | null;
  url: string | null;
}

/** Pending dispatch awaiting extension response (tool.dispatch or browser.*) */
export interface PendingDispatch {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  /** Human-readable label for timeout error messages (e.g., "slack/send_message" or "browser.openTab") */
  label: string;
  startTs: number;
  /** Timer ID for the dispatch timeout — cleared when the dispatch settles */
  timerId: ReturnType<typeof setTimeout>;
  /** MCP progressToken from the tools/call request's _meta — used to emit MCP ProgressNotifications */
  progressToken?: string | number;
  /** Callback to emit an MCP ProgressNotification for this dispatch */
  onProgress?: (progress: number, total: number, message?: string) => void;
  /** Timestamp (ms) of the last progress notification — updated by handleToolProgress for observability */
  lastProgressTs?: number;
}

/** Resolved tool lookup entry for O(1) dispatch in tools/call */
export interface ToolLookupEntry {
  pluginName: string;
  toolName: string;
  /** Pre-compiled JSON Schema validator for input args. Null if schema compilation failed. */
  validate: ((data: unknown) => boolean) | null;
  /** Human-readable validation errors from the last validate() call */
  validationErrors: () => string;
}

/** Cached browser tool entry with pre-computed JSON Schema */
export interface CachedBrowserTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  tool: BrowserToolDefinition;
}

/** Tool config: maps prefixed tool name → enabled boolean */
export type ToolConfig = Record<string, boolean>;

/** A plugin path that failed discovery, with a human-readable error */
export interface FailedPlugin {
  path: string;
  error: string;
}

/** Info about an outdated npm plugin */
export interface OutdatedPlugin {
  name: string;
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
}

/** Resolved resource lookup entry for O(1) dispatch in resources/read */
export interface ResourceLookupEntry {
  pluginName: string;
  /** Original (unprefixed) resource URI as defined in the plugin manifest */
  originalUri: string;
}

/** Resolved prompt lookup entry for O(1) dispatch in prompts/get */
export interface PromptLookupEntry {
  pluginName: string;
  /** Original (unprefixed) prompt name as defined in the plugin manifest */
  originalName: string;
}

/**
 * Immutable registry of discovered plugins.
 *
 * Holds all successfully loaded plugins, a pre-built O(1) tool lookup map
 * with compiled Ajv validators, O(1) resource and prompt lookup maps,
 * and a list of discovery failures. Built once per reload cycle and
 * swapped atomically on ServerState.
 */
export interface PluginRegistry {
  /** All successfully loaded plugins, keyed by internal plugin name */
  readonly plugins: ReadonlyMap<string, RegisteredPlugin>;
  /** O(1) tool lookup: prefixed tool name → plugin/tool names + validator */
  readonly toolLookup: ReadonlyMap<string, ToolLookupEntry>;
  /** O(1) resource lookup: prefixed URI → plugin name + original URI */
  readonly resourceLookup: ReadonlyMap<string, ResourceLookupEntry>;
  /** O(1) prompt lookup: prefixed name → plugin name + original name */
  readonly promptLookup: ReadonlyMap<string, PromptLookupEntry>;
  /** Plugin paths that failed discovery */
  readonly failures: readonly FailedPlugin[];
}

/** Confirmation timeout for human approval (30 seconds) */
export const CONFIRMATION_TIMEOUT_MS = 30_000;

/** Pending confirmation awaiting human approval */
export interface PendingConfirmation {
  resolve: (decision: ConfirmationDecision) => void;
  reject: (error: Error) => void;
  timerId: ReturnType<typeof setTimeout>;
  tool: string;
  domain: string | null;
  tabId?: number;
}

/** Decision from the side panel confirmation dialog */
export type ConfirmationDecision = 'allow_once' | 'allow_always' | 'deny';

/** Scope for "Allow Always" session permissions */
export type ConfirmationScope = 'tool_domain' | 'tool_all' | 'domain_all';

/** Session-scoped permission rule created by "Allow Always" */
export interface SessionPermissionRule {
  tool: string | null;
  domain: string | null;
  scope: ConfirmationScope;
}

/** Check if a tool+domain combination is allowed by session permissions */
export const isSessionAllowed = (rules: SessionPermissionRule[], toolName: string, domain: string | null): boolean =>
  rules.some(rule => {
    switch (rule.scope) {
      case 'tool_domain':
        return rule.tool === toolName && rule.domain === domain;
      case 'tool_all':
        return rule.tool === toolName;
      case 'domain_all':
        return rule.domain === null || rule.domain === domain;
      default:
        return false;
    }
  });

/** Record of a single tool invocation for audit logging */
export interface AuditEntry {
  /** ISO 8601 timestamp of the invocation */
  timestamp: string;
  /** Prefixed tool name (e.g., 'slack_send_message') */
  tool: string;
  /** Plugin name (e.g., 'slack') or 'browser' for browser tools */
  plugin: string;
  /** Whether the invocation completed successfully */
  success: boolean;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Error details, populated on failure */
  error?: { code: string; message: string; category?: string };
}

/** Maximum entries retained in the audit log circular buffer */
export const MAX_AUDIT_ENTRIES = 500;

/** Append an entry to the audit log, trimming oldest entries beyond MAX_AUDIT_ENTRIES.
 *  Also persists the entry to ~/.opentabs/audit.log as NDJSON (fire-and-forget). */
export const appendAuditEntry = (state: ServerState, entry: AuditEntry): void => {
  state.auditLog.push(entry);
  if (state.auditLog.length > MAX_AUDIT_ENTRIES) {
    state.auditLog.splice(0, state.auditLog.length - MAX_AUDIT_ENTRIES);
  }
  // Fire-and-forget disk write — errors are logged internally, never block dispatch
  void appendAuditEntryToDisk(entry);
};

/** Server state singleton — shared across hot reloads via globalThis */
export interface ServerState {
  /**
   * Schema version for detecting structural changes across hot reloads.
   * If a developer changes the shape of an existing field (e.g., Map → Array),
   * bumping this version triggers a warning on the next hot reload indicating
   * a process restart is needed for full consistency.
   */
  _schemaVersion: number;
  /** Immutable plugin registry — replaced atomically on each reload */
  registry: PluginRegistry;
  /** Tab-to-plugin mapping from extension */
  tabMapping: Map<string, TabMapping>;
  /** Tool enabled/disabled config (in-memory, synced from ~/.opentabs/config.json) */
  toolConfig: ToolConfig;
  /** Browser tool enabled/disabled policy (in-memory, synced from ~/.opentabs/config.json) */
  browserToolPolicy: Record<string, boolean>;
  /** Local plugin paths from config */
  pluginPaths: string[];
  /** Pending tool dispatches keyed by JSON-RPC id */
  pendingDispatches: Map<string | number, PendingDispatch>;
  /** Extension WebSocket connection (single connection) */
  extensionWs: WsHandle | null;
  /** Outdated npm plugins detected on startup */
  outdatedPlugins: OutdatedPlugin[];
  /** Browser tools — updated on each hot reload so existing session handlers see fresh definitions */
  browserTools: BrowserToolDefinition[];
  /** Grouped state for file watching (plugin watchers, config watcher, mtime polling) */
  fileWatching: FileWatchingState;
  /** Shared secret for WebSocket authentication (loaded from config) */
  wsSecret: string | null;
  /** Cached browser tools with pre-computed JSON Schema. Rebuilt on each reload. */
  cachedBrowserTools: CachedBrowserTool[];
  /** Maps each MCP session server to its transport ID for accurate stale session sweeping */
  sessionTransportIds: WeakMap<object, string>;
  /** Async write mutex for config file — stored on state so it survives hot reload */
  configWriteMutex: Promise<void>;
  /** Per-plugin active dispatch count for concurrency limiting */
  activeDispatches: Map<string, number>;
  /** Periodic timer for sweeping stale MCP sessions between hot reloads */
  sweepTimerId: ReturnType<typeof setInterval> | null;
  /** Timestamp (ms since epoch) when the server process first started — survives hot reloads */
  startedAt: number;
  /** Discovery errors from the most recent reload — used by config.getState for the side panel */
  discoveryErrors: ReadonlyArray<{ specifier: string; error: string }>;
  /** Circular buffer of recent tool invocations for diagnostics and monitoring */
  auditLog: AuditEntry[];
  /** Whether confirmation prompts are bypassed (from CLI flag, env var, or config) */
  skipConfirmation: boolean;

  /** Permission rules for browser tool confirmation */
  permissions: PermissionsConfig;
  /** Pending confirmation requests awaiting human approval in the side panel */
  pendingConfirmations: Map<string, PendingConfirmation>;
  /** Session-scoped permission rules set by "Allow Always" actions during this server lifetime */
  sessionPermissions: SessionPermissionRule[];
  /** Whether an extension reload is pending (set when extension files are updated but extension is not connected) */
  pendingExtensionReload: boolean;
  /** Rate-limit timestamps for administrative endpoints — keyed by endpoint path, values are call timestamps (ms) */
  endpointCallTimestamps: Map<string, number[]>;
  /** Whether the extension adapters/ directory has been created (cached to avoid repeated mkdir calls) */
  adaptersDirReady: boolean;
  /** Set of tab IDs that currently have active network capture (browser_enable_network_capture called, not yet disabled) */
  activeNetworkCaptures: Set<number>;
}

/** Increment when changing the type of an existing ServerState field */
export const STATE_SCHEMA_VERSION = 4;

/** Frozen empty registry for initializing ServerState */
export const EMPTY_REGISTRY: PluginRegistry = Object.freeze({
  plugins: createFrozenRegistryMap<string, RegisteredPlugin>(),
  toolLookup: createFrozenRegistryMap<string, ToolLookupEntry>(),
  resourceLookup: createFrozenRegistryMap<string, ResourceLookupEntry>(),
  promptLookup: createFrozenRegistryMap<string, PromptLookupEntry>(),
  failures: Object.freeze([] as FailedPlugin[]),
});

/**
 * Creates a fresh ServerState with all fields initialized to their defaults.
 *
 * @returns A new ServerState instance with empty collections, no WebSocket connection,
 *          and default permission rules (localhost/127.0.0.1 trusted).
 */
export const createState = (): ServerState => ({
  _schemaVersion: STATE_SCHEMA_VERSION,
  registry: EMPTY_REGISTRY,
  tabMapping: new Map(),
  toolConfig: {},
  browserToolPolicy: {},
  pluginPaths: [],
  pendingDispatches: new Map(),
  extensionWs: null,
  outdatedPlugins: [],
  browserTools: [],
  fileWatching: {
    entries: [],
    timers: new Map(),
    generation: 0,
    configWatcher: null,
    configLastSeenMtime: null,
    mtimePollTimerId: null,
    mtimeLastPollAt: null,
    mtimePollDetections: 0,
    mtimePollDetectionTimestamps: [],
  },
  wsSecret: null,
  cachedBrowserTools: [],
  sessionTransportIds: new WeakMap(),
  configWriteMutex: Promise.resolve(),
  activeDispatches: new Map(),
  sweepTimerId: null,
  startedAt: Date.now(),
  discoveryErrors: [],
  auditLog: [],
  skipConfirmation: false,

  permissions: {
    trustedDomains: ['localhost', '127.0.0.1'],
    sensitiveDomains: [],
    toolPolicy: {},
    domainToolPolicy: {},
  },
  pendingConfirmations: new Map(),
  sessionPermissions: [],
  pendingExtensionReload: false,
  endpointCallTimestamps: new Map(),
  adaptersDirReady: false,
  activeNetworkCaptures: new Set(),
});

/** Generate a cryptographically random JSON-RPC request ID */
export const getNextRequestId = (): string => crypto.randomUUID();

/** Get the prefixed tool name: plugin_tool */
export const prefixedToolName = (plugin: string, tool: string): string => `${plugin}_${tool}`;

/** Get the prefixed resource URI: opentabs+<plugin>://<original-uri-path> */
export const prefixedResourceUri = (plugin: string, uri: string): string => `opentabs+${plugin}://${uri}`;

/** Get the prefixed prompt name: plugin_prompt (same convention as tools) */
export const prefixedPromptName = (plugin: string, promptName: string): string => `${plugin}_${promptName}`;

/** Check if a tool is enabled in config. Tools are enabled by default — only
 *  explicitly disabled tools (set to false) are hidden from MCP clients. */
export const isToolEnabled = (state: ServerState, prefixedName: string): boolean =>
  state.toolConfig[prefixedName] !== false;

/** Check if a browser tool is enabled via browserToolPolicy. Browser tools are
 *  enabled by default — only explicitly disabled tools (set to false) are hidden. */
export const isBrowserToolEnabled = (state: ServerState, toolName: string): boolean =>
  state.browserToolPolicy[toolName] !== false;
