import {
  querySuccess,
  hasMultipleChunks,
  getChunkCount,
  getChunkMetadatas,
  getTotalRows,
  getQueryId,
  extractColumns,
  parseFirstChunkRows,
  parseExecutionInfo,
} from './format.js';
import { createFileSession, appendToFile } from '../../file-store.js';
import { sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ToolResult } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Multi-chunk result handling
// ---------------------------------------------------------------------------

/**
 * Fetch a single result chunk from Snowflake via the adapter's fetchChunk action.
 * Returns raw row arrays (e.g. [["val1","val2"],...]).
 */
const fetchChunk = async (queryId: string, chunkIndex: number): Promise<unknown[][]> => {
  const result = await sendServiceRequest('snowflake', { queryId, chunkIndex }, 'fetchChunk');

  if (Array.isArray(result)) {
    return result as unknown[][];
  }

  // Fallback: if the data arrives as a JSON string
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) return parsed as unknown[][];
    } catch {
      /* fall through */
    }
  }

  return [];
};

/**
 * Convert raw row arrays to JSONL text using column names.
 */
const rowsToJsonl = (rawRows: unknown[][], columnNames: string[]): string => {
  const lines = rawRows.map(row => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columnNames.length && i < row.length; i++) {
      obj[columnNames[i]] = row[i];
    }
    return JSON.stringify(obj);
  });
  return lines.join('\n') + '\n';
};

/**
 * Fetch all chunks of a query result and write them to a JSONL file
 * using the generic file store.
 */
