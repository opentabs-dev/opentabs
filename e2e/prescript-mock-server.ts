/**
 * Pre-script mock server for E2E tests.
 *
 * Simulates the PR #69 Outlook/cloud.microsoft failure mode:
 * - An inline <script> in <head> fires an authenticated fetch request
 *   (as if MSAL is attaching a bearer token to outbound requests)
 * - Then immediately overwrites window.fetch synchronously, so any
 *   adapter loaded after the page bootstrap cannot intercept the token
 *
 * The pre-script (running at document_start in MAIN world) patches
 * window.fetch BEFORE this inline script runs, capturing the bearer token
 * into the plugin namespace where the adapter can read it later.
 *
 * Endpoints:
 *   GET  /           — serves PAGE_HTML (triggers the pre-script test scenario)
 *   GET  /api/v2.0/me — mock API endpoint (returns 200 so the fetch succeeds)
 *   GET  /control/server-info — returns { token } for test harness verification
 *
 * Listens on 127.0.0.1 (matching the prescript-test plugin's urlPatterns).
 * Accepts PORT=0 for ephemeral port assignment.
 * Prints 'Listening on http://127.0.0.1:<port>' on startup for fixture detection.
 */

import './orphan-guard.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';

// Per-process expected token — unique each run so tests can verify E2E identity.
// Each process instance gets a new token; /control/server-info reports the current one.
const EXPECTED_TOKEN = `outlook-mock-${Math.random().toString(36).slice(2)}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sendJson = (res: ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

// ---------------------------------------------------------------------------
// Page HTML — simulates the PR #69 failure mode
// ---------------------------------------------------------------------------

// The token is embedded at server startup so every page load uses the same
// process-level token. Tests read the expected value from /control/server-info.
const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pre-Script Mock — Outlook/MSAL Simulation</title>
  <script>
    // Simulate Outlook/cloud.microsoft bootstrap:
    // 1. Fire an authenticated fetch (MSAL attaches bearer token to outbound requests)
    // 2. Immediately overwrite window.fetch synchronously so late-loading adapters
    //    cannot intercept the bearer token from this or future requests.
    var pendingBootstrap = fetch('/api/v2.0/me', {
      headers: { Authorization: 'Bearer ${EXPECTED_TOKEN}' }
    });

    // Synchronous overwrite — any code running after this point sees the stub,
    // not the original (or pre-script-patched) fetch.
    window.fetch = function stubFetch() {
      return Promise.reject(new Error('fetch has been replaced by page bootstrap'));
    };
    window.__fetchOverrideInstalled = true;

    // Mark bootstrap complete once the initial fetch settles.
    // E2E tests wait for window.__pageBootstrapResult before asserting.
    pendingBootstrap.then(function() {
      window.__pageBootstrapResult = { ok: true };
    }).catch(function(err) {
      window.__pageBootstrapResult = { ok: false, error: String(err) };
    });
  </script>
</head>
<body>
  <h1>Pre-Script Mock Server</h1>
  <p>Simulates the PR #69 Outlook/MSAL failure mode.</p>
  <p>The inline script fired an authenticated fetch and immediately overwrote
     <code>window.fetch</code>. The pre-script (document_start, MAIN world)
     captured the bearer token before the overwrite took effect.</p>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 0;

const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;

  // --- Page ---
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE_HTML);
    return;
  }

  // --- Mock API endpoint for the page's bootstrap fetch ---
  if (path === '/api/v2.0/me' && req.method === 'GET') {
    sendJson(res, { ok: true, id: 'mock-user-1', displayName: 'Mock User' });
    return;
  }

  // --- Control endpoint: test harness reads the expected token for verification ---
  if (path === '/control/server-info' && req.method === 'GET') {
    sendJson(res, { token: EXPECTED_TOKEN });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
};

const server = http.createServer((req, res) => {
  handler(req, res).catch((err: unknown) => {
    console.error('[prescript-mock-server] Handler error:', err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr !== null ? addr.port : PORT;
  console.log(`Listening on http://127.0.0.1:${String(actualPort)}`);
});

const shutdown = () => {
  server.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { EXPECTED_TOKEN, server };
