import {
  ToolError,
  fetchText,
  fetchFromPage,
  getCookie,
  getAuthCache,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

const GRAPHQL_URL = '/data/graphql/ids';

interface TripAdvisorAuth {
  userId: string;
}

const getAuth = (): TripAdvisorAuth | null => {
  const cached = getAuthCache<TripAdvisorAuth>('tripadvisor');
  if (cached) return cached;

  const tasid = getCookie('TASID');
  const taautheat = getCookie('TAAUTHEAT');
  if (!tasid && !taautheat) return null;

  const auth: TripAdvisorAuth = { userId: tasid ?? '' };
  setAuthCache('tripadvisor', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

/**
 * Call TripAdvisor's GraphQL API with pre-registered query IDs.
 * Requests are batched as JSON arrays.
 */
export const graphql = async <T>(
  queries: Array<{
    variables: Record<string, unknown>;
    queryId: string;
  }>,
): Promise<T[]> => {
  const body = queries.map(q => ({
    variables: q.variables,
    extensions: { preRegisteredQueryId: q.queryId },
  }));

  const response = await fetchFromPage(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const results = (await response.json()) as Array<{ data: T }>;
  return results.map(r => r.data);
};

/**
 * Fetch an SSR-rendered page and extract the urqlSsrData bootstrap.
 * Returns a record of numeric keys → parsed data objects.
 */
export const fetchSsrData = async (path: string): Promise<Record<string, Record<string, unknown>>> => {
  const html = await fetchText(path, {
    headers: { Accept: 'text/html' },
  });

  const dataUriMatch = html.match(/src="data:text\/javascript,([^"]+)"/);
  const dataUriContent = dataUriMatch?.[1];
  if (!dataUriContent) throw ToolError.internal('Could not extract SSR bootstrap data.');

  const decoded = decodeURIComponent(dataUriContent);
  const jsonMatch = decoded.match(/JSON\.parse\("((?:[^"\\]|\\.)*)"\)\)/);
  const jsonContent = jsonMatch?.[1];
  if (!jsonContent) throw ToolError.internal('Could not parse SSR bootstrap JSON.');

  const str = jsonContent.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const bootstrap = JSON.parse(str) as {
    urqlSsrData?: {
      results: Record<string, { data: string }>;
    };
  };

  if (!bootstrap.urqlSsrData) throw ToolError.internal('No urqlSsrData in bootstrap.');

  const results: Record<string, Record<string, unknown>> = {};
  for (const [key, entry] of Object.entries(bootstrap.urqlSsrData.results)) {
    try {
      results[key] = JSON.parse(entry.data) as Record<string, unknown>;
    } catch {
      // Skip malformed entries
    }
  }

  return results;
};

/**
 * Extract LD+JSON structured data from an SSR-rendered page.
 */
export const fetchLdJson = async (path: string): Promise<Record<string, unknown>[]> => {
  const html = await fetchText(path, {
    headers: { Accept: 'text/html' },
  });

  const matches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  if (!matches) return [];

  const results: Record<string, unknown>[] = [];
  for (const m of matches) {
    try {
      const json = m.replace(/<script type="application\/ld\+json">/, '').replace(/<\/script>/, '');
      results.push(JSON.parse(json) as Record<string, unknown>);
    } catch {
      // Skip malformed entries
    }
  }

  return results;
};

/**
 * Find an SSR query result by matching a specific operation name.
 */
export const findSsrOperation = (ssrData: Record<string, Record<string, unknown>>, operationName: string): unknown => {
  for (const entry of Object.values(ssrData)) {
    if (operationName in entry) {
      return entry[operationName];
    }
  }
  return null;
};
