import { ToolError, fetchFromPage, getPageGlobal, waitUntil } from '@opentabs-dev/plugin-sdk';

// --- Internal Snowflake types ---

interface RequestContext {
  appServerUrl: string;
  decodedUserKey: string;
  role: string;
  isSecondaryUser: boolean;
  userKey: string;
}

// --- Auth ---

const getRequestContext = (): RequestContext | null => {
  const fn = getPageGlobal('numeracy.api.backendHttp.getRequestContext') as (() => RequestContext) | undefined;
  if (typeof fn !== 'function') return null;
  try {
    return fn();
  } catch {
    return null;
  }
};

export const isAuthenticated = (): boolean => {
  const user = getPageGlobal('numeracy.pageState.user') as { id?: string } | undefined;
  return !!user?.id && getRequestContext() !== null;
};

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

const requireContext = (): RequestContext => {
  const ctx = getRequestContext();
  if (!ctx) throw ToolError.auth('Not authenticated — please log in to Snowflake.');
  return ctx;
};

// --- Session info ---

export const getSessionInfo = (): {
  role: string;
  appServerUrl: string;
  userEmail: string;
  orgId: string;
  orgShortName: string;
} => {
  const ctx = requireContext();
  const user = getPageGlobal('numeracy.pageState.user') as { email?: string } | undefined;
  const org = getPageGlobal('numeracy.stores.organization.activeOrg') as
    | { id?: string; shortName?: string }
    | undefined;

  return {
    role: ctx.role,
    appServerUrl: ctx.appServerUrl,
    userEmail: user?.email ?? '',
    orgId: org?.id ?? '',
    orgShortName: org?.shortName ?? '',
  };
};

// --- Error extraction ---

const deepFind = (obj: unknown, key: string, maxDepth = 4): unknown => {
  if (maxDepth <= 0 || !obj || typeof obj !== 'object') return undefined;
  const record = obj as Record<string, unknown>;
  if (key in record) return record[key];
  for (const v of Object.values(record)) {
    const found = deepFind(v, key, maxDepth - 1);
    if (found !== undefined) return found;
  }
  return undefined;
};

const extractErrorMessage = (body: Record<string, unknown>): string => {
  const sqlMessage = deepFind(body, 'errorMessage') ?? deepFind(body, 'sqlMessage');
  if (typeof sqlMessage === 'string' && sqlMessage) {
    const sqlState = deepFind(body, 'sqlState');
    const errorCode = deepFind(body, 'errorCode');
    const parts = [sqlMessage];
    if (typeof sqlState === 'string') parts.push(`(sqlState: ${sqlState})`);
    if (errorCode !== undefined && errorCode !== null) parts.push(`(errorCode: ${errorCode})`);
    return parts.join(' ');
  }

  const data = body.data as Record<string, unknown> | undefined;
  if (typeof data?.message === 'string' && data.message) return data.message;
  if (typeof body.message === 'string' && body.message) return body.message;

  return JSON.stringify(body).substring(0, 500);
};

// --- Query execution ---

export interface QueryResultColumn {
  name: string;
  typeName: string;
  nullable: boolean;
  precision: number;
  scale: number;
}

export interface QueryResult {
  queryId: string;
  success: boolean;
  error: string | null;
  columns: QueryResultColumn[];
  rows: string[][];
  totalRows: number;
  chunkFileCount: number;
  durationMs: number;
  warehouseName: string;
  statementType: string;
}

interface RawQueryResponse {
  queryId?: string;
  status?: {
    summary?: string;
    errorMessage?: string | null;
    totalDuration?: number;
    warehouseName?: string;
  };
  result?: {
    resultColumnMetadata?: Array<{
      name?: string;
      typeName?: string;
      nullable?: boolean;
      precision?: number;
      scale?: number;
    }>;
    firstChunkData?: string;
    firstChunkRowCount?: number;
    chunkFileCount?: number;
    statementType?: string;
    chunkFileMetadatas?: Array<{
      url?: string;
      rowCount?: number;
      uncompressedByteSize?: number;
    }>;
  };
}

// Compute total row count across all chunks from chunk metadata.
// firstChunkRowCount only counts the first chunk — for multi-chunk results,
// we need to sum rowCount from all chunkFileMetadatas.
const computeTotalRows = (
  r:
    | {
        firstChunkRowCount?: number;
        chunkFileMetadatas?: Array<{ rowCount?: number }>;
        firstChunkData?: string;
      }
    | undefined,
): number => {
  if (!r) return 0;
  const metadatas = r.chunkFileMetadatas;
  if (metadatas && metadatas.length > 0) {
    return metadatas.reduce((sum, m) => sum + (m.rowCount ?? 0), 0);
  }
  return r.firstChunkRowCount ?? 0;
};

