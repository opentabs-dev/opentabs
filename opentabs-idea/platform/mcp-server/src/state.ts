/**
 * In-memory state for the MCP server.
 * Tracks plugins, tab-to-plugin mapping, tool config, and pending dispatches.
 */

/** Tab state for a plugin */
export type TabState = "closed" | "unavailable" | "ready";

/** Trust tier for a plugin */
export type TrustTier = "official" | "community" | "local";

/** Tool definition from a plugin manifest */
export interface PluginToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
}

/** Plugin registered in the server */
export interface RegisteredPlugin {
  name: string;
  version: string;
  displayName?: string;
  urlPatterns: string[];
  trustTier: TrustTier;
  iife: string;
  tools: PluginToolDef[];
  /** Filesystem path for local plugins (used for file watching) */
  sourcePath?: string;
  /** Original npm package name (e.g., 'opentabs-plugin-slack') — only for npm-installed plugins */
  npmPackageName?: string;
}

/** Tab mapping entry for a plugin */
export interface TabMapping {
  state: TabState;
  tabId: number | null;
  url: string | null;
}

/** Pending tool dispatch awaiting extension response */
export interface PendingDispatch {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  plugin: string;
  tool: string;
  startTs: number;
}

/** Tool config: maps prefixed tool name → enabled boolean */
export type ToolConfig = Record<string, boolean>;

/** Info about an outdated npm plugin */
export interface OutdatedPlugin {
  name: string;
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
}

/** Server state singleton — reset on hot reload */
export interface ServerState {
  /** All registered plugins (from discovery) */
  plugins: Map<string, RegisteredPlugin>;
  /** Tab-to-plugin mapping from extension */
  tabMapping: Map<string, TabMapping>;
  /** Tool enabled/disabled config (in-memory, synced from ~/.opentabs/config.json) */
  toolConfig: ToolConfig;
  /** Local plugin paths from config */
  pluginPaths: string[];
  /** Pending tool dispatches keyed by JSON-RPC id */
  pendingDispatches: Map<string | number, PendingDispatch>;
  /** Extension WebSocket connection (single connection) */
  extensionWs: { send: (data: string) => void } | null;
  /** JSON-RPC id counter for server→extension requests */
  nextRequestId: number;
  /** Outdated npm plugins detected on startup */
  outdatedPlugins: OutdatedPlugin[];
}

export const createState = (): ServerState => ({
  plugins: new Map(),
  tabMapping: new Map(),
  toolConfig: {},
  pluginPaths: [],
  pendingDispatches: new Map(),
  extensionWs: null,
  nextRequestId: 1,
  outdatedPlugins: [],
});

/** Get the prefixed tool name: plugin_tool */
export const prefixedToolName = (plugin: string, tool: string): string =>
  `${plugin}_${tool}`;

/** Check if a tool is enabled in config */
export const isToolEnabled = (state: ServerState, prefixedName: string): boolean =>
  state.toolConfig[prefixedName] === true;
