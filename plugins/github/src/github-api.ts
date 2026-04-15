import {
  ToolError,
  buildQueryString,
  fetchFromPage,
  fetchText,
  getMetaContent,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

// --- Auth detection ---
// GitHub uses HttpOnly session cookies (not accessible via document.cookie).
// Auth is detected via the <meta name="user-login"> tag that GitHub injects
// on every page for logged-in users.

interface GitHubAuth {
  login: string;
}

const getAuth = (): GitHubAuth | null => {
  const login = getMetaContent('user-login');
  if (!login) return null;
  return { login };
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

export const getLogin = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to GitHub.');
  return auth.login;
};

// --- CSRF token ---
// GitHub requires a CSRF token for /_graphql and form POST mutations.
// Tokens are form-specific and found in input[name="authenticity_token"] elements.

const getCsrfToken = (): string | null => {
  // Prefer graphql-specific form token, fall back to any authenticity_token
  const graphqlInput = document.querySelector<HTMLInputElement>(
    'form[action*="graphql"] input[name="authenticity_token"]',
  );
  if (graphqlInput?.value) return graphqlInput.value;
  const anyInput = document.querySelector<HTMLInputElement>('input[name="authenticity_token"]');
  return anyInput?.value ?? null;
};

const requireCsrf = (): string => {
  const token = getCsrfToken();
  if (!token) throw ToolError.auth('CSRF token not found — refresh the GitHub page.');
  return token;
};

const doFetch = async (url: string, init: FetchFromPageOptions): Promise<Response> => {
  try {
    return await fetchFromPage(url, init);
  } catch (err: unknown) {
    if (err instanceof ToolError) throw err;
    if (err instanceof DOMException && err.name === 'TimeoutError')
      throw ToolError.timeout(`Request timed out: ${url}`);
    throw ToolError.internal(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// --- Transport: Same-origin page JSON ---
// Fetches a GitHub page URL with Accept: application/json.
// Returns the payload from the { meta, payload } response envelope.

interface PageJsonResponse {
  meta?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export const pageJson = async <T>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

  const qs = query ? buildQueryString(query) : '';
  const url = qs ? `${path}?${qs}` : path;

  const response = await doFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  const data = (await response.json()) as PageJsonResponse;
  return (data.payload ?? data) as T;
};

// --- Transport: Turbo-Frame embedded Relay data ---
// For pages that return 406 on JSON accept (issues list, PR list), fetch with
// Turbo-Frame header and extract embedded React/Relay data from the HTML.

interface RelayPreloadedQuery {
  queryId: string;
  queryName: string;
  variables: Record<string, unknown>;
  result: { data: Record<string, unknown> };
  timestamp: number;
}

export const turboData = async <T>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<{ data: T; queryId?: string; queryName?: string }> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

  const qs = query ? buildQueryString(query) : '';
  const url = qs ? `${path}?${qs}` : path;

  const html = await fetchText(url, {
    headers: {
      Accept: 'text/html',
      'Turbo-Frame': 'repo-content-turbo-frame',
    },
  });

  // Extract embedded React app data
  const match = html.match(/<script[^>]*data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw ToolError.internal(`No embedded data found in ${path}`);

  const embedded = JSON.parse(match[1]) as {
    payload?: {
      preloadedQueries?: Record<string, RelayPreloadedQuery>;
      [key: string]: unknown;
    };
  };

  const preloaded = embedded.payload?.preloadedQueries;
  if (preloaded) {
    const first = Object.values(preloaded)[0];
    if (first?.result?.data) {
      return {
        data: first.result.data as T,
        queryId: first.queryId,
        queryName: first.queryName,
      };
    }
  }

  return { data: (embedded.payload ?? embedded) as T };
};

// --- Transport: /_graphql persisted queries ---
// GitHub's internal GraphQL endpoint accepts persisted query hashes.
// Query IDs are discovered at runtime from embedded page data.

// Cache of queryName → queryId mappings discovered from pages and JS bundles
const queryIdCache = new Map<string, string>();

// Discover mutation query IDs from GitHub's JS bundles.
// Mutations are compiled as Relay operations with format:
// name:"XMutation",operationKind:"mutation" preceded by id:"hexhash"
export const discoverMutationIds = async (): Promise<void> => {
  if (queryIdCache.has('__mutations_discovered__')) return;

  const html = await fetchText(window.location.href, {
    headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' },
  });

  const jsUrls: string[] = [];
  for (const m of html.matchAll(/src="(https:\/\/github\.githubassets\.com\/assets\/[^"]+\.js)"/g)) {
    if (m[1]) jsUrls.push(m[1]);
  }

  for (const url of jsUrls) {
    try {
      const response = await fetchFromPage(url, { credentials: 'omit' });
      const code = await response.text();
      if (!code.includes('operationKind:"mutation"')) continue;

      const pattern = /name:"([^"]*)",operationKind:"mutation"/g;
      for (const match of code.matchAll(pattern)) {
        const name = match[1] ?? '';
        const before = code.substring(Math.max(0, match.index - 300), match.index);
        const idMatch = before.match(/id:"([a-f0-9]{32,64})"/);
        if (idMatch?.[1]) {
          queryIdCache.set(name, idMatch[1]);
        }
      }
    } catch {
      // Skip bundles that fail to load
    }
  }

  queryIdCache.set('__mutations_discovered__', 'true');
};

// Get a mutation query ID by name, discovering from bundles if needed
export const getMutationId = async (mutationName: string): Promise<string> => {
  const cached = queryIdCache.get(mutationName);
  if (cached) return cached;

  await discoverMutationIds();

  const id = queryIdCache.get(mutationName);
  if (!id) throw ToolError.internal(`Mutation ${mutationName} not found in GitHub JS bundles`);
  return id;
};

export const discoverQueryId = async (
  queryName: string,
  discoveryPath: string,
  discoveryQuery?: Record<string, string | number | boolean | undefined>,
): Promise<string> => {
  const cached = queryIdCache.get(queryName);
  if (cached) return cached;

  const result = await turboData(discoveryPath, discoveryQuery);
  if (result.queryName && result.queryId) {
    queryIdCache.set(result.queryName, result.queryId);
  }

  const id = queryIdCache.get(queryName);
  if (!id) throw ToolError.internal(`Could not discover query ID for ${queryName}`);
  return id;
};

export const graphql = async <T>(queryId: string, variables: Record<string, unknown>): Promise<T> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to GitHub.');
  const csrf = requireCsrf();

  const response = await doFetch('/_graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'GitHub-Verified-Fetch': 'true',
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify({ query: queryId, variables }),
  });

  const result = (await response.json()) as {
    data?: T;
    errors?: Array<{ type?: string; message?: string }>;
  };

  if (result.errors?.length && !result.data) {
    const err = result.errors[0];
    if (err?.type === 'unknownQuery') {
      // Persisted query ID expired — clear cache and report
      queryIdCache.clear();
      throw ToolError.internal(
        'GraphQL persisted query expired — GitHub may have deployed a new version. Please retry.',
      );
    }
    throw ToolError.internal(`GraphQL error: ${err?.message ?? JSON.stringify(result.errors)}`);
  }

  return result.data as T;
};

