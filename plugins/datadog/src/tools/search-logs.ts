import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { searchLogsInternal } from '../datadog-api.js';
import { logEntrySchema } from './schemas.js';

export const searchLogs = defineTool({
  name: 'search_logs',
  displayName: 'Search Logs',
  description:
    'Search Datadog logs using query syntax. Supports filtering by service, host, status, tags, and free text. Uses the Datadog log query language (e.g., "service:my-app status:error", "@http.status_code:500").',
  summary: 'Search logs with Datadog query syntax',
  icon: 'file-text',
  group: 'Logs',
  input: z.object({
    query: z.string().describe('Log search query (e.g., "service:my-app status:error", "@http.url:/api/v1/*")'),
    from: z
      .string()
      .optional()
      .describe('Start time — relative (e.g., "now-1h", "now-15m") or epoch ms. Default: now-15m'),
    to: z.string().optional().describe('End time — relative (e.g., "now") or epoch ms. Default: now'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum log entries (default 25, max 100)'),
    sort: z.enum(['asc', 'desc']).optional().describe('Sort order by timestamp (default desc)'),
  }),
  output: z.object({
    logs: z.array(logEntrySchema),
    total: z.number().describe('Total matching log entries'),
  }),
  handle: async params => {
    const now = Date.now();
    const fromMs = resolveTime(params.from ?? 'now-15m', now);
    const toMs = resolveTime(params.to ?? 'now', now);

    const data = await searchLogsInternal<{
      result?: {
        events?: Array<{
          id?: string;
          columns?: unknown[];
          event?: Record<string, unknown>;
        }>;
      };
      hitCount?: number;
    }>({
      list: {
        columns: [
          { field: { path: 'status' } },
          { field: { path: 'timestamp' } },
          { field: { path: 'host' } },
          { field: { path: 'service' } },
          { field: { path: 'content', column_type: 'message' } },
        ],
        sort: { time: { order: params.sort ?? 'desc' } },
        limit: params.limit ?? 25,
        time: { from: fromMs, to: toMs },
        search: { query: params.query },
        indexes: ['*'],
      },
    });

    const events = data.result?.events ?? [];
    // Columns are ordered: [status, timestamp, host, service, message]
    const logs = events.map(e => {
      const cols = e.columns ?? [];
      return {
        id: e.id ?? '',
        timestamp: (cols[1] as string) ?? '',
        status: (cols[0] as string) ?? '',
        service: (cols[3] as string) ?? '',
        host: (cols[2] as string) ?? '',
        message: (cols[4] as string) ?? '',
        tags: (e.event?.tags as string[]) ?? [],
      };
    });

    return { logs, total: data.hitCount ?? logs.length };
  },
});

function resolveTime(value: string, now: number): number {
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^now(-(\d+)(m|h|d|w))?$/);
  if (!match) return now;
  if (!match[1]) return now;
  const amount = Number(match[2]);
  const unit = match[3];
  const ms = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : unit === 'd' ? 86_400_000 : 604_800_000;
  return now - amount * ms;
}
