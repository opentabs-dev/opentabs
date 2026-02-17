/**
 * Strict-CSP test web server for E2E tests.
 *
 * Identical purpose to test-server.ts but applies the most restrictive
 * Content Security Policy and security headers possible. The CSP uses
 * `script-src 'none'` which blocks ALL JavaScript execution on the page —
 * no inline scripts, no external scripts, no eval, no blob URLs.
 *
 * This proves that the Chrome extension's chrome.scripting.executeScript
 * injection bypasses page CSP entirely, because it runs in a privileged
 * extension context rather than being subject to the page's CSP.
 *
 * The page HTML is purely static (no <script> tags) since they would be
 * blocked by CSP anyway. API endpoints are a subset of test-server.ts
 * (auth.check, echo, greet, status) — sufficient to prove the full flow.
 * CORS is intentionally NOT allowed — the plugin adapter runs in MAIN
 * world same-origin, so it doesn't need CORS.
 *
 * Three categories of endpoints:
 *
 * 1. **Page** — serves the HTML "app" at `/` with strict security headers.
 * 2. **Internal API** — endpoints the plugin calls via same-origin fetch:
 *      POST /api/auth.check   — readiness probe (isReady)
 *      POST /api/echo         — echo a message back
 *      POST /api/greet        — compute a greeting
 *      POST /api/status       — return server status (zero-input)
 * 3. **Control** — endpoints the test harness uses to toggle behaviour:
 *      POST /control/set-auth        — { authenticated: boolean }
 *      POST /control/set-connect-src — { connectSrcNone: boolean }
 *      POST /control/reset           — reset all state to defaults
 *      GET  /control/health          — simple health check
 *      GET  /control/invocations     — list of all API calls received
 *
 * Start: `bun e2e/strict-csp-test-server.ts`
 * Default port: 9517 (override with PORT env var, use PORT=0 for dynamic)
 */

import {
  jsonResponse,
  readBody,
  recordInvocation as sharedRecordInvocation,
  requireAuth as sharedRequireAuth,
} from './test-server-utils.js';
import type { Invocation } from './test-server-utils.js';

// ---------------------------------------------------------------------------
// State — mutated by /control endpoints, read by /api endpoints
// ---------------------------------------------------------------------------

interface ServerState {
  authenticated: boolean;
  errorMode: boolean;
  connectSrcNone: boolean;
  invocations: Invocation[];
  startedAt: number;
}

const createDefaultState = (): ServerState => ({
  authenticated: true,
  errorMode: false,
  connectSrcNone: false,
  invocations: [],
  startedAt: Date.now(),
});

let state = createDefaultState();

// ---------------------------------------------------------------------------
// Helpers — thin wrappers around shared utilities with server-specific state
// ---------------------------------------------------------------------------

const recordInvocation = (req: Request, path: string, body: unknown) => {
  sharedRecordInvocation(state.invocations, req, path, body);
};

const requireAuth = (): Response | null => sharedRequireAuth(state.authenticated, jsonResponse);

const maybeShortCircuit = (): Response | null => {
  if (state.errorMode) {
    return jsonResponse(
      {
        ok: false,
        error: 'server_error',
        error_message: 'Error mode is enabled',
      },
      500,
    );
  }
  return null;
};

// ---------------------------------------------------------------------------
// Strict security headers applied to the page response
// ---------------------------------------------------------------------------

const buildSecurityHeaders = (): Record<string, string> => ({
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    state.connectSrcNone ? "connect-src 'none'" : "connect-src 'self'",
    "img-src 'none'",
    "font-src 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
});

// ---------------------------------------------------------------------------
// Page HTML — purely static, NO scripts (blocked by CSP anyway)
// ---------------------------------------------------------------------------

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Strict CSP Test App</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; }
    h1 { color: #333; }
    .info { padding: 8px 16px; border-radius: 6px; display: inline-block; margin: 4px 0; background: #fff3cd; color: #856404; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Strict CSP Test App</h1>
  <p>This page has the most restrictive Content Security Policy possible:</p>
  <p><code>script-src 'none'</code> — ALL JavaScript execution is blocked.</p>
  <p class="info">No scripts can run on this page via normal means.</p>
  <p>The OpenTabs extension injects adapters via <code>chrome.scripting.executeScript</code>,
     which bypasses page CSP entirely.</p>
  <p>Auth status cannot be displayed (no JS). Use the control API to check.</p>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 9517;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- Page ---
    if (path === '/' || path === '/index.html') {
      return new Response(PAGE_HTML, {
        headers: {
          'Content-Type': 'text/html',
          ...buildSecurityHeaders(),
        },
      });
    }

    // =======================================================================
    // Control endpoints (called by the test harness, not by the plugin)
    // =======================================================================

    if (path === '/control/set-auth' && req.method === 'POST') {
      const body = await readBody(req);
      state.authenticated = body.authenticated === true;
      return jsonResponse({ ok: true, authenticated: state.authenticated });
    }

    if (path === '/control/set-connect-src' && req.method === 'POST') {
      const body = await readBody(req);
      state.connectSrcNone = body.connectSrcNone === true;
      return jsonResponse({ ok: true, connectSrcNone: state.connectSrcNone });
    }

    if (path === '/control/reset' && req.method === 'POST') {
      state = createDefaultState();
      return jsonResponse({ ok: true });
    }

    if (path === '/control/health' && req.method === 'GET') {
      return jsonResponse({
        ok: true,
        port: PORT,
        uptime: (Date.now() - state.startedAt) / 1000,
      });
    }

    if (path === '/control/invocations' && req.method === 'GET') {
      return jsonResponse({ ok: true, invocations: state.invocations });
    }

    // =======================================================================
    // Internal API endpoints (called by the plugin via same-origin fetch)
    // =======================================================================

    // --- Auth check (used by isReady) ---
    if (path === '/api/auth.check' && req.method === 'POST') {
      const body = await readBody(req);
      recordInvocation(req, path, body);
      const sc = maybeShortCircuit();
      if (sc) return sc;
      return jsonResponse({ ok: state.authenticated });
    }

    // --- Echo ---
    if (path === '/api/echo' && req.method === 'POST') {
      const body = await readBody(req);
      recordInvocation(req, path, body);
      const sc = maybeShortCircuit();
      if (sc) return sc;
      const authErr = requireAuth();
      if (authErr) return authErr;
      return jsonResponse({ ok: true, message: body.message ?? '' });
    }

    // --- Greet ---
    if (path === '/api/greet' && req.method === 'POST') {
      const body = await readBody(req);
      recordInvocation(req, path, body);
      const sc = maybeShortCircuit();
      if (sc) return sc;
      const authErr = requireAuth();
      if (authErr) return authErr;
      const name = typeof body.name === 'string' ? body.name : 'World';
      return jsonResponse({ ok: true, greeting: `Hello, ${name}!` });
    }

    // --- Status ---
    if (path === '/api/status' && req.method === 'POST') {
      const body = await readBody(req);
      recordInvocation(req, path, body);
      const sc = maybeShortCircuit();
      if (sc) return sc;
      return jsonResponse({
        ok: true,
        authenticated: state.authenticated,
        uptime: Math.floor((Date.now() - state.startedAt) / 1000),
        version: '1.0.0-test',
      });
    }

    // --- 404 ---
    return new Response('Not found', { status: 404 });
  },
});

console.log(`[strict-csp-test-server] Listening on http://localhost:${String(server.port)}`);

// Export for programmatic use in tests
export { server, state };
export type { ServerState, Invocation };