// --- Transport: HTML page embedded data ---
// Fetches a page as HTML and extracts structured data from embedded script tags.
// Used for PR detail, repo page, and other pages with rich embedded JSON.

export const pageEmbeddedData = async <T>(path: string): Promise<T> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

  // X-Requested-With: XMLHttpRequest makes GitHub return the full page with all
  // embedded React data. Without it, GitHub returns a lightweight shell that
  // loads React data asynchronously.
  const html = await fetchText(path, {
    headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' },
  });

  const match = html.match(/<script[^>]*data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw ToolError.internal(`No embedded data found in ${path}`);

  const embedded = JSON.parse(match[1]) as { payload?: Record<string, unknown> };
  return (embedded.payload ?? embedded) as T;
};

// --- Transport: Form POST ---
// For write operations that use traditional form submissions with CSRF tokens.
// Fetches the form page first to get a form-specific CSRF token, then POSTs.

export const formPost = async <T>(
  formPagePath: string,
  postPath: string,
  body: Record<string, unknown>,
  options?: { csrfSelector?: string },
): Promise<T> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

  // Fetch the form page to get a fresh CSRF token
  const formHtml = await fetchText(formPagePath, {
    headers: { Accept: 'text/html' },
  });

  const csrfSelector = options?.csrfSelector ?? `form[action*="${postPath}"] input[name="authenticity_token"]`;
  const doc = new DOMParser().parseFromString(formHtml, 'text/html');
  let csrf = doc.querySelector<HTMLInputElement>(csrfSelector)?.value;

  // Fall back to any authenticity_token on the page
  if (!csrf) {
    csrf = doc.querySelector<HTMLInputElement>('input[name="authenticity_token"]')?.value ?? undefined;
  }
  if (!csrf) throw ToolError.auth(`CSRF token not found on ${formPagePath}`);

  const formData = new URLSearchParams();
  formData.set('authenticity_token', csrf);
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      formData.set(key, String(value));
    }
  }

  const response = await doFetch(postPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: formData.toString(),
  });

  const ct = response.headers.get('content-type') ?? '';
  if (ct.includes('json')) {
    return (await response.json()) as T;
  }
  // Some form posts redirect (302) or return HTML — treat as success
  return {} as T;
};

