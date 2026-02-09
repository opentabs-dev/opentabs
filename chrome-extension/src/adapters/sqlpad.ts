/**
 * SQLPad Adapter — MAIN world script registered by adapter-manager.ts
 *
 * Receives JSON-RPC requests from the background via chrome.scripting.executeScript
 * and returns JSON-RPC responses. Runs in the page's JS context with access to
 * session cookies.
 *
 * Supported JSON-RPC methods (second segment of method string):
 * - api       — SQLPad API (GET/POST/PUT/DELETE with session cookies)
 * - runQuery  — Submit a SQL query, poll for completion, and return results
 */

import { ok, fail, INVALID_PARAMS, METHOD_NOT_FOUND, INTERNAL_ERROR, registerAdapter } from './shared';
import type { JsonRpcRequest, JsonRpcResponse } from './shared';

// ---------------------------------------------------------------------------
// API transport
// ---------------------------------------------------------------------------

const callApi = async (
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  params?: Record<string, unknown>,
  body?: unknown,
): Promise<unknown> => {
  const baseUrl = window.location.origin;

  // Build URL with query params
  let url = `${baseUrl}${endpoint}`;
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    url += (url.includes('?') ? '&' : '?') + searchParams.toString();
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };

  if ((method === 'POST' || method === 'PUT') && body) {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SQLPad API error ${response.status}: ${errorText}`);
  }

  // Some endpoints may return empty responses
  const text = await response.text();
  if (!text) {
    return { success: true };
  }

  try {
    return JSON.parse(text);
  } catch {
    return { data: text };
  }
};

// ---------------------------------------------------------------------------
// Query execution (submit → poll → fetch results)
// ---------------------------------------------------------------------------

interface QueryColumn {
  name: string;
  datatype: string;
}

interface RunQueryResult {
  executionTimeMs: number;
  columns?: QueryColumn[];
  rowCount: number;
  rows: Record<string, unknown>[];
  truncated: boolean;
}

const runQuery = async (connectionId: string, queryText: string, maxRows: number): Promise<RunQueryResult> => {
  // Submit the query
  const batch = (await callApi('/api/batches', 'POST', undefined, {
    connectionId,
    batchText: queryText,
    selectedText: queryText,
  })) as { id: string };

  const batchId = batch.id;

  // Poll for completion (5 minute timeout)
  const maxWaitMs = 300000;
  const pollIntervalMs = 500;
  const startTime = Date.now();

  interface BatchStatement {
    id: string;
    status: string;
    error?: { message?: string; title?: string };
    columns?: QueryColumn[];
    rowCount: number;
  }
  interface BatchResult {
    status: string;
    statements?: BatchStatement[];
  }

  let finalBatch: BatchResult | null = null;
  while (Date.now() - startTime < maxWaitMs) {
    finalBatch = (await callApi(`/api/batches/${batchId}`, 'GET')) as BatchResult;

    if (finalBatch.status === 'finished' || finalBatch.status === 'error') {
      break;
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  if (!finalBatch || (finalBatch.status !== 'finished' && finalBatch.status !== 'error')) {
    throw new Error('Query timed out after 5 minutes');
  }

  const executionTimeMs = Date.now() - startTime;
  const statement = finalBatch.statements?.[0];

  if (!statement) {
    throw new Error('No query results returned');
  }

  if (statement.status === 'error' || statement.error) {
    throw new Error(statement.error?.message || statement.error?.title || 'Query execution failed');
  }

  // Fetch row data from the statement results endpoint
  let rows: Record<string, unknown>[] = [];
  if (statement.rowCount > 0) {
    const rawRows = (await callApi(`/api/statements/${statement.id}/results`, 'GET')) as unknown[][];
    const columns = statement.columns || [];
    rows = rawRows.slice(0, maxRows).map(row => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, idx) => {
        obj[col.name] = (row as unknown[])[idx];
      });
      return obj;
    });
  }

  return {
    executionTimeMs,
    columns: statement.columns,
    rowCount: statement.rowCount,
    rows,
    truncated: statement.rowCount > maxRows,
  };
};

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

const handleRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
  const { id, method, params } = request;
  const [, action] = method.split('.');

  try {
    switch (action) {
      case 'api': {
        const endpoint = params?.endpoint as string;
        if (!endpoint) return fail(id, INVALID_PARAMS, 'Missing required parameter: endpoint');

        const httpMethod = (params?.method as 'GET' | 'POST' | 'PUT' | 'DELETE') || 'GET';
        const queryParams = params?.params as Record<string, unknown> | undefined;
        const body = params?.body;
        const data = await callApi(endpoint, httpMethod, queryParams, body);
        return ok(id, data);
      }

      case 'runQuery': {
        const connectionId = params?.connectionId as string;
        const queryText = params?.query as string;
        const maxRows = (params?.maxRows as number) || 100;
        if (!connectionId) return fail(id, INVALID_PARAMS, 'Missing required parameter: connectionId');
        if (!queryText) return fail(id, INVALID_PARAMS, 'Missing required parameter: query');

        const result = await runQuery(connectionId, queryText, maxRows);
        return ok(id, result);
      }

      default:
        return fail(id, METHOD_NOT_FOUND, `Unknown action: ${action}`);
    }
  } catch (err) {
    return fail(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
  }
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerAdapter('sqlpad', handleRequest);

export {};
