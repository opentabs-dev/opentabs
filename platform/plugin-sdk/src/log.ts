// ---------------------------------------------------------------------------
// Structured logging API for plugin authors
// ---------------------------------------------------------------------------

/** Log levels matching the MCP LoggingLevel enum */
type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/** A single structured log entry */
interface LogEntry {
  level: LogLevel;
  message: string;
  data: unknown[];
  ts: string;
}

/** Transport function signature — receives a log entry for delivery */
type LogTransport = (entry: LogEntry) => void;

// ---------------------------------------------------------------------------
// Safe serialization — entries travel over postMessage / WebSocket
// ---------------------------------------------------------------------------

const MAX_DATA_LENGTH = 10;
const MAX_STRING_LENGTH = 4096;

/**
 * Produces a JSON-safe representation of a single argument.
 * Handles circular references, DOM nodes, functions, and other
 * non-serializable values without throwing.
 */
const safeSerializeArg = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === 'boolean' || type === 'number') return value;

  if (type === 'string') {
    return (value as string).length > MAX_STRING_LENGTH ? (value as string).slice(0, MAX_STRING_LENGTH) + '…' : value;
  }

  if (type === 'function') return `[Function: ${(value as { name?: string }).name || 'anonymous'}]`;
  if (type === 'symbol') return `[Symbol: ${(value as symbol).description ?? ''}]`;
  if (type === 'bigint') return `[BigInt: ${(value as bigint).toString()}]`;

  // DOM nodes
  if (typeof (value as { nodeType?: unknown }).nodeType === 'number') {
    const node = value as { nodeName?: string; id?: string; className?: string };
    const className = node.className ? `.${node.className.split(' ')[0] ?? ''}` : '';
    return `[${node.nodeName ?? 'Node'}${node.id ? `#${node.id}` : ''}${className}]`;
  }

  // Errors
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  // Fallback: attempt JSON round-trip to strip non-serializable properties
  try {
    const seen = new WeakSet();
    const json = JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      if (typeof v === 'function') return `[Function: ${(v as { name?: string }).name || 'anonymous'}]`;
      if (typeof v === 'bigint') return `[BigInt: ${v.toString()}]`;
      if (typeof v === 'symbol') return `[Symbol: ${v.description ?? ''}]`;
      return v;
    });
    return JSON.parse(json) as unknown;
  } catch {
    return `[Unserializable: ${typeof value}]`;
  }
};

/**
 * Safely serializes an array of log arguments into a postMessage/JSON-safe form.
 * Truncates to MAX_DATA_LENGTH items.
 */
const safeSerialize = (args: unknown[]): unknown[] => {
  const capped = args.length > MAX_DATA_LENGTH ? args.slice(0, MAX_DATA_LENGTH) : args;
  return capped.map(safeSerializeArg);
};

// ---------------------------------------------------------------------------
// Default transport — console fallback
// ---------------------------------------------------------------------------

const CONSOLE_METHODS: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error',
};

const defaultTransport: LogTransport = (entry: LogEntry) => {
  const method = CONSOLE_METHODS[entry.level];
  console[method](`[sdk.log] ${entry.message}`, ...entry.data);
};

// ---------------------------------------------------------------------------
// Transport slot — replaced by the adapter runtime (US-002)
// ---------------------------------------------------------------------------

let activeTransport: LogTransport = defaultTransport;

/**
 * @internal
 * Replaces the active log transport. Called by the adapter IIFE wrapper to
 * route log entries to the Chrome extension instead of the console.
 * Returns a function that restores the default transport.
 */
const _setLogTransport = (transport: LogTransport): (() => void) => {
  const previous = activeTransport;
  activeTransport = transport;
  return () => {
    if (activeTransport === transport) activeTransport = previous;
  };
};

// ---------------------------------------------------------------------------
// Public API — sdk.log namespace
// ---------------------------------------------------------------------------

const makeLogMethod =
  (level: LogLevel) =>
  (message: string, ...args: unknown[]): void => {
    const entry: LogEntry = {
      level,
      message,
      data: safeSerialize(args),
      ts: new Date().toISOString(),
    };
    activeTransport(entry);
  };

/**
 * Structured logging namespace for plugin tool handlers and lifecycle hooks.
 *
 * Log entries are routed to the MCP server when running inside the adapter
 * runtime, or to the browser console when running standalone (unit tests, etc.).
 *
 * @example
 * ```ts
 * import { log } from '@opentabs-dev/plugin-sdk';
 *
 * log.info('Fetching channels', { workspaceId });
 * log.error('Request failed', error);
 * ```
 */
const log = Object.freeze({
  debug: makeLogMethod('debug'),
  info: makeLogMethod('info'),
  warn: makeLogMethod('warning'),
  error: makeLogMethod('error'),
});

// ---------------------------------------------------------------------------
// Runtime registration — allows the adapter IIFE wrapper to call
// _setLogTransport without an explicit import (which would fail if the
// plugin's installed SDK version predates the log module).
// ---------------------------------------------------------------------------

const ot = ((globalThis as Record<string, unknown>).__openTabs ?? {}) as Record<string, unknown>;
(globalThis as Record<string, unknown>).__openTabs = ot;
ot._setLogTransport = _setLogTransport;
ot.log = log;

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { _setLogTransport, log };
export type { LogEntry, LogLevel, LogTransport };