const fetchAllChunksToFile = async (raw: unknown): Promise<ToolResult> => {
  const queryId = getQueryId(raw);
  if (!queryId) throw new Error('Missing queryId in query result');

  const columns = extractColumns(raw);
  const columnNames = columns.map(c => c.name);
  const chunkCount = getChunkCount(raw);
  const totalRows = getTotalRows(raw);
  const executionInfo = parseExecutionInfo(raw);

  // Write first chunk to a new file
  const firstChunkRawRows = parseFirstChunkRows(raw);
  const firstChunkJsonl = rowsToJsonl(firstChunkRawRows, columnNames);
  const session = await createFileSession(queryId, 'jsonl', firstChunkJsonl);

  let fetchedRows = firstChunkRawRows.length;
  const chunkRowCounts = [firstChunkRawRows.length];

  // Fetch remaining chunks sequentially and append to the file
  for (let i = 1; i < chunkCount; i++) {
    const chunkRawRows = await fetchChunk(queryId, i);
    if (chunkRawRows.length > 0) {
      const chunkJsonl = rowsToJsonl(chunkRawRows, columnNames);
      await appendToFile(session.fileId, chunkJsonl);
    }
    chunkRowCounts.push(chunkRawRows.length);
    fetchedRows += chunkRawRows.length;
  }

  const expectedChunkMetadatas = getChunkMetadatas(raw);

  const response: Record<string, unknown> = {
    queryId,
    columns,
    rowCount: fetchedRows,
    totalRows: totalRows ?? fetchedRows,
    chunkCount,
    filePath: session.filePath,
    fileFormat: 'jsonl',
    ...executionInfo,
    message:
      `Query returned ${fetchedRows} rows across ${chunkCount} chunks. ` +
      `All results written to ${session.filePath}. ` +
      `Use the Read tool with offset/limit to read specific sections of the file.`,
  };

  if (totalRows !== undefined && fetchedRows < totalRows) {
    response.chunkDetails = chunkRowCounts.map((count, i) => ({
      chunk: i,
      fetchedRows: count,
      expectedRows: expectedChunkMetadatas[i]?.rowCount,
    }));
    response.note =
      `Only ${fetchedRows} of ${totalRows} expected rows were fetched. ` +
      `This may indicate a chunk transfer issue. Try re-running the query.`;
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
  };
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export const registerSnowflakeQueryTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  defineTool(
    tools,
    server,
    'snowflake_run_query',
    {
      description: `Execute a SQL query in Snowflake via the web application's session.

Runs the query using the user's current role and warehouse. Returns parsed results with:
- columns: [{name, type, nullable}]
- rows: [{COLUMN_NAME: "value", ...}] — all values are strings, including numbers and timestamps
- execution: {status, sql, durationMs, warehouse, error, stats: {compilationTimeMs, executionTimeMs, scanBytes, producedRows}}

Supports all SQL statements: SELECT, SHOW, DESCRIBE, INSERT, CREATE, etc.

Example queries:
- "SELECT * FROM my_db.my_schema.my_table LIMIT 10"
- "SHOW DATABASES"
- "SHOW SCHEMAS IN DATABASE my_db"
- "SHOW TABLES IN SCHEMA my_db.my_schema"
- "DESCRIBE TABLE my_db.my_schema.my_table"

Response format depends on result size:
- **Small results** (single chunk, typically <~10K rows): rows returned inline in the response as named objects.
- **Large results** (multiple chunks): all rows are automatically fetched across all chunks and written to a local JSONL file. The response includes filePath, rowCount, and columns instead of rows. Use the Read tool with offset/limit to read specific sections of the file.

Handles up to ~1M rows. Add LIMIT clauses for very large tables.`,
      inputSchema: {
        query: z.string().describe('SQL query to execute'),
        warehouse: z.string().optional().describe('Warehouse to use (uses session default if not specified)'),
        role: z.string().optional().describe('Role to use (uses session default if not specified)'),
        database: z.string().optional().describe('Database context for the query'),
        schema: z.string().optional().describe('Schema context for the query'),
      },
    },
    async ({ query, warehouse, role, database, schema }) => {
      const body: Record<string, unknown> = {
        sqlText: query,
        asyncExec: false,
        sequenceId: 0,
        querySubmissionTime: Date.now(),
      };

      if (warehouse) body.warehouse = warehouse;
      if (role) body.role = role;
      if (database) body.database = database;
      if (schema) body.schema = schema;

      const result = await sendServiceRequest('snowflake', {
        endpoint: '/v1/queries',
        method: 'POST',
        body,
      });

      if (hasMultipleChunks(result)) {
        return fetchAllChunksToFile(result);
      }

      return querySuccess(result);
    },
  );

  defineTool(
    tools,
    server,
    'snowflake_get_query',
    {
      description: `Get the status and results of a previously executed Snowflake query by its query ID.

Use this when you have a queryId from a prior snowflake_run_query call and need to re-fetch results.
Returns the same parsed format as snowflake_run_query: columns, rows (as named objects), and execution stats.`,
      inputSchema: {
        queryId: z.string().describe('Query ID returned from snowflake_run_query'),
      },
    },
    async ({ queryId }) => {
      const result = await sendServiceRequest('snowflake', {
        endpoint: `/v1/queries/${queryId}`,
        method: 'GET',
      });

      if (hasMultipleChunks(result)) {
        return fetchAllChunksToFile(result);
      }

      return querySuccess(result);
    },
  );

  defineTool(
    tools,
    server,
    'snowflake_monitor_queries',
    {
      description: `Monitor currently running queries in Snowflake.

Returns a list of active queries with: queryId, state, sql, user, warehouse, durationMs, startTime.
Useful for checking if a long-running query is still executing or finding queries to investigate.`,
      inputSchema: {},
    },
    async () => {
      const raw = await sendServiceRequest('snowflake', {
        endpoint: '/v1/queries/monitoring',
        method: 'GET',
      });

      const data = raw as { queries?: unknown[] } | undefined;
      const queries = (data?.queries ?? (Array.isArray(raw) ? raw : [])) as Record<string, unknown>[];

      const cleaned = queries.map(q => ({
        queryId: q.id ?? q.queryId,
        state: q.state ?? q.status,
        sql: q.sqlText ?? q.queryText,
        user: q.userName ?? q.user,
        warehouse: q.warehouseName ?? q.warehouse,
        durationMs: q.totalDuration ?? q.duration,
        startTime: q.startTime,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ queries: cleaned, count: cleaned.length }, null, 2) }],
      };
    },
  );

  return tools;
};
