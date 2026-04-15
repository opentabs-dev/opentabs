import {
  ToolError,
  fetchFromPage,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
  waitUntil,
  buildQueryString,
} from '@opentabs-dev/plugin-sdk';

// --- Types ---

interface BookingAuth {
  userId: number;
  isGenius: boolean;
  authLevel: number;
  csrfToken: string;
}

interface SsrStoreData {
  userIdentity?: {
    userId?: number;
    isGenius?: boolean;
    authLevel?: number;
    type?: string;
  };
  csrfToken?: string;
  language?: string;
  currency?: string;
  pageviewId?: string;
  etSerializedState?: string;
}

// --- Auth ---
// Booking.com uses HttpOnly session cookies for API auth (automatic via credentials: 'include').
// Auth is detected via the SSR'd userIdentity object in <script type="application/json"> tags.
// The CSRF token (x-booking-csrf-token) is a JWT embedded in the same SSR store data.

const extractSsrStoreData = (): SsrStoreData | null => {
  if (typeof document === 'undefined') return null;
  const scripts = document.querySelectorAll('script[type="application/json"]');
  for (const s of scripts) {
    try {
      const d = JSON.parse(s.textContent ?? '') as SsrStoreData;
      if (d.userIdentity || d.csrfToken) return d;
    } catch {
      /* skip non-JSON scripts */
    }
  }
  return null;
};

const getAuth = (): BookingAuth | null => {
  const cached = getAuthCache<BookingAuth>('booking');
  if (cached) return cached;

  const store = extractSsrStoreData();
  if (!store?.userIdentity?.userId || !store.csrfToken) return null;

  const auth: BookingAuth = {
    userId: store.userIdentity.userId,
    isGenius: store.userIdentity.isGenius ?? false,
    authLevel: store.userIdentity.authLevel ?? 0,
    csrfToken: store.csrfToken,
  };
  setAuthCache('booking', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

const requireAuth = (): BookingAuth => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Booking.com.');
  return auth;
};

// --- GraphQL API ---
// Booking.com's primary API is GraphQL at /dml/graphql. Requests require specific headers
// extracted from the SSR store: CSRF token, affiliate ID, site type, and page topic.

const GQL_URL = '/dml/graphql?lang=en-us';

const getGraphqlHeaders = (auth: BookingAuth): Record<string, string> => ({
  'content-type': 'application/json',
  'x-booking-csrf-token': auth.csrfToken,
  'x-booking-context-aid': '304142',
  'x-booking-site-type-id': '1',
  'x-booking-topic': 'capla_browser_b-index-lp-web-mfe',
});

export const graphql = async <T>(
  operationName: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> => {
  const auth = requireAuth();

  const response = await fetchFromPage(GQL_URL, {
    method: 'POST',
    headers: getGraphqlHeaders(auth),
    body: JSON.stringify({ operationName, query, variables }),
  });

  const data = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (data.errors?.length && !data.data) {
    const msg = data.errors.map(e => e.message).join('; ');
    if (
      msg.includes('UNAUTHENTICATED') ||
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('CSRF') ||
      msg.includes('FORBIDDEN')
    ) {
      clearAuthCache('booking');
      throw ToolError.auth(`GraphQL auth error: ${msg}`);
    }
    throw ToolError.internal(`GraphQL error: ${msg}`);
  }

  return data.data as T;
};

// --- SSR Page Fetch ---
// Many Booking.com pages SSR their Apollo cache in <script type="application/json"> tags.
// This is the primary data access method for search results, trips, and wishlists.

export interface ApolloCache {
  ROOT_QUERY: Record<string, unknown>;
  [key: string]: unknown;
}

export const fetchPage = async (path: string): Promise<Document> => {
  requireAuth();

  const response = await fetchFromPage(path, {
    headers: { accept: 'text/html' },
  });

  const html = await response.text();
  return new DOMParser().parseFromString(html, 'text/html');
};

export const extractApolloCache = (doc: Document): ApolloCache | null => {
  const scripts = doc.querySelectorAll('script[type="application/json"]');
  for (const s of scripts) {
    try {
      const d = JSON.parse(s.textContent ?? '') as Record<string, unknown>;
      if ('ROOT_QUERY' in d) return d as ApolloCache;
    } catch {
      /* skip */
    }
  }
  return null;
};

export const extractSsrStore = (doc: Document): SsrStoreData | null => {
  const scripts = doc.querySelectorAll('script[type="application/json"]');
  for (const s of scripts) {
    try {
      const d = JSON.parse(s.textContent ?? '') as SsrStoreData;
      if (d.userIdentity) return d;
    } catch {
      /* skip */
    }
  }
  return null;
};

// --- URL Builders ---

export const buildSearchUrl = (params: {
  destination: string;
  checkin: string;
  checkout: string;
  adults?: number;
  children?: number;
  rooms?: number;
  offset?: number;
}): string => {
  const qs = buildQueryString({
    ss: params.destination,
    checkin: params.checkin,
    checkout: params.checkout,
    group_adults: params.adults ?? 2,
    group_children: params.children ?? 0,
    no_rooms: params.rooms ?? 1,
    offset: params.offset,
  });
  return `/searchresults.html?${qs}`;
};
