// ---------------------------------------------------------------------------
// Fetch utilities for plugin authors
// ---------------------------------------------------------------------------

import { toErrorMessage } from '@opentabs-dev/shared';
import type { z } from 'zod';
import { ToolError } from './errors.js';

const MAX_ERROR_BODY_LENGTH = 512;

export interface FetchFromPageOptions extends RequestInit {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/** Maps an HTTP error response to a ToolError with the appropriate category. */
export const httpStatusToToolError = (response: Response, message: string): ToolError => {
  const status = response.status;
  if (status === 401 || status === 403) {
    return ToolError.auth(message);
  }
  if (status === 404) {
    return ToolError.notFound(message);
  }
  if (status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const retryAfterMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
    return ToolError.rateLimited(message, retryAfterMs);
  }
  if (status === 400 || status === 422) {
    return ToolError.validation(message);
  }
  if (status === 408) {
    return ToolError.timeout(message);
  }
  if (status >= 500) {
    const TRANSIENT_5XX = new Set([500, 502, 503, 504]);
    const retryable = TRANSIENT_5XX.has(status);
    const retryAfter = status === 503 ? response.headers.get('Retry-After') : null;
    const retryAfterMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
    return new ToolError(message, 'http_error', { category: 'internal', retryable, retryAfterMs });
  }
  if (status >= 400 && status < 500) {
    return new ToolError(message, 'http_error', { retryable: false });
  }
  return new ToolError(message, 'http_error', { category: 'internal' });
};

/** Parses a Retry-After header value (seconds or HTTP-date) into milliseconds. */
export const parseRetryAfterMs = (value: string): number | undefined => {
  const seconds = Number(value);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    const ms = date - Date.now();
    return ms > 0 ? ms : undefined;
  }
  return undefined;
};

/**
 * Checks multiple common rate limit header names and normalizes them to milliseconds.
 * Checks in order: Retry-After, x-rate-limit-reset, x-ratelimit-reset, RateLimit-Reset.
 */
export const parseRateLimitHeader = (headers: Headers): number | undefined => {
  // Standard Retry-After header (delta-seconds or HTTP-date)
  const retryAfter = headers.get('Retry-After');
  if (retryAfter !== null) return parseRetryAfterMs(retryAfter);

  // X/Twitter: x-rate-limit-reset (Unix epoch in seconds)
  const epochReset = headers.get('x-rate-limit-reset');
  if (epochReset !== null) {
    const epochMs = Number(epochReset) * 1000;
    if (!Number.isNaN(epochMs)) {
      const ms = epochMs - Date.now();
      return ms > 0 ? ms : undefined;
    }
  }

  // Reddit: x-ratelimit-reset (seconds until reset)
  const deltaReset = headers.get('x-ratelimit-reset');
  if (deltaReset !== null) {
    const seconds = Number(deltaReset);
    if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  }

  // Generic RateLimit-Reset (seconds, per IETF draft)
  const genericReset = headers.get('RateLimit-Reset');
  if (genericReset !== null) {
    const seconds = Number(genericReset);
    if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  }

  return undefined;
};

/** Filters out keys with undefined values from an object. Keeps null, 0, false, and empty string. */
export const stripUndefined = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Builds a URL query string from a record, filtering out undefined values. */
export const buildQueryString = (
  params: Record<string, string | number | boolean | (string | number | boolean)[] | undefined>,
): string => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, String(item));
      }
    } else {
      searchParams.append(key, String(value));
    }
  }
  return searchParams.toString();
};

/**
 * Fetches a URL using the page's authenticated session (credentials: 'include').
 * Provides built-in timeout via AbortSignal and throws a descriptive ToolError
 * on non-ok HTTP status codes.
 */
