import {
  type FetchFromPageOptions,
  ToolError,
  buildQueryString,
  fetchFromPage,
  getCookie,
  getAuthCache,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

interface WalmartAuth {
  firstName: string;
  lastNameInitial: string;
  ceid: string;
}

const getAuth = (): WalmartAuth | null => {
  const cached = getAuthCache<WalmartAuth>('walmart');
  if (cached) return cached;

  // The `customer` cookie is URL-encoded JSON: {"firstName":"Jane","lastNameInitial":"D","ceid":"..."}
  const raw = getCookie('customer');
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<WalmartAuth>;
    if (!parsed.firstName) return null;
    const auth: WalmartAuth = {
      firstName: parsed.firstName ?? '',
      lastNameInitial: parsed.lastNameInitial ?? '',
      ceid: parsed.ceid ?? '',
    };
    setAuthCache('walmart', auth);
    return auth;
  } catch {
    return null;
  }
};

export const isAuthenticated = (): boolean => {
  // hasCID=1 and customer cookie present indicate a logged-in user
  const hasCID = getCookie('hasCID');
  if (hasCID === '1' && getAuth()) return true;
  return false;
};

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), {
      interval: 500,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
};

export const getCustomerInfo = (): WalmartAuth | null => getAuth();

// ---------------------------------------------------------------------------
// Page data extraction — the core data access pattern
// ---------------------------------------------------------------------------

/** Extract __NEXT_DATA__ JSON from a Walmart HTML page */
const extractNextData = (html: string): Record<string, unknown> | null => {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
};

type NestedRecord = Record<string, unknown>;

/** Fetch a Walmart page and return the parsed __NEXT_DATA__ pageProps */
export const fetchPageData = async (
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<NestedRecord> => {
  const qs = query ? buildQueryString(query) : '';
  const url = qs ? `https://www.walmart.com${path}?${qs}` : `https://www.walmart.com${path}`;

  const init: FetchFromPageOptions = {
    headers: { accept: 'text/html' },
  };

  const resp = await fetchFromPage(url, init);
  const html = await resp.text();
  const nextData = extractNextData(html);
  if (!nextData) {
    throw ToolError.internal('Failed to extract page data from Walmart response.');
  }

  const props = (nextData as NestedRecord).props as NestedRecord | undefined;
  const pageProps = props?.pageProps as NestedRecord | undefined;
  if (!pageProps) {
    throw ToolError.internal('Walmart page data missing pageProps.');
  }

  return pageProps;
};

// ---------------------------------------------------------------------------
// Bootstrap API — for config and account data
// ---------------------------------------------------------------------------

const BOOTSTRAP_URL = 'https://www.walmart.com/orchestra/api/ccm/v3/bootstrap';

const COMMON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  accept: 'application/json',
  'x-o-bu': 'WALMART-US',
  'x-o-mart': 'B2C',
  'x-o-platform': 'rweb',
  WM_MP: 'true',
};

export const fetchBootstrapData = async (configNames: string[]): Promise<NestedRecord> => {
  const qs = buildQueryString({ configNames: configNames.join(',') });
  const url = `${BOOTSTRAP_URL}?${qs}`;

  const resp = await fetchFromPage(url, { headers: COMMON_HEADERS });
  const json = (await resp.json()) as NestedRecord;
  return (json.data as NestedRecord) ?? {};
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const getStoreId = (): string => {
  return getCookie('assortmentStoreId') ?? '';
};

export const stripHtml = (html: string | undefined | null): string => {
  if (!html) return '';
  let result = html;
  let prev: string;
  do {
    prev = result;
    result = result.replace(/<[^>]+>/g, '');
  } while (result !== prev);
  return result.trim();
};
