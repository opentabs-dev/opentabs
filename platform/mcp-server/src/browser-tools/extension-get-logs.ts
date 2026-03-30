/**
 * extension_get_logs — retrieves internal logs from the Chrome extension's
 * background script and offscreen document across all connected browser profiles.
 * Combines logs from all profiles, sorted newest-first, with optional filtering
 * by level, source, and time. Each entry is annotated with its connectionId.
 */

import { z } from 'zod';
import { dispatchToAllConnections } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

interface LogEntry {
  timestamp: number;
  connectionId?: string;
  [key: string]: unknown;
}

interface LogsResult {
  entries: LogEntry[];
  stats: { totalBackground: number; totalOffscreen: number; bufferSize: number };
}

const extensionGetLogs = defineBrowserTool({
  name: 'extension_get_logs',
  description:
    'Retrieve internal logs from the OpenTabs Chrome extension (background script and offscreen document) across all connected browser profiles. ' +
    'Returns log entries merged from all profiles, sorted newest-first, with each entry annotated with its connectionId. ' +
    'Use this to see error messages, WebSocket events, and plugin injection warnings without opening DevTools.',
  summary: 'Get extension internal logs (all profiles)',
  icon: 'scroll-text',
  group: 'Extension',
  input: z.object({
    level: z
      .enum(['log', 'warn', 'error', 'info', 'all'])
      .optional()
      .describe('Filter by log level. Defaults to all levels.'),
    source: z
      .enum(['background', 'offscreen', 'all'])
      .optional()
      .describe('Filter by source context. Defaults to all sources.'),
    limit: z.number().int().positive().optional().describe('Maximum number of entries to return. Defaults to 100.'),
    since: z.number().optional().describe('Only return entries with timestamp >= this value (ms since epoch).'),
  }),
  handler: async (args, state) => {
    const params: Record<string, unknown> = {};
    if (args.level !== undefined && args.level !== 'all') params.level = args.level;
    if (args.source !== undefined && args.source !== 'all') params.source = args.source;
    if (args.limit !== undefined) params.limit = args.limit;
    if (args.since !== undefined) params.since = args.since;

    const results = await dispatchToAllConnections(state, 'extension.getLogs', params);

    const mergedEntries: LogEntry[] = [];
    let totalBackground = 0;
    let totalOffscreen = 0;
    let bufferSize = 0;

    for (const r of results) {
      const data = r.result as LogsResult;
      if (data?.entries) {
        for (const entry of data.entries) {
          mergedEntries.push({ ...entry, connectionId: r.connectionId });
        }
      }
      if (data?.stats) {
        totalBackground += data.stats.totalBackground;
        totalOffscreen += data.stats.totalOffscreen;
        bufferSize += data.stats.bufferSize;
      }
    }

    mergedEntries.sort((a, b) => b.timestamp - a.timestamp);

    return {
      entries: mergedEntries,
      stats: { totalBackground, totalOffscreen, bufferSize },
    };
  },
});

export { extensionGetLogs };
