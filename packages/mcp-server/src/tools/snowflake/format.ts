import type { ToolResult } from '../../utils.js';

// ---------------------------------------------------------------------------
// Snowflake query result types
// ---------------------------------------------------------------------------

interface ColumnMetadata {
  name: string;
  typeName: string;
  nullable: boolean;
  precision?: number;
  scale?: number;
  length?: number;
  base?: string;
}

interface QueryStatus {
  state: string;
  sqlText: string;
  totalDuration: number;
  errorCode: number;
  errorMessage: string | null;
  startTime: number;
  endTime: number;
  warehouseName: string;
  stats?: Record<string, unknown>;
  queryTag?: string;
}

export interface RawQueryResult {
  queryId?: string;
  result?: {
    firstChunkData?: string;
    firstChunkRowCount?: number;
    chunkFileCount?: number;
    chunkFileMetadatas?: Array<{ rowCount: number; uncompressedByteSize: number }>;
    resultColumnMetadata?: ColumnMetadata[];
    statementType?: string;
    columnCount?: number;
    totalRowCountTruncated?: boolean;
    parameters?: Record<string, unknown>;
    [key: string]: unknown;
  };
  status?: QueryStatus & Record<string, unknown>;
  [key: string]: unknown;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

// ---------------------------------------------------------------------------
// Helpers for multi-chunk processing
// ---------------------------------------------------------------------------

/**
 * Extract column definitions from a raw query result.
 */
export const extractColumns = (raw: unknown): ColumnInfo[] => {
  const data = raw as RawQueryResult;
  return (data?.result?.resultColumnMetadata ?? []).map(col => ({
    name: col.name,
    type: col.typeName ?? col.base ?? 'UNKNOWN',
    nullable: col.nullable,
  }));
};

/**
 * Zip raw row arrays with column names into named objects.
 * Raw rows are arrays of values (e.g. [["val1","val2"],...]).
 */
export const zipRowsWithColumns = (rawRows: unknown[][], columnNames: string[]): Record<string, unknown>[] =>
  rawRows.map(row => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columnNames.length && i < row.length; i++) {
      obj[columnNames[i]] = row[i];
    }
    return obj;
  });

/**
 * Check whether a query result has additional chunks beyond the first.
 */
export const hasMultipleChunks = (raw: unknown): boolean => {
  const data = raw as RawQueryResult;
  return (data?.result?.chunkFileCount ?? 1) > 1;
};

/**
 * Get the total number of chunks in a query result.
 */
export const getChunkCount = (raw: unknown): number => {
  const data = raw as RawQueryResult;
  return data?.result?.chunkFileCount ?? 1;
};

/**
 * Get per-chunk metadata (row counts and sizes).
 */
export const getChunkMetadatas = (raw: unknown): Array<{ rowCount: number; uncompressedByteSize: number }> => {
  const data = raw as RawQueryResult;
  return data?.result?.chunkFileMetadatas ?? [];
};

/**
 * Get the total number of rows produced by the query (from execution stats).
 */
export const getTotalRows = (raw: unknown): number | undefined => {
  const data = raw as RawQueryResult;
  return data?.status?.stats?.producedRows as number | undefined;
};

/**
 * Get the query ID from a raw result.
 */
export const getQueryId = (raw: unknown): string | undefined => {
  const data = raw as RawQueryResult;
  return data?.queryId;
};

/**
 * Parse firstChunkData (JSON string of row arrays) into raw row arrays.
 */
export const parseFirstChunkRows = (raw: unknown): unknown[][] => {
  const data = raw as RawQueryResult;
  if (!data?.result?.firstChunkData) return [];
  try {
    return JSON.parse(data.result.firstChunkData) as unknown[][];
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Parse raw Snowflake query responses into clean, structured output
// ---------------------------------------------------------------------------

/**
 * Parse a raw Snowflake query response into a clean, AI-friendly format.
 *
 * The raw response has:
 * - `result.firstChunkData`: a JSON *string* of row arrays (e.g. `'[["val1","val2"],...]'`)
 * - `result.resultColumnMetadata`: column definitions with positional names
 * - `result.parameters`: 40+ session config values (noise)
 * - `status`: execution details
 *
 * This function:
 * 1. Parses `firstChunkData` and zips each row array with column names into objects
 * 2. Extracts only the useful status/execution fields
 * 3. Drops session parameters and other noise
 */
export const parseQueryResult = (raw: unknown): Record<string, unknown> => {
  const data = raw as RawQueryResult;
  if (!data?.result && !data?.status) return data as Record<string, unknown>;

  const result = data.result;
  const status = data.status;

  const columns = extractColumns(raw);
  const columnNames = columns.map(c => c.name);

  // Parse firstChunkData into named objects
  const rawRows = parseFirstChunkRows(raw);
  const rows = zipRowsWithColumns(rawRows, columnNames);
  const rowCount = rows.length || (result?.firstChunkRowCount ?? 0);

  // Build clean response
  const parsed: Record<string, unknown> = {
    queryId: data.queryId,
    columns,
    rows,
    rowCount,
  };

  if (result?.totalRowCountTruncated) {
    parsed.truncated = true;
  }

  // Add clean execution stats
  if (status) {
    parsed.execution = {
      status: status.state,
      sql: status.sqlText,
      durationMs: status.totalDuration,
      warehouse: status.warehouseName,
      error: status.errorMessage,
    };

    if (status.stats) {
      const s = status.stats;
      const execStats: Record<string, unknown> = {};
      if (s.compilationTime) execStats.compilationTimeMs = s.compilationTime;
      if (s.gsExecTime) execStats.executionTimeMs = s.gsExecTime;
      if (s.scanBytes) execStats.scanBytes = s.scanBytes;
      if (s.producedRows) execStats.producedRows = s.producedRows;
      if (Object.keys(execStats).length > 0) {
        (parsed.execution as Record<string, unknown>).stats = execStats;
      }
    }
  }

  return parsed;
};

/**
 * Extract execution metadata from a raw query result (without row data).
 */
export const parseExecutionInfo = (raw: unknown): Record<string, unknown> => {
  const data = raw as RawQueryResult;
  const status = data?.status;
  const result: Record<string, unknown> = {
    queryId: data?.queryId,
  };

  if (status) {
    result.execution = {
      status: status.state,
      sql: status.sqlText,
      durationMs: status.totalDuration,
      warehouse: status.warehouseName,
      error: status.errorMessage,
    };

    if (status.stats) {
      const s = status.stats;
      const execStats: Record<string, unknown> = {};
      if (s.compilationTime) execStats.compilationTimeMs = s.compilationTime;
      if (s.gsExecTime) execStats.executionTimeMs = s.gsExecTime;
      if (s.scanBytes) execStats.scanBytes = s.scanBytes;
      if (s.producedRows) execStats.producedRows = s.producedRows;
      if (Object.keys(execStats).length > 0) {
        (result.execution as Record<string, unknown>).stats = execStats;
      }
    }
  }

  return result;
};

/**
 * Format a parsed query result into an MCP text response.
 */
export const querySuccess = (raw: unknown): ToolResult => {
  const parsed = parseQueryResult(raw);
  return {
    content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
  };
};
