import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const sdkFetchErrorCategories = defineTool({
  name: 'sdk_fetch_error_categories',
  displayName: 'SDK Fetch Error Categories',
  description:
    'Fetches an endpoint and throws a categorized ToolError based on the HTTP status code, testing error propagation through the dispatch chain',
  summary: 'Test fetch error categorization',
  icon: 'wrench',
  input: z.object({
    endpoint: z.string().describe('The relative URL to fetch (e.g., /api/status-code/401 or /api/slow-forever)'),
    timeoutMs: z.number().optional().describe('Optional timeout in milliseconds for the fetch request'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the fetch succeeded (should always be false for error tests)'),
  }),
  handle: async params => {
    const init: RequestInit = { credentials: 'include' };
    if (params.timeoutMs !== undefined) {
      init.signal = AbortSignal.timeout(params.timeoutMs);
    }

    let response: Response;
    try {
      response = await fetch(params.endpoint, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw ToolError.timeout(`Request timed out after ${String(params.timeoutMs)}ms for ${params.endpoint}`);
      }
      throw new ToolError(
        `Network error for ${params.endpoint}: ${error instanceof Error ? error.message : String(error)}`,
        'network_error',
        { category: 'internal', retryable: true },
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      const msg = `HTTP ${String(response.status)} for ${params.endpoint}: ${errorText}`;
      const status = response.status;
      if (status === 401 || status === 403) {
        throw ToolError.auth(msg);
      }
      if (status === 404) {
        throw ToolError.notFound(msg);
      }
      if (status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const retryAfterMs = retryAfter !== null ? Number(retryAfter) * 1000 : undefined;
        throw ToolError.rateLimited(msg, Number.isNaN(retryAfterMs) ? undefined : retryAfterMs);
      }
      throw ToolError.internal(msg);
    }

    return { ok: true };
  },
});
