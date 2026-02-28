/**
 * `opentabs audit` command — shows recent tool invocation history.
 *
 * By default, queries the running MCP server's in-memory audit buffer.
 * With --file, reads from the persistent disk log (~/.opentabs/audit.log)
 * for post-restart forensics.
 */

import { isTimeout } from './status.js';
import { getConfigDir, isConnectionRefused, readAuthSecret } from '../config.js';
import { resolvePort } from '../parse-port.js';
import { toErrorMessage } from '@opentabs-dev/shared';
import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { access, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';

interface AuditOptions {
  port?: number;
  limit?: number;
  plugin?: string;
  tool?: string;
  since?: string;
  json?: boolean;
  file?: boolean;
}

interface AuditEntry {
  timestamp: string;
  tool: string;
  plugin: string;
  success: boolean;
  durationMs: number;
  error?: { code: string; message: string; category?: string };
}

const parseLimit = (value: string): number => {
  const parsedCount = Number(value);
  if (!Number.isInteger(parsedCount) || parsedCount < 1) {
    throw new InvalidArgumentError('Must be a positive integer.');
  }
  return parsedCount;
};

const DURATION_UNITS = new Map<string, number>([
  ['s', 1_000],
  ['m', 60_000],
  ['h', 3_600_000],
  ['d', 86_400_000],
]);

const parseDuration = (value: string): number | null => {
  const match = /^(\d+)([smhd])$/.exec(value);
  const unit = match?.[2] ? DURATION_UNITS.get(match[2]) : undefined;
  if (!match?.[1] || unit === undefined) {
    return null;
  }
  return Number(match[1]) * unit;
};

const formatTimestamp = (iso: string): string => {
  const date = new Date(iso);
  const now = new Date();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const time = `${hours}:${minutes}:${seconds}`;

  // Same day — show time only
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return time;
  }

  // Different day — include date
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day} ${time}`;
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const COL_TIME = 15;
const COL_TOOL_MIN = 'Tool'.length;
const COL_STATUS = 4;
const COL_DURATION = 10;

const printAuditTable = (entries: AuditEntry[]): void => {
  const maxToolLen = entries.reduce((max, e) => Math.max(max, e.tool.length), 0);
  const colTool = Math.max(COL_TOOL_MIN, maxToolLen) + 2;

  console.log(
    pc.bold(
      `${'Time'.padEnd(COL_TIME)}${'Tool'.padEnd(colTool)}${''.padEnd(COL_STATUS)}${'Duration'.padEnd(COL_DURATION)}`,
    ),
  );
  console.log(pc.dim('─'.repeat(COL_TIME + colTool + COL_STATUS + COL_DURATION)));

  for (const entry of entries) {
    const time = formatTimestamp(entry.timestamp).padEnd(COL_TIME);
    const tool = entry.tool.padEnd(colTool);
    // Pad the plain-text icon to the column width, then colorize.
    // Colorizing after padding ensures ANSI escape codes don't affect alignment.
    const icon = entry.success ? '✓' : '✗';
    const paddedStatus = icon.padEnd(COL_STATUS);
    const status = entry.success ? pc.green(paddedStatus) : pc.red(paddedStatus);
    const duration = formatDuration(entry.durationMs).padEnd(COL_DURATION);
    console.log(`${time}${tool}${status}${duration}`);
  }
};

/**
 * Read audit entries from the persistent disk log (~/.opentabs/audit.log).
 * Parses NDJSON (one JSON object per line), applies the same filters as the server mode.
 */
const handleAuditFromFile = async (options: AuditOptions): Promise<void> => {
  const limit = options.limit ?? 20;
  const auditPath = join(getConfigDir(), 'audit.log');

  let sinceMs: number | null = null;
  if (options.since) {
    sinceMs = parseDuration(options.since);
    if (sinceMs === null) {
      console.error(
        pc.red(
          `Invalid --since value: '${options.since}'. Must be a number followed by s, m, h, or d (e.g., 30m, 1h, 2d).`,
        ),
      );
      process.exit(1);
    }
  }

  if (
    !(await access(auditPath).then(
      () => true,
      () => false,
    ))
  ) {
    console.log(pc.dim('No audit log file found at ' + auditPath));
    return;
  }

  const MAX_AUDIT_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const fileSize = (await stat(auditPath)).size;
  if (fileSize > MAX_AUDIT_FILE_SIZE) {
    console.error(
      pc.red(
        `Audit log file is too large (${(fileSize / 1024 / 1024).toFixed(1)}MB, limit ${MAX_AUDIT_FILE_SIZE / 1024 / 1024}MB). ` +
          'Consider rotating or truncating ' +
          auditPath,
      ),
    );
    return;
  }

  const raw = await readFile(auditPath, 'utf-8');
  const lines = raw.split('\n').filter(line => line.trim().length > 0);

  let entries: AuditEntry[] = [];
  let skippedCount = 0;
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      skippedCount++;
    }
  }

  // Reverse to show newest first (matching server behavior)
  entries.reverse();

  // Apply filters
  if (options.plugin) entries = entries.filter(e => e.plugin === options.plugin);
  if (options.tool) entries = entries.filter(e => e.tool === options.tool);
  if (sinceMs !== null) {
    const cutoff = Date.now() - sinceMs;
    entries = entries.filter(e => new Date(e.timestamp).getTime() >= cutoff);
  }

  entries = entries.slice(0, limit);

  if (options.json) {
    console.log(JSON.stringify(entries, null, 2));
  } else if (entries.length === 0) {
    const hasFilters = options.plugin || options.tool || options.since;
    if (hasFilters) {
      console.log(pc.dim('No entries match the current filters. Try broadening the search.'));
    } else {
      console.log(pc.dim('No audit entries found. Invoke tools through an MCP client to generate audit entries.'));
    }
  } else {
    printAuditTable(entries);
  }

  if (skippedCount > 0) {
    console.log(
      pc.dim(`Note: ${skippedCount} malformed log ${skippedCount === 1 ? 'entry was' : 'entries were'} skipped.`),
    );
  }
};

const handleAudit = async (options: AuditOptions): Promise<void> => {
  // --file mode reads from disk log instead of the running server
  if (options.file) {
    return handleAuditFromFile(options);
  }

  const port = resolvePort(options);
  const limit = options.limit ?? 20;

  // Parse --since duration (client-side filtering)
  let sinceMs: number | null = null;
  if (options.since) {
    sinceMs = parseDuration(options.since);
    if (sinceMs === null) {
      console.error(
        pc.red(
          `Invalid --since value: '${options.since}'. Must be a number followed by s, m, h, or d (e.g., 30m, 1h, 2d).`,
        ),
      );
      process.exit(1);
    }
  }

  const secret = await readAuthSecret();

  // Build URL — request more entries from the server when --since is used
  // so we have enough to filter from
  const url = new URL(`http://localhost:${port}/audit`);
  url.searchParams.set('limit', String(sinceMs !== null ? 500 : limit));
  if (options.plugin) url.searchParams.set('plugin', options.plugin);
  if (options.tool) url.searchParams.set('tool', options.tool);

  try {
    const headers: Record<string, string> = {};
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(3_000),
    });

    if (res.status === 401) {
      console.error(pc.red('Authentication failed.'));
      console.error(pc.dim('Is the server secret correct? Check ~/.opentabs/extension/auth.json'));
      process.exit(1);
    }

    if (!res.ok) {
      console.error(pc.red(`Error: MCP server returned HTTP ${res.status}.`));
      process.exit(1);
    }

    let entries = (await res.json()) as AuditEntry[];

    // Client-side time filtering
    if (sinceMs !== null) {
      const cutoff = Date.now() - sinceMs;
      entries = entries.filter(e => new Date(e.timestamp).getTime() >= cutoff);
    }

    entries = entries.slice(0, limit);

    if (options.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }

    if (entries.length === 0) {
      const hasFilters = options.plugin || options.tool || options.since;
      if (hasFilters) {
        console.log(pc.dim('No entries match the current filters. Try broadening the search.'));
      } else {
        console.log(pc.dim('No audit entries found. Invoke tools through an MCP client to generate audit entries.'));
      }
      return;
    }

    printAuditTable(entries);
  } catch (err: unknown) {
    const startHint = `Start it with: opentabs start${port !== 9515 ? ` --port ${port}` : ''}`;

    if (isConnectionRefused(err)) {
      console.error(pc.red('MCP server is not running.'));
      console.error(pc.dim(startHint));
    } else if (isTimeout(err)) {
      console.error(pc.red('Server not responding (timed out). Is the server running?'));
      console.error(pc.dim(`The server at port ${port} did not respond in time.`));
    } else {
      const message = toErrorMessage(err);
      console.error(pc.red(`Error: ${message}`));
      console.error(pc.dim(startHint));
    }

    process.exit(1);
  }
};

const registerAuditCommand = (program: Command): void => {
  program
    .command('audit')
    .description('Show recent tool invocation history')
    .option('--limit <number>', 'Number of entries to show (default: 20)', parseLimit)
    .option('--plugin <name>', 'Filter by plugin name')
    .option('--tool <name>', 'Filter by tool name')
    .option('--since <duration>', 'Show entries from the last duration (e.g., 30m, 1h, 2d)')
    .option('--json', 'Output raw JSON from the audit endpoint')
    .option('--file', 'Read from persistent disk log (~/.opentabs/audit.log) instead of the running server')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs audit
  $ opentabs audit --limit 50
  $ opentabs audit --plugin slack
  $ opentabs audit --tool slack_send_message
  $ opentabs audit --since 1h
  $ opentabs audit --since 30m --plugin slack
  $ opentabs audit --json
  $ opentabs audit --file
  $ opentabs audit --file --since 1h --plugin slack`,
    )
    .action((_options: AuditOptions, command: Command) => handleAudit(command.optsWithGlobals()));
};

export { registerAuditCommand, parseDuration, formatTimestamp, formatDuration, parseLimit };
