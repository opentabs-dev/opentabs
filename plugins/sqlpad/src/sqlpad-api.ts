import {
  type FetchFromPageOptions,
  ToolError,
  buildQueryString,
  fetchJSON,
  fetchText,
  sleep,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

let cachedAuth: { userId: string } | null = null;

export const clearAuth = (): void => {
  cachedAuth = null;
};

export const isAuthenticated = (): boolean => {
  // On first load, we don't have cached auth yet — isReady() will poll via waitForAuth
  return cachedAuth !== null;
};

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(
      async () => {
        try {
          const data = await fetchJSON<{ currentUser?: { id?: string } }>('/api/app');
          if (data?.currentUser?.id) {
            cachedAuth = { userId: data.currentUser.id };
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },
      { interval: 500, timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
};

const ensureAuth = (): void => {
  if (!cachedAuth) {
    throw ToolError.auth('Not authenticated — please log in to SQLPad.');
  }
};

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  ensureAuth();

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `/api${endpoint}?${qs}` : `/api${endpoint}`;

  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  const init: FetchFromPageOptions = { method, headers };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  try {
    return (await fetchJSON<T>(url, init)) as T;
  } catch (error) {
    if (error instanceof ToolError && error.category === 'auth') {
      clearAuth();
    }
    throw error;
  }
};

export const apiText = async (endpoint: string): Promise<string> => {
  ensureAuth();
  try {
    return await fetchText(`/api${endpoint}`);
  } catch (error) {
    if (error instanceof ToolError && error.category === 'auth') {
      clearAuth();
    }
    throw error;
  }
};

// --- Query execution: 3-step batch flow ---

interface BatchResponse {
  id?: string;
  status?: string;
  statements?: StatementResponse[];
}

interface StatementResponse {
  id?: string;
  status?: string;
  error?: { message?: string; title?: string } | null;
  columns?: StatementColumn[];
  rowCount?: number;
  durationMs?: number;
  incomplete?: boolean;
  statementText?: string;
}

interface StatementColumn {
  name?: string;
  datatype?: string;
}

const POLL_INTERVAL_MS = 500;
const MAX_POLL_DURATION_MS = 300_000; // 5 minutes

export const runQuery = async (
  connectionId: string,
  queryText: string,
  maxRows: number,
  reportProgress?: (msg: string) => void,
): Promise<{
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
  truncated: boolean;
}> => {
  ensureAuth();

  // Step 1: Submit batch
  reportProgress?.('Submitting query...');
  const batch = await api<BatchResponse>('/batches', {
    method: 'POST',
    body: {
      connectionId,
      batchText: queryText,
      selectedText: queryText,
    },
  });

  if (!batch.id) {
    throw ToolError.internal('Failed to submit query batch — no batch ID returned.');
  }

  // Step 2: Poll until finished or error
  reportProgress?.('Executing query...');
  let result: BatchResponse | null = null;
  const start = Date.now();

  while (Date.now() - start < MAX_POLL_DURATION_MS) {
    result = await api<BatchResponse>(`/batches/${batch.id}`);
    if (result.status === 'finished' || result.status === 'error') break;
    await sleep(POLL_INTERVAL_MS);
  }

  if (!result || (result.status !== 'finished' && result.status !== 'error')) {
    throw ToolError.timeout('Query timed out after 5 minutes.');
  }

  const statement = result.statements?.[0];
  if (!statement) {
    throw ToolError.internal('No statement found in batch response.');
  }

  if (statement.status === 'error' || statement.error) {
    const errorMsg = statement.error?.message ?? statement.error?.title ?? 'Unknown query error';
    throw ToolError.validation(errorMsg);
  }

  if (!statement.id) {
    throw ToolError.internal('Statement has no ID.');
  }

  // Step 3: Fetch results (raw 2D array)
  reportProgress?.('Fetching results...');
  const rawText = await apiText(`/statements/${statement.id}/results`);
  const rawRows: unknown[][] = JSON.parse(rawText);

  const columns = (statement.columns ?? []).map(c => ({
    name: c.name ?? '',
    type: c.datatype ?? 'string',
  }));

  // Transform raw arrays into objects keyed by column name
  const truncated = rawRows.length > maxRows;
  const limitedRows = rawRows.slice(0, maxRows);

  const rows = limitedRows.map(row => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col) {
        obj[col.name] = row[i] ?? null;
      }
    }
    return obj;
  });

  return {
    columns,
    rows,
    rowCount: rawRows.length,
    executionTimeMs: statement.durationMs ?? 0,
    truncated,
  };
};
