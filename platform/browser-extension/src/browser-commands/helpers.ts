import { JSONRPC_INTERNAL_ERROR, JSONRPC_INVALID_PARAMS } from '../json-rpc-errors.js';
import { sendToServer } from '../messaging.js';
import { sanitizeErrorMessage } from '../sanitize-error.js';
import { isBlockedUrlScheme, toErrorMessage } from '@opentabs-dev/shared';

/**
 * Validates that `params.tabId` is a number.
 * Sends a JSONRPC_INVALID_PARAMS error if invalid, returning `null`.
 */
export const requireTabId = (params: Record<string, unknown>, id: string | number): number | null => {
  const tabId = params.tabId;
  if (typeof tabId !== 'number') {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: JSONRPC_INVALID_PARAMS, message: 'Missing or invalid tabId parameter' },
      id,
    });
    return null;
  }
  return tabId;
};

/**
 * Validates that `params.selector` is a non-empty string.
 * Sends a JSONRPC_INVALID_PARAMS error if invalid, returning `null`.
 */
export const requireSelector = (params: Record<string, unknown>, id: string | number): string | null => {
  const selector = params.selector;
  if (typeof selector !== 'string' || selector.length === 0) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: JSONRPC_INVALID_PARAMS, message: 'Missing or invalid selector parameter' },
      id,
    });
    return null;
  }
  return selector;
};

/**
 * Validates that `params[paramName]` is a non-empty string.
 * Sends a JSONRPC_INVALID_PARAMS error if invalid, returning `null`.
 */
export const requireStringParam = (
  params: Record<string, unknown>,
  paramName: string,
  id: string | number,
): string | null => {
  const value = params[paramName];
  if (typeof value !== 'string' || value.length === 0) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: JSONRPC_INVALID_PARAMS, message: `Missing or invalid ${paramName} parameter` },
      id,
    });
    return null;
  }
  return value;
};

/**
 * Validates that `params.url` is a string and not a blocked URL scheme.
 * Sends a JSONRPC_INVALID_PARAMS error if invalid, returning `null`.
 */
export const requireUrl = (params: Record<string, unknown>, id: string | number): string | null => {
  const url = params.url;
  if (typeof url !== 'string') {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: JSONRPC_INVALID_PARAMS, message: 'Missing or invalid url parameter' },
      id,
    });
    return null;
  }
  if (isBlockedUrlScheme(url)) {
    sendToServer({
      jsonrpc: '2.0',
      error: {
        code: JSONRPC_INVALID_PARAMS,
        message: 'URL scheme not allowed (javascript:, data:, file:, chrome:, blob: are blocked)',
      },
      id,
    });
    return null;
  }
  return url;
};

/**
 * Extracts the first result from `chrome.scripting.executeScript` output.
 * Sends a JSONRPC_INTERNAL_ERROR if no result, or JSONRPC_INVALID_PARAMS if the result has an `error` field.
 * Returns the result or `null`.
 */
export const extractScriptResult = (
  results: Array<{ result?: unknown }>,
  id: string | number,
  fallbackMsg = 'No result from script execution',
): Record<string, unknown> | null => {
  const result = results[0]?.result as { error?: string } | undefined;
  if (!result) {
    sendToServer({ jsonrpc: '2.0', error: { code: JSONRPC_INTERNAL_ERROR, message: fallbackMsg }, id });
    return null;
  }
  if (result.error) {
    sendToServer({ jsonrpc: '2.0', error: { code: JSONRPC_INVALID_PARAMS, message: result.error }, id });
    return null;
  }
  return result as Record<string, unknown>;
};

/** Sends a JSONRPC_INTERNAL_ERROR with a sanitized error message. */
export const sendErrorResult = (id: string | number, err: unknown): void => {
  sendToServer({
    jsonrpc: '2.0',
    error: { code: JSONRPC_INTERNAL_ERROR, message: sanitizeErrorMessage(toErrorMessage(err)) },
    id,
  });
};

/** Sends a JSON-RPC 2.0 success response. */
export const sendSuccessResult = (id: string | number, result: unknown): void => {
  sendToServer({ jsonrpc: '2.0', result, id });
};
