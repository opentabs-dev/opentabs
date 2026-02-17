/**
 * Shared utilities for E2E test servers (test-server.ts and strict-csp-test-server.ts).
 *
 * Eliminates duplication of the Invocation interface, JSON response helper,
 * request body reader, invocation recorder, and auth checker.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Invocation {
  ts: number;
  method: string;
  path: string;
  body: unknown;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/**
 * Build a JSON response. When `cors` is true, includes Access-Control-Allow-Origin: *.
 */
export const jsonResponse = (data: unknown, status = 200, cors = false) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}),
    },
  });

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

export const readBody = async (req: Request): Promise<Record<string, unknown>> => {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------------------
// State mutation helpers
// ---------------------------------------------------------------------------

/**
 * Record an API invocation. Accepts the invocations array from the caller's
 * module-level state so the utility stays stateless.
 */
export const recordInvocation = (invocations: Invocation[], req: Request, path: string, body: unknown) => {
  invocations.push({
    ts: Date.now(),
    method: req.method,
    path,
    body,
  });
};

/**
 * If not authenticated, return an auth error response. The caller supplies its
 * own `jsonResponseFn` so that CORS behavior is preserved per-server.
 */
export const requireAuth = (
  authenticated: boolean,
  jsonResponseFn: (data: unknown, status?: number) => Response,
): Response | null => {
  if (!authenticated) {
    return jsonResponseFn({
      ok: false,
      error: 'not_authed',
      error_message: 'Not authenticated',
    });
  }
  return null;
};