export const fetchFromPage = async (url: string, init?: FetchFromPageOptions): Promise<Response> => {
  const { timeout = 30_000, signal, ...rest } = init ?? {};

  const timeoutSignal = AbortSignal.timeout(timeout);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      ...rest,
      signal: combinedSignal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw ToolError.timeout(`fetchFromPage: request timed out after ${timeout}ms for ${url}`);
    }
    if (combinedSignal.aborted) {
      throw new ToolError(`fetchFromPage: request aborted for ${url}`, 'aborted');
    }
    throw new ToolError(`fetchFromPage: network error for ${url}: ${toErrorMessage(error)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => response.statusText);
    const errorText = rawText.length > MAX_ERROR_BODY_LENGTH ? `${rawText.slice(0, MAX_ERROR_BODY_LENGTH)}…` : rawText;
    const msg = `fetchFromPage: HTTP ${response.status} for ${url}: ${errorText}`;
    throw httpStatusToToolError(response, msg);
  }

  return response;
};

/** Shared implementation for fetchJSON and postJSON — fetches, parses JSON, optionally validates. */
export const fetchJSONImpl = async (url: string, init?: FetchFromPageOptions, schema?: z.ZodType): Promise<unknown> => {
  const response = await fetchFromPage(url, init);

  let data: unknown;
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    if (!schema) {
      return undefined;
    }
    throw ToolError.validation(
      `fetchJSON: expected JSON response from ${url} but received HTTP ${response.status} with no body to validate`,
    );
  } else {
    try {
      data = await response.json();
    } catch {
      throw ToolError.validation(`fetchJSON: failed to parse JSON response from ${url}`);
    }
  }

  if (schema) {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw ToolError.validation(`fetchJSON: response from ${url} failed schema validation: ${result.error.message}`);
    }
    return result.data;
  }

  return data;
};

/**
 * Overloaded call signature for fetchJSON — validates against a Zod schema
 * when provided, or returns an unchecked cast when omitted.
 */
export interface FetchJSON {
  /** Fetch JSON and validate against a Zod schema. Returns the validated, typed result. */
  <T extends z.ZodType>(url: string, init: FetchFromPageOptions | undefined, schema: T): Promise<z.infer<T>>;
  /** Fetch JSON with an unchecked cast to T. Returns undefined for 204 No Content responses. */
  <T>(url: string, init?: FetchFromPageOptions): Promise<T | undefined>;
}

/**
 * Fetches a URL and parses the response as JSON. Uses the page's session
 * cookies (credentials: 'include') and provides timeout + error handling.
 * When a Zod schema is provided as the third argument, the parsed JSON is
 * validated against it and a ToolError.validation is thrown on failure.
 */
export const fetchJSON: FetchJSON = fetchJSONImpl as FetchJSON;

/**
 * Overloaded call signature for postJSON — validates against a Zod schema
 * when provided, or returns an unchecked cast when omitted.
 */
export interface PostJSON {
  /** POST JSON and validate the response against a Zod schema. Returns the validated, typed result. */
  <T extends z.ZodType>(
    url: string,
    body: unknown,
    init: FetchFromPageOptions | undefined,
    schema: T,
  ): Promise<z.infer<T>>;
  /** POST JSON with an unchecked cast to T. Returns undefined for 204 No Content responses. */
  <T>(url: string, body: unknown, init?: FetchFromPageOptions): Promise<T | undefined>;
}

/**
 * Convenience wrapper for POST requests with a JSON body. Sets Content-Type,
 * stringifies the body, and parses the JSON response. When a Zod schema is
 * provided as the fourth argument, the parsed JSON is validated against it.
 */
export const postJSON: PostJSON = (async (
  url: string,
  body: unknown,
  init?: FetchFromPageOptions,
  schema?: z.ZodType,
): Promise<unknown> => {
  const extraHeaders = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {};
  return fetchJSONImpl(
    url,
    {
      ...init,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    },
    schema,
  );
}) as PostJSON;

/**
 * Overloaded call signature for postForm — validates against a Zod schema
 * when provided, or returns an unchecked cast when omitted.
 */
export interface PostForm {
  /** POST URL-encoded form and validate the response against a Zod schema. Returns the validated, typed result. */
  <T extends z.ZodType>(
    url: string,
    body: Record<string, string>,
    init: FetchFromPageOptions | undefined,
    schema: T,
  ): Promise<z.infer<T>>;
  /** POST URL-encoded form with an unchecked cast to T. Returns undefined for 204 No Content responses. */
  <T>(url: string, body: Record<string, string>, init?: FetchFromPageOptions): Promise<T | undefined>;
}

/**
 * Convenience wrapper for POST requests with a URL-encoded form body. Sets
 * Content-Type to application/x-www-form-urlencoded, serializes the body using
 * URLSearchParams, and parses the JSON response. When a Zod schema is provided
 * as the fourth argument, the parsed JSON is validated against it.
 */
export const postForm: PostForm = (async (
  url: string,
  body: Record<string, string>,
  init?: FetchFromPageOptions,
  schema?: z.ZodType,
): Promise<unknown> => {
  const extraHeaders = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {};
  return fetchJSONImpl(
    url,
    {
      ...init,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extraHeaders },
      body: new URLSearchParams(body).toString(),
    },
    schema,
  );
}) as PostForm;

/**
 * Overloaded call signature for postFormData — validates against a Zod schema
 * when provided, or returns an unchecked cast when omitted.
 */
export interface PostFormData {
  /** POST multipart form data and validate the response against a Zod schema. Returns the validated, typed result. */
  <T extends z.ZodType>(
    url: string,
    body: FormData,
    init: FetchFromPageOptions | undefined,
    schema: T,
  ): Promise<z.infer<T>>;
  /** POST multipart form data with an unchecked cast to T. Returns undefined for 204 No Content responses. */
  <T>(url: string, body: FormData, init?: FetchFromPageOptions): Promise<T | undefined>;
}

/**
 * Convenience wrapper for POST requests with a multipart/form-data body.
 * Does NOT set Content-Type — the browser sets it automatically with the
 * multipart boundary string. Parses the JSON response. When a Zod schema
 * is provided as the fourth argument, the parsed JSON is validated against it.
 */
export const postFormData: PostFormData = (async (
  url: string,
  body: FormData,
  init?: FetchFromPageOptions,
  schema?: z.ZodType,
): Promise<unknown> => {
  const extraHeaders = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {};
  // The browser must auto-set Content-Type to multipart/form-data with boundary.
  // Any explicit Content-Type overrides this and omits the boundary, breaking multipart parsing.
  delete extraHeaders['content-type'];
  return fetchJSONImpl(
    url,
    {
      ...init,
      method: 'POST',
      headers: { ...extraHeaders },
      body,
    },
    schema,
  );
}) as PostFormData;

/**
 * Overloaded call signature for putJSON — validates against a Zod schema
 * when provided, or returns an unchecked cast when omitted.
 */
export interface PutJSON {
  /** PUT JSON and validate the response against a Zod schema. Returns the validated, typed result. */
  <T extends z.ZodType>(
    url: string,
    body: unknown,
    init: FetchFromPageOptions | undefined,
    schema: T,
  ): Promise<z.infer<T>>;
  /** PUT JSON with an unchecked cast to T. Returns undefined for 204 No Content responses. */
  <T>(url: string, body: unknown, init?: FetchFromPageOptions): Promise<T | undefined>;
}

/**
 * Convenience wrapper for PUT requests with a JSON body. Sets Content-Type,
 * stringifies the body, and parses the JSON response. When a Zod schema is
 * provided as the fourth argument, the parsed JSON is validated against it.
 */
export const putJSON: PutJSON = (async (
  url: string,
  body: unknown,
  init?: FetchFromPageOptions,
  schema?: z.ZodType,
): Promise<unknown> => {
  const extraHeaders = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {};
  return fetchJSONImpl(
    url,
    {
      ...init,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    },
    schema,
  );
}) as PutJSON;

/**
 * Overloaded call signature for patchJSON — validates against a Zod schema
 * when provided, or returns an unchecked cast when omitted.
 */
export interface PatchJSON {
  /** PATCH JSON and validate the response against a Zod schema. Returns the validated, typed result. */
  <T extends z.ZodType>(
    url: string,
    body: unknown,
    init: FetchFromPageOptions | undefined,
    schema: T,
  ): Promise<z.infer<T>>;
  /** PATCH JSON with an unchecked cast to T. Returns undefined for 204 No Content responses. */
  <T>(url: string, body: unknown, init?: FetchFromPageOptions): Promise<T | undefined>;
}

/**
 * Convenience wrapper for PATCH requests with a JSON body. Sets Content-Type,
 * stringifies the body, and parses the JSON response. When a Zod schema is
 * provided as the fourth argument, the parsed JSON is validated against it.
 */
export const patchJSON: PatchJSON = (async (
  url: string,
  body: unknown,
  init?: FetchFromPageOptions,
  schema?: z.ZodType,
): Promise<unknown> => {
  const extraHeaders = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {};
  return fetchJSONImpl(
    url,
    {
      ...init,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    },
    schema,
  );
}) as PatchJSON;

/**
 * Overloaded call signature for deleteJSON — validates against a Zod schema
 * when provided, or returns an unchecked cast when omitted.
 */
export interface DeleteJSON {
  /** DELETE and validate the response against a Zod schema. Returns the validated, typed result. */
  <T extends z.ZodType>(url: string, init: FetchFromPageOptions | undefined, schema: T): Promise<z.infer<T>>;
  /** DELETE with an unchecked cast to T. Returns undefined for 204 No Content responses. */
  <T>(url: string, init?: FetchFromPageOptions): Promise<T | undefined>;
}

/**
 * Convenience wrapper for DELETE requests. Parses the JSON response.
 * When a Zod schema is provided as the third argument, the parsed JSON
 * is validated against it.
 */
export const deleteJSON: DeleteJSON = (async (
  url: string,
  init?: FetchFromPageOptions,
  schema?: z.ZodType,
): Promise<unknown> => fetchJSONImpl(url, { ...init, method: 'DELETE' }, schema)) as DeleteJSON;

/** Fetches a URL and returns the response body as a string instead of JSON. */
export const fetchText = async (url: string, init?: FetchFromPageOptions): Promise<string> => {
  const response = await fetchFromPage(url, init);
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return '';
  }
  return response.text();
};
