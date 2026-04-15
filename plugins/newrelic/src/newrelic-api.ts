import { ToolError, fetchFromPage, getPageGlobal, log, waitUntil } from '@opentabs-dev/plugin-sdk';

const GRAPHQL_URL = 'https://one.newrelic.com/graphql';

/**
 * Auth detection via `window.__nr.userId` page global.
 * New Relic uses HttpOnly session cookies — no visible bearer token.
 * The `newrelic-requesting-services` header identifies the request as first-party.
 */
const isAuth = (): boolean => {
  const userId = getPageGlobal('__nr.userId') as number | undefined;
  return userId !== undefined && userId !== null;
};

export const isAuthenticated = (): boolean => isAuth();

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

/**
 * Execute a NerdGraph GraphQL query against the same-origin proxy.
 * Auth is handled via HttpOnly session cookies (`credentials: 'include'`).
 * The `newrelic-requesting-services` and `x-requested-with` headers are required.
 */
export const graphql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
  if (!isAuth()) throw ToolError.auth('Not authenticated — please log in to New Relic.');

  const response = await fetchFromPage(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'newrelic-requesting-services': 'platform|nr1-ui',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string; path?: string[] }>;
  };

  if (json.errors?.length) {
    const msg = json.errors.map(e => e.message).join('; ');

    if (!json.data) {
      if (msg.includes('NOT_FOUND')) throw ToolError.notFound(msg);
      if (msg.includes('FORBIDDEN') || msg.includes('Api-Key')) throw ToolError.auth(msg);
      throw ToolError.internal(msg);
    }

    log.warn('GraphQL partial errors', { errors: json.errors.map(e => e.message) });
  }

  return json.data as T;
};
