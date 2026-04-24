/**
 * In-memory state for the MCP server.
 * Tracks plugins, tab-to-plugin mapping, plugin permissions, and pending dispatches.
 *
 * Fields that must survive hot reload (file watcher handles, timers) are stored
 * here rather than at module scope, because module-level variables reset to
 * fresh empty instances on each hot reload re-evaluation.
 */

import type { FSWatcher } from 'node:fs';
import type {
  ConfigSchema,
  ManifestTool,
  PluginPermissionConfig,
  PluginTabInfo,
  TabState,
  ToolPermission,
  WsHandle,
} from '@opentabs-dev/shared';
import { appendAuditEntryToDisk } from './audit-disk.js';
import type { BrowserToolDefinition } from './browser-tools/definition.js';

/**
 * Overrides the mutating methods of an existing Map to throw TypeError, preventing
 * accidental mutation after the registry is built.
 * Object.freeze alone does not block Map.prototype.set (it accesses internal slots).
 */
export const freezeRegistryMap = <K, V>(map: Map<K, V>): ReadonlyMap<K, V> => {
  const throwFn = (): never => {
    throw new TypeError('Cannot mutate a frozen registry map');
  };
  Object.defineProperty(map, 'set', {
    value: throwFn,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(map, 'delete', {
    value: throwFn,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(map, 'clear', {
    value: throwFn,
    writable: false,
    configurable: false,
  });
  return Object.freeze(map) as ReadonlyMap<K, V>;
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
  /** Last-seen mtime (ms) for each watched file path — used by mtime polling fallback.
   * null means the file did not exist when last recorded (sentinel for detecting creation). */
  lastSeenMtimes: Map<string, number | null>;
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
  /** FSWatchers for localPluginDirs parent directories — triggers rediscovery when children appear/disappear */
  pluginDirWatchers: FSWatcher[];
}

/** How a plugin was discovered: auto-discovered from global node_modules or explicitly listed in localPlugins */
export type PluginSource = 'npm' | 'local';

/** Plugin registered in the server */
export interface RegisteredPlugin {
  name: string;
  version: string;
  displayName: string;
  urlPatterns: string[];
  excludePatterns: string[];
  homepage?: string;
  iife: string;
  tools: ManifestTool[];
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
  /** Optional SVG icon for dark mode */
  iconDarkSvg?: string;
  /** Optional SVG icon for dark mode inactive state */
  iconDarkInactiveSvg?: string;
  /** Pre-script IIFE content (when plugin declares preScript in package.json) */
  preScript?: string;
  /** SHA-256 hex hash of the pre-script IIFE content (from manifest) */
  preScriptHash?: string;
  /** Config schema defining user-configurable settings for this plugin */
  configSchema?: ConfigSchema;
  /** Instance name → Chrome match pattern mapping for multi-instance url settings */
  instanceMap?: Record<string, string>;
}

/** Tab mapping entry for a plugin — tracks aggregate state and all matching tabs */
export interface TabMapping {
  state: TabState;
  /** All matching tabs for this plugin with per-tab readiness */
  tabs: PluginTabInfo[];
}

/** A single Chrome extension WebSocket connection (one per browser profile) */
export interface ExtensionConnection {
  ws: WsHandle;
  connectionId: string;
  /** Short human-readable label ('A', 'B', 'C', ...) assigned sequentially per unique connectionId */
  profileLabel: string;
  /** Tab-to-plugin mapping for this connection */
  tabMapping: Map<string, TabMapping>;
  /** Tab IDs with active network capture for this connection */
  activeNetworkCaptures: Set<number>;
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
  /** Connection ID the dispatch was sent over — used by close handler to reject only dispatches for a disconnected connection */
  connectionId?: string;
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
  summary?: string;
  icon?: string;
  group?: string;
  inputSchema: Record<string, unknown>;
  tool: BrowserToolDefinition;
}

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

/**
 * Immutable registry of discovered plugins.
 *
 * Holds all successfully loaded plugins, a pre-built O(1) tool lookup map
 * with compiled Ajv validators, and a list of discovery failures. Built once
 * per reload cycle and swapped atomically on ServerState.
 */
export interface PluginRegistry {
  /** All successfully loaded plugins, keyed by internal plugin name */
  readonly plugins: ReadonlyMap<string, RegisteredPlugin>;
  /** O(1) tool lookup: prefixed tool name → plugin/tool names + validator */
  readonly toolLookup: ReadonlyMap<string, ToolLookupEntry>;
  /** Plugin paths that failed discovery */
  readonly failures: readonly FailedPlugin[];
}

/** Result of a user's confirmation decision */
export interface ConfirmationDecision {
  action: 'allow' | 'deny';
  alwaysAllow: boolean;
}

/** Pending confirmation awaiting human approval */
export interface PendingConfirmation {
  resolve: (decision: ConfirmationDecision) => void;
  reject: (error: Error) => void;
  tool: string;
  plugin: string;
  params: Record<string, unknown>;
}

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

/** Review token issued by plugin_inspect, consumed by plugin_mark_reviewed */
export interface ReviewToken {
  plugin: string;
  version: string;
  createdAt: number;
  used: boolean;
}

/** Time-to-live for review tokens (10 minutes) */
export const REVIEW_TOKEN_TTL_MS = 10 * 60 * 1000;

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
  /** Active extension WebSocket connections keyed by connection ID (one per browser profile) */
  extensionConnections: Map<string, ExtensionConnection>;
  /** Local plugin paths from config */
  pluginPaths: string[];
  /** Parent directories for auto-scanning plugins */
  localPluginDirs: string[];
  /** Pending tool dispatches keyed by JSON-RPC id */
  pendingDispatches: Map<string | number, PendingDispatch>;
  /** Outdated npm plugins detected on startup */
  outdatedPlugins: OutdatedPlugin[];
  /** Available CLI update detected by version check. Undefined when up-to-date or in dev mode. */
  serverUpdate?: { latestVersion: string; updateCommand: string };
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
  /** Periodic timer for npm version checks */
  versionCheckTimerId: ReturnType<typeof setInterval> | null;
  /** Minutes between npm update checks (from config, default 30, 0 = disabled) */
  updateCheckIntervalMinutes: number;
  /** Timestamp (ms since epoch) when the server process first started — survives hot reloads */
  startedAt: number;
  /** Discovery errors from the most recent reload — used by config.getState for the side panel */
  discoveryErrors: ReadonlyArray<{ specifier: string; error: string; source: 'npm' | 'local' }>;
  /** Circular buffer of recent tool invocations for diagnostics and monitoring */
  auditLog: AuditEntry[];
  /** Whether approval prompts for ask-mode tools are bypassed (off tools remain disabled) */
  skipPermissions: boolean;

  /** Per-plugin permission configuration from config.json */
  pluginPermissions: Record<string, PluginPermissionConfig>;
  /** Per-plugin user settings: plugin name → { settingKey: value } */
  pluginSettings: Record<string, Record<string, unknown>>;
  /** Pending confirmation requests awaiting human approval in the side panel */
  pendingConfirmations: Map<string, PendingConfirmation>;
  /** Rate-limit timestamps for administrative endpoints — keyed by endpoint path, values are call timestamps (ms) */
  endpointCallTimestamps: Map<string, number[]>;
  /** Whether the extension adapters/ directory has been created (cached to avoid repeated mkdir calls) */
  adaptersDirReady: boolean;
  /** In-memory review tokens: token string → ReviewToken. Lost on restart (intentional). */
  reviewTokens: Map<string, ReviewToken>;
  /** Browser tab ownership: Chrome tab ID → connectionId. Populated by browser_list_tabs,
   *  used by getConnectionForTab to route browser tool dispatches to the correct profile. */
  browserTabOwnership: Map<number, string>;
  /** Pending connectionId for the next WsHandle open — set during upgrade, consumed in the open handler */
  _pendingConnectionId?: string;
  /** Counter for assigning sequential profile labels ('A', 'B', 'C', ...) */
  nextProfileLabel: number;
  /** Maps connectionId → profile label for reuse on same-profile reconnect */
  profileLabelMap: Map<string, string>;
  /** High-water mark of simultaneous pending dispatches */
  peakConcurrentDispatches: number;
  /** Whether the extension ever connected during this session */
  hadExtensionConnection: boolean;
  /** Coalescing state for POST /reload — multiple concurrent requests share one performConfigReload call */
  pendingReload: {
    promise: Promise<{ plugins: number; durationMs: number }>;
    resolve: (result: { plugins: number; durationMs: number }) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null;
}

/** Increment when changing the type of an existing ServerState field */
export const STATE_SCHEMA_VERSION = 8;

/** Frozen empty registry for initializing ServerState */
export const EMPTY_REGISTRY: PluginRegistry = Object.freeze({
  plugins: freezeRegistryMap(new Map<string, RegisteredPlugin>()),
  toolLookup: freezeRegistryMap(new Map<string, ToolLookupEntry>()),
  failures: Object.freeze([] as FailedPlugin[]),
});

/**
 * Creates a fresh ServerState with all fields initialized to their defaults.
 *
 * @returns A new ServerState instance with empty collections and no extension connections.
 */
export const createState = (): ServerState => ({
  _schemaVersion: STATE_SCHEMA_VERSION,
  registry: EMPTY_REGISTRY,
  extensionConnections: new Map(),
  pluginPaths: [],
  localPluginDirs: [],
  pendingDispatches: new Map(),
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
    pluginDirWatchers: [],
  },
  wsSecret: null,
  cachedBrowserTools: [],
  sessionTransportIds: new WeakMap(),
  configWriteMutex: Promise.resolve(),
  activeDispatches: new Map(),
  sweepTimerId: null,
  versionCheckTimerId: null,
  updateCheckIntervalMinutes: 30,
  startedAt: Date.now(),
  discoveryErrors: [],
  auditLog: [],
  skipPermissions: process.env.OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS === '1',

  pluginPermissions: {},
  pluginSettings: {},
  pendingConfirmations: new Map(),
  endpointCallTimestamps: new Map(),
  adaptersDirReady: false,
  reviewTokens: new Map(),
  browserTabOwnership: new Map(),
  pendingReload: null,
  nextProfileLabel: 0,
  profileLabelMap: new Map(),
  peakConcurrentDispatches: 0,
  hadExtensionConnection: false,
});

/** Generate a cryptographically random JSON-RPC request ID */
export const getNextRequestId = (): string => crypto.randomUUID();

/** Get the prefixed tool name: plugin_tool */
export const prefixedToolName = (plugin: string, tool: string): string => `${plugin}_${tool}`;

/** Resolve the configured permission for a tool (ignoring skipPermissions).
 *  Resolution order: per-tool override → plugin default → 'off'.
 *  Used by the side panel to display what the user actually configured. */
export const getConfiguredToolPermission = (
  state: ServerState,
  pluginName: string,
  toolName: string,
): ToolPermission => {
  const pluginConfig = state.pluginPermissions[pluginName];
  return pluginConfig ? (pluginConfig.tools?.[toolName] ?? pluginConfig.permission ?? 'off') : 'off';
};

/** Resolve the effective permission for a tool.
 *  Resolution order: per-tool override → plugin default → 'off', then skipPermissions converts 'ask' to 'auto'. */
export const getToolPermission = (state: ServerState, pluginName: string, toolName: string): ToolPermission => {
  const resolved = getConfiguredToolPermission(state, pluginName, toolName);
  if (state.skipPermissions && resolved === 'ask') return 'auto';
  return resolved;
};

/**
 * Generate a review token for a plugin+version pair.
 * Lazily cleans up expired tokens before creating a new one.
 */
export const generateReviewToken = (state: ServerState, plugin: string, version: string): string => {
  const now = Date.now();

  // Lazily clean up expired tokens
  for (const [key, token] of state.reviewTokens) {
    if (now - token.createdAt > REVIEW_TOKEN_TTL_MS) {
      state.reviewTokens.delete(key);
    }
  }

  const tokenId = crypto.randomUUID();
  state.reviewTokens.set(tokenId, { plugin, version, createdAt: now, used: false });
  return tokenId;
};

/**
 * Validate a review token without consuming it.
 * Returns true only if: token exists, plugin matches, version matches, not used, not expired.
 */
export const validateReviewToken = (state: ServerState, token: string, plugin: string, version: string): boolean => {
  const entry = state.reviewTokens.get(token);
  if (!entry) return false;
  if (entry.plugin !== plugin) return false;
  if (entry.version !== version) return false;
  if (entry.used) return false;
  if (Date.now() - entry.createdAt > REVIEW_TOKEN_TTL_MS) return false;
  return true;
};

/** Mark a review token as used so it cannot be reused. */
export const consumeReviewToken = (state: ServerState, token: string): void => {
  const entry = state.reviewTokens.get(token);
  if (entry) {
    entry.used = true;
  }
};

/** Assign a stable profile label for a connectionId, reusing labels on reconnect */
export const assignProfileLabel = (state: ServerState, connectionId: string): string => {
  const existing = state.profileLabelMap.get(connectionId);
  if (existing) return existing;
  const label = String.fromCharCode(65 + state.nextProfileLabel);
  state.nextProfileLabel++;
  state.profileLabelMap.set(connectionId, label);
  return label;
};

/** Returns any active extension connection, or undefined if none exist */
export const getAnyConnection = (state: ServerState): ExtensionConnection | undefined => {
  if (state.extensionConnections.size === 0) return undefined;
  return state.extensionConnections.values().next().value as ExtensionConnection;
};

/** Finds which connection owns a given tabId by checking the browser tab ownership
 *  index first (populated by browser_list_tabs), then scanning plugin tabMappings. */
export const getConnectionForTab = (state: ServerState, tabId: number): ExtensionConnection | undefined => {
  // Check browser tab ownership index (populated by browser_list_tabs)
  const ownerConnectionId = state.browserTabOwnership.get(tabId);
  if (ownerConnectionId) {
    const conn = state.extensionConnections.get(ownerConnectionId);
    if (conn) return conn;
  }
  // Fall back to plugin tabMapping scan
  for (const conn of state.extensionConnections.values()) {
    for (const mapping of conn.tabMapping.values()) {
      if (mapping.tabs.some(t => t.tabId === tabId)) {
        return conn;
      }
    }
  }
  return undefined;
};

/** Merges all connections' tabMappings into a single unified view.
 *  When multiple connections have tabs for the same plugin, their tab arrays are merged. */
export const getMergedTabMapping = (state: ServerState): Map<string, TabMapping> => {
  const merged = new Map<string, TabMapping>();
  for (const conn of state.extensionConnections.values()) {
    for (const [pluginName, mapping] of conn.tabMapping) {
      const existing = merged.get(pluginName);
      if (existing) {
        // Merge tabs from multiple connections for the same plugin
        const mergedTabs = [...existing.tabs, ...mapping.tabs];
        // Use the "most ready" state: ready > unavailable > closed
        const bestState = pickBestTabState(existing.state, mapping.state);
        merged.set(pluginName, { state: bestState, tabs: mergedTabs });
      } else {
        merged.set(pluginName, { state: mapping.state, tabs: [...mapping.tabs] });
      }
    }
  }
  return merged;
};

/** Returns true when at least one extension connection is active */
export const isExtensionConnected = (state: ServerState): boolean => state.extensionConnections.size > 0;

/** Finds which connection a given WsHandle belongs to by identity comparison */
export const findConnectionByWs = (state: ServerState, ws: WsHandle): ExtensionConnection | undefined => {
  for (const conn of state.extensionConnections.values()) {
    if (conn.ws === ws) return conn;
  }
  return undefined;
};

/** Picks the "most ready" tab state: ready > unavailable > closed */
export const pickBestTabState = (a: TabState, b: TabState): TabState => {
  const rank: Record<TabState, number> = { ready: 2, unavailable: 1, closed: 0 };
  return rank[a] >= rank[b] ? a : b;
};