export const runQuery = async (
  sqlText: string,
  options?: {
    database?: string;
    schema?: string;
    warehouse?: string;
    role?: string;
  },
): Promise<QueryResult> => {
  const ctx = requireContext();

  const body: Record<string, unknown> = {
    sqlText,
    asyncExec: false,
    sequenceId: 0,
    querySubmissionTime: Date.now(),
  };
  if (options?.database) body.database = options.database;
  if (options?.schema) body.schema = options.schema;
  if (options?.warehouse) body.warehouse = options.warehouse;
  if (options?.role) body.role = options.role;

  // Use raw fetch instead of fetchFromPage because Snowflake returns HTTP 422
  // for SQL compilation errors. fetchFromPage would throw a generic ToolError
  // before we can extract the descriptive SQL error message from the response body.
  const response = await fetch(`${ctx.appServerUrl}/v1/queries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-snowflake-context': ctx.decodedUserKey,
    },
    credentials: 'include',
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000), // 5 minute timeout for long queries
  });

  if (!response.ok) {
    let errorDetail: string;
    try {
      const errorBody = (await response.json()) as Record<string, unknown>;
      errorDetail = extractErrorMessage(errorBody);
    } catch {
      errorDetail = response.statusText;
    }
    if (response.status === 401 || response.status === 403) {
      throw ToolError.auth(`Snowflake auth error: ${errorDetail}`);
    }
    if (response.status === 429) {
      throw ToolError.rateLimited(`Snowflake rate limited: ${errorDetail}`);
    }
    if (response.status === 422) {
      throw ToolError.validation(errorDetail);
    }
    throw ToolError.internal(`Snowflake API ${response.status}: ${errorDetail}`);
  }

  const data = (await response.json()) as RawQueryResponse;

  if (data.status?.summary !== 'SUCCESS') {
    const errorMsg = data.status?.errorMessage ?? 'Query execution failed';
    throw ToolError.validation(errorMsg);
  }

  const r = data.result;
  const columns: QueryResultColumn[] = (r?.resultColumnMetadata ?? []).map(c => ({
    name: c.name ?? '',
    typeName: c.typeName ?? '',
    nullable: c.nullable ?? true,
    precision: c.precision ?? 0,
    scale: c.scale ?? 0,
  }));

  const rows: string[][] = r?.firstChunkData ? (JSON.parse(r.firstChunkData) as string[][]) : [];

  return {
    queryId: data.queryId ?? '',
    success: true,
    error: null,
    columns,
    rows,
    totalRows: computeTotalRows(r),
    chunkFileCount: r?.chunkFileCount ?? 0,
    durationMs: data.status?.totalDuration ?? 0,
    warehouseName: data.status?.warehouseName ?? '',
    statementType: r?.statementType ?? '',
  };
};

// --- Chunk fetching ---

export const fetchChunk = async (queryId: string, chunkIndex: number): Promise<string[][]> => {
  const ctx = requireContext();

  const response = await fetchFromPage(`${ctx.appServerUrl}/v1/queries/${queryId}/chunks/${chunkIndex}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-snowflake-context': ctx.decodedUserKey,
    },
  });

  const text = await response.text();
  if (!text || text.length === 0) return [];
  return JSON.parse(`[${text}]`) as string[][];
};

// --- Entity listing (worksheets, dashboards, folders) ---

interface EntityApiPostParams {
  path: string;
  data: Record<string, string>;
}

interface RawEntity {
  entityId?: string;
  entityType?: string;
  info?: {
    name?: string;
    content?: string;
    created?: string;
    modified?: string;
    ownerId?: number;
    queryLanguage?: string;
    role?: string;
    slug?: string;
    url?: string;
    version?: number;
    visibility?: string;
    folderId?: string | null;
    folderName?: string | null;
  };
}

interface EntityListResponse {
  entities?: RawEntity[];
  hasRecentEntities?: boolean;
  next?: string;
}

const getEntityApi = (): { post: (params: EntityApiPostParams) => Promise<EntityListResponse> } => {
  const entityApi = getPageGlobal('numeracy.stores.entity.api') as
    | { post?: (params: EntityApiPostParams) => Promise<EntityListResponse> }
    | undefined;
  if (typeof entityApi?.post !== 'function') {
    throw ToolError.internal('Snowflake entity API not available — refresh the page.');
  }
  return { post: entityApi.post.bind(entityApi) };
};

const getOrgId = (): string => {
  const org = getPageGlobal('numeracy.stores.organization.activeOrg') as { id?: string } | undefined;
  if (!org?.id) throw ToolError.internal('Snowflake organization ID not available.');
  return org.id;
};

export type { RawEntity };

export const listEntities = async (options: {
  location?: string;
  types?: string[];
  limit?: number;
  cursor?: string;
  owner?: boolean | null;
}): Promise<{ entities: RawEntity[]; next: string }> => {
  requireContext();
  const orgId = getOrgId();
  const api = getEntityApi();

  const filterOptions: Record<string, unknown> = {
    sort: { col: 'modified', dir: 'desc' },
    limit: options.limit ?? 50,
    owner: options.owner ?? null,
    types: options.types ?? ['query', 'folder'],
    showNeverViewed: 'if-invited',
    excludeModels: true,
  };
  if (options.cursor) filterOptions.from = options.cursor;

  try {
    const result = await api.post({
      path: `/organizations/${orgId}/entities/list`,
      data: {
        options: JSON.stringify(filterOptions),
        location: options.location ?? 'worksheets',
      },
    });

    return {
      entities: result.entities ?? [],
      next: result.next ?? '',
    };
  } catch (err) {
    if (err instanceof ToolError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw ToolError.internal(`Snowflake entity API error: ${msg}`);
  }
};
