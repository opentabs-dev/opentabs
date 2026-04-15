import { ToolError, buildQueryString, getPageGlobal, httpStatusToToolError, waitUntil } from '@opentabs-dev/plugin-sdk';

// --- Auth ---

interface StripeAuth {
  merchantId: string;
  csrfToken: string;
  sessionApiKey: string;
  livemode: boolean;
}

const getAuth = (): StripeAuth | null => {
  const merchant = getPageGlobal('PRELOADED.merchant') as { id?: string } | undefined;
  const csrfToken = getPageGlobal('PRELOADED.csrf_token') as string | undefined;
  const sessionApiKey = getPageGlobal('PRELOADED.session_api_key') as string | undefined;
  if (!merchant?.id || !csrfToken || !sessionApiKey) return null;
  const livemode = !window.location.pathname.includes('/test/');
  return { merchantId: merchant.id, csrfToken, sessionApiKey, livemode };
};

export const isAuthenticated = (): boolean => getAuth() !== null;

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

// --- API ---

const API_BASE = '/v1';

/**
 * Stripe Dashboard API caller. The dashboard proxies the Stripe API at
 * dashboard.stripe.com/v1/* using a session API key (Bearer token) from
 * PRELOADED.session_api_key. The dashboard's Service Worker normally
 * injects this token, but adapter code must add it explicitly since the
 * SW may not intercept adapter-originated fetch calls.
 */
export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Stripe Dashboard.');

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${API_BASE}${endpoint}?${qs}` : `${API_BASE}${endpoint}`;

  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${auth.sessionApiKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Requested-With': 'XMLHttpRequest',
    'Stripe-Account': auth.merchantId,
    'Stripe-Livemode': String(auth.livemode),
    'Stripe-Version': (getPageGlobal('STRIPE_VERSION') as string | undefined) ?? '2025-06-30.basil',
    'x-stripe-csrf-token': auth.csrfToken,
  };

  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
    signal: AbortSignal.timeout(30_000),
  };

  if (options.body && method !== 'GET') {
    init.body = encodeBody(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw ToolError.timeout('Stripe API request timed out after 30s.');
    }
    throw ToolError.internal(`Network error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    throw httpStatusToToolError(response, await response.text());
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};

/**
 * Encode a flat or nested object as x-www-form-urlencoded, matching Stripe's
 * bracket notation for nested params (e.g., `metadata[key]=value`).
 */
function encodeBody(obj: Record<string, unknown>, prefix?: string): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof val === 'object' && !Array.isArray(val)) {
      parts.push(encodeBody(val as Record<string, unknown>, fullKey));
    } else if (Array.isArray(val)) {
      for (const item of val) {
        parts.push(`${encodeURIComponent(`${fullKey}[]`)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(val))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}