// --- Transport: Page form submission via XHR ---
// Fetches a page, locates a form by selector, populates fields, and submits
// via XMLHttpRequest with X-Requested-With: XMLHttpRequest to get a JSON response
// instead of a redirect. This is how GitHub's own JS submits comments and mutations.

export const submitPageForm = async <T>(
  pagePath: string,
  formSelector: string,
  fields: Record<string, string>,
): Promise<T> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

  // Fetch the page HTML to get the form with valid CSRF and timestamps.
  // X-Requested-With: XMLHttpRequest ensures GitHub returns the full page content
  // (without it, GitHub returns a lightweight shell for Turbo navigation).
  const html = await fetchText(pagePath, {
    headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' },
  });

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const form = doc.querySelector<HTMLFormElement>(formSelector);
  if (!form) throw ToolError.internal(`Form not found: ${formSelector} on ${pagePath}`);

  const action = form.getAttribute('action');
  if (!action) throw ToolError.internal(`Form has no action attribute on ${pagePath}`);

  // Build FormData from the form's existing hidden inputs
  const formData = new FormData();
  const inputs = form.querySelectorAll<HTMLInputElement>('input');
  for (const input of inputs) {
    const name = input.getAttribute('name');
    if (name) {
      formData.set(name, input.value ?? '');
    }
  }

  // Override/add the provided fields
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }

  return xhrSubmit<T>(action, formData);
};

// Submit a form directly to an endpoint with known fields and a CSRF token
// extracted from the live DOM. Used when the form is on the current page.
export const submitDirectForm = async <T>(
  action: string,
  fields: Record<string, string>,
  csrfToken: string,
): Promise<T> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

  const formData = new FormData();
  formData.set('authenticity_token', csrfToken);
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }

  return xhrSubmit<T>(action, formData);
};

// Internal XHR submission — GitHub requires X-Requested-With for AJAX form handling
const xhrSubmit = <T>(action: string, formData: FormData): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', action, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.withCredentials = true;
    xhr.timeout = 30_000;

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          resolve({} as T);
        }
      } else if (xhr.status === 401 || xhr.status === 403) {
        reject(ToolError.auth(`Auth error (${xhr.status}): ${action}`));
      } else if (xhr.status === 404) {
        reject(ToolError.notFound(`Not found: ${action}`));
      } else if (xhr.status === 422) {
        reject(
          ToolError.validation(`Validation error (${xhr.status}): ${action} — ${xhr.responseText.substring(0, 200)}`),
        );
      } else {
        reject(ToolError.internal(`Form submission error (${xhr.status}): ${action}`));
      }
    };

    xhr.onerror = () => reject(ToolError.internal(`Network error submitting form: ${action}`));
    xhr.ontimeout = () => reject(ToolError.timeout(`Form submission timed out: ${action}`));

    xhr.send(formData);
  });

// --- Transport: Raw text fetch ---
// For file contents, diffs, and other raw text endpoints.

export const fetchRawText = async (path: string): Promise<string> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to GitHub.');
  return fetchText(path);
};
