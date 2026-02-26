/**
 * Per-plugin circular log buffer.
 *
 * Stores the most recent log entries from plugin adapters, keyed by plugin name.
 * Each plugin gets its own fixed-size ring buffer that overwrites oldest entries
 * when full. The buffer is used for:
 *   1. Forwarding log entries to MCP clients via sendLoggingMessage
 *   2. Surfacing log counts in the /health endpoint
 */

/** Maximum log entries retained per plugin */
const MAX_ENTRIES_PER_PLUGIN = 1000;

/** A single buffered plugin log entry */
interface PluginLogEntry {
  level: string;
  plugin: string;
  message: string;
  data: unknown;
  ts: string;
}

/** Fixed-size ring buffer for log entries */
interface RingBuffer {
  entries: Array<PluginLogEntry | undefined>;
  writeIndex: number;
  size: number;
}

const createRingBuffer = (): RingBuffer => ({
  entries: new Array<PluginLogEntry | undefined>(MAX_ENTRIES_PER_PLUGIN).fill(undefined),
  writeIndex: 0,
  size: 0,
});

/** globalThis key for persisting log buffers across bun --hot reloads */
const BUFFERS_KEY = '__opentabs_log_buffers__' as const;

/** Per-plugin ring buffers — stored on globalThis so they survive bun --hot module re-evaluation */
const getBuffers = (): Map<string, RingBuffer> => {
  const g = globalThis as Record<string, unknown>;
  let map = g[BUFFERS_KEY] as Map<string, RingBuffer> | undefined;
  if (!map) {
    map = new Map<string, RingBuffer>();
    g[BUFFERS_KEY] = map;
  }
  return map;
};

/** Append a log entry to a plugin's ring buffer */
const appendLog = (plugin: string, entry: PluginLogEntry): void => {
  const buffers = getBuffers();
  let ring = buffers.get(plugin);
  if (!ring) {
    ring = createRingBuffer();
    buffers.set(plugin, ring);
  }

  ring.entries[ring.writeIndex] = entry;
  ring.writeIndex = (ring.writeIndex + 1) % MAX_ENTRIES_PER_PLUGIN;
  if (ring.size < MAX_ENTRIES_PER_PLUGIN) {
    ring.size++;
  }
};

/**
 * Retrieve recent log entries for a plugin, oldest first.
 * Returns at most `limit` entries (defaults to all buffered entries).
 */
const getLogs = (plugin: string, limit?: number): PluginLogEntry[] => {
  const ring = getBuffers().get(plugin);
  if (!ring || ring.size === 0) return [];

  const cap = limit !== undefined && limit < ring.size ? limit : ring.size;
  const result: PluginLogEntry[] = [];

  // Read from oldest to newest. When the buffer has wrapped, oldest is at writeIndex.
  const startIndex = ring.size < MAX_ENTRIES_PER_PLUGIN ? 0 : ring.writeIndex;
  const skip = ring.size - cap;

  for (let i = 0; i < ring.size; i++) {
    if (i < skip) continue;
    const idx = (startIndex + i) % MAX_ENTRIES_PER_PLUGIN;
    const entry = ring.entries[idx];
    if (entry) result.push(entry);
  }

  return result;
};

/** Get the number of buffered entries for a plugin */
const getLogCount = (plugin: string): number => getBuffers().get(plugin)?.size ?? 0;

/** Get all plugin names that have buffered entries */
const getBufferedPlugins = (): string[] => Array.from(getBuffers().keys());

/** Remove log buffers for plugins not in the active set */
const pruneStaleBuffers = (activePlugins: Set<string>): void => {
  const buffers = getBuffers();
  for (const pluginName of buffers.keys()) {
    if (!activePlugins.has(pluginName)) {
      buffers.delete(pluginName);
    }
  }
};

/** Clear all buffered entries (used during testing or state reset) */
const clearAllLogs = (): void => {
  getBuffers().clear();
};

export { appendLog, clearAllLogs, getBufferedPlugins, getLogCount, getLogs, pruneStaleBuffers };
export type { PluginLogEntry };
