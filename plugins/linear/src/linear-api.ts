import {
  ToolError,
  clearAuthCache,
  getAuthCache,
  getCookie,
  getLocalStorage,
  parseRetryAfterMs,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

// Linear's GraphQL API is on a separate subdomain (client-api.linear.app) from
// the web app (linear.app). The CORS policy returns:
//   access-control-allow-origin: https://linear.app
//   access-control-allow-credentials: true
// This means in-page fetch() with credentials: 'include' sends the HttpOnly
// SameSite=Strict session cookies automatically. No fetchViaBackground needed.
const GRAPHQL_ENDPOINT = 'https://client-api.linear.app/graphql';

interface LinearAuth {
  userAccountId: string;
  userId: string;
  organizationId: string;
  clientId: string;
}

const getAuth = (): LinearAuth | null => {
  // Check persisted auth first (survives adapter re-injection)
  const persisted = getAuthCache<LinearAuth>('linear');
  if (persisted?.userAccountId && persisted?.userId) return persisted;

  // Check the non-HttpOnly 'loggedIn' indicator cookie
  const loggedIn = getCookie('loggedIn');
  if (loggedIn !== '1') return null;

  // Read user context from ApplicationStore in localStorage.
  // The store contains: currentUserAccountId, currentUserId, and the user's
  // organization ID nested under userAccounts[id].users[0].organization.id.
  try {
    const raw = getLocalStorage('ApplicationStore');
    if (!raw) return null;
    const appStore = JSON.parse(raw) as Record<string, unknown>;
    const userAccountId = appStore.currentUserAccountId as string | undefined;
    const userId = appStore.currentUserId as string | undefined;
    if (!userAccountId || !userId) return null;

    // Resolve organization ID from the user account's first user entry
    let organizationId = '';
    const userAccounts = appStore.userAccounts as
      | Record<string, { users?: Array<{ organization?: { id?: string } }> }>
      | undefined;
    if (userAccounts) {
      const account = userAccounts[userAccountId];
      const firstUser = account?.users?.[0];
      organizationId = firstUser?.organization?.id ?? '';
    }

    // Read clientId for the linear-client-id header
    const clientId = getLocalStorage('clientId') ?? '';

    const auth: LinearAuth = { userAccountId, userId, organizationId, clientId };
    setAuthCache('linear', auth);
    return auth;
  } catch {
    return null;
  }
};

export const isLinearAuthenticated = (): boolean => getAuth() !== null;

export const waitForLinearAuth = (): Promise<boolean> =>
  waitUntil(() => isLinearAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

// --- GraphQL API caller ---

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export const graphql = async <T extends Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Linear.');

  // Match the headers Linear's own web app sends to client-api.linear.app.
  // The browser attaches HttpOnly session cookies via credentials: 'include'.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    useraccount: auth.userAccountId,
    user: auth.userId,
  };
  if (auth.organizationId) {
    headers.organization = auth.organizationId;
  }
  if (auth.clientId) {
    headers['linear-client-id'] = auth.clientId;
  }

  let response: Response;
  try {
    response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout('Linear API request timed out');
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw ToolError.timeout('Request was aborted');
    }
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  // HTTP-level error classification
  if (!response.ok) {
    const errorBody = (await response.text().catch(() => '')).substring(0, 512);

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
      throw ToolError.rateLimited(`Rate limited — ${errorBody}`, retryMs);
    }
    if (response.status === 401 || response.status === 403) {
      clearAuthCache('linear');
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    }
    if (response.status === 404) {
      throw ToolError.notFound(`Not found: ${errorBody}`);
    }
    throw ToolError.internal(`API error (${response.status}): ${errorBody}`);
  }

  let result: GraphQLResponse<T>;
  try {
    result = (await response.json()) as GraphQLResponse<T>;
  } catch {
    throw ToolError.internal('Linear API returned non-JSON response');
  }

  // GraphQL-level error classification
  if (result.errors && result.errors.length > 0) {
    const firstError = result.errors[0];
    if (!firstError) throw ToolError.internal('Linear API returned unknown error');
    const message = firstError.message;
    const extensions = firstError.extensions ?? {};
    const code = extensions.code as string | undefined;
    const userPresentableMessage = extensions.userPresentableMessage as string | undefined;
    const displayMessage = userPresentableMessage ?? message;

    if (code === 'AUTHENTICATION_ERROR' || code === 'FORBIDDEN') {
      clearAuthCache('linear');
      throw ToolError.auth(displayMessage);
    }
    if (code === 'RATELIMITED') {
      throw ToolError.rateLimited(displayMessage);
    }
    if (code === 'BAD_USER_INPUT' || code === 'GRAPHQL_VALIDATION_FAILED') {
      throw ToolError.validation(displayMessage);
    }

    // Check message patterns for not-found
    if (message.toLowerCase().includes('not found') || message.toLowerCase().includes('does not exist')) {
      throw ToolError.notFound(displayMessage);
    }

    throw ToolError.internal(displayMessage);
  }

  if (!result.data) {
    throw ToolError.internal('Linear API returned empty response');
  }

  return result.data;
};
