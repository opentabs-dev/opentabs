/**
 * Mock Outlook/cloud.microsoft-style server for the pre-script POC.
 *
 * Simulates PR #69's scenario:
 *   1. Page HTML has an inline <script> that IMMEDIATELY fires
 *      fetch('/api/v2.0/me', { headers: { Authorization: 'Bearer <token>' } }).
 *      This is the "authenticated API call during app bootstrap" moment —
 *      any adapter injected later via chrome.scripting.executeScript can NOT
 *      see this call because it already happened.
 *   2. The same inline script then reassigns window.fetch to a stubbed
 *      function, mimicking MSAL's Protected Token Cache / internal fetch
 *      wrapping. Late adapters that try to monkey-patch fetch only hit the
 *      stub — they cannot observe the bearer token.
 *
 * A pre-script registered via chrome.scripting.registerContentScripts at
 * document_start in MAIN world runs BEFORE the inline <script>, so it can
 * install its fetch interceptor and capture the bearer.
 *
 * Endpoints:
 *   GET  /                 — app HTML with inline bootstrap fetch + fetch override
 *   POST /api/v2.0/me      — echo bearer token (requires Authorization)
 *   GET  /control/health   — liveness probe
 *   POST /control/reset    — reset mutable state (not strictly needed but included)
 *   GET  /control/server-info — returns { token: <expectedToken> } so tests can cross-check
 */

import './orphan-guard.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';

const EXPECTED_TOKEN = `outlook-mock-${Math.random().toString(36).slice(2, 10)}`;

const sendJson = (res: ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readRequestBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });

/**
 * The app HTML.
 *
 * The inline script MUST run synchronously at parse time so that any
 * `document_start` content script (MAIN world) is the ONLY script that
 * beats it. If this script ran from an external file, the pre-script
 * would still win, but the POC is stronger if we prove interception
 * against an inline script in <head>.
 */
const PAGE_HTML = (token: string): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>PreScript POC (mock Outlook)</title>
  <script>
    // 1. Fire authenticated API call immediately — if a document_idle adapter
    //    tries to intercept this, it's already too late.
    fetch('/api/v2.0/me', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ${token}' },
    }).then(r => r.json()).then(d => {
      window.__pageBootstrapResult = d;
      console.log('[page] /api/v2.0/me →', d);
    });

    // 2. Overwrite window.fetch to simulate MSAL wrapping. Any adapter
    //    injected LATER that tries to monkey-patch fetch will only see
    //    this stub — not the original. Pre-scripts capture the original
    //    before this reassignment happens.
    const stub = function() {
      return Promise.reject(new Error('fetch has been commandeered by the app'));
    };
    window.fetch = stub;
    window.__fetchOverrideInstalled = true;
  </script>
  <style>body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 0 20px; }</style>
</head>
<body>
  <h1>PreScript POC</h1>
  <p>This page represents a web app whose bootstrap:</p>
  <ol>
    <li>Fires an authenticated fetch <em>synchronously during head parsing</em>.</li>
    <li>Immediately overwrites <code>window.fetch</code>.</li>
  </ol>
  <p>A pre-script registered at <code>document_start</code> in MAIN world should capture the bearer token before either step runs.</p>
</body>
</html>`;

const main = async (): Promise<void> => {
  const portArg = Number(process.env.PORT ?? 0);
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    try {
      if (method === 'GET' && (url === '/' || url === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE_HTML(EXPECTED_TOKEN));
        return;
      }

      if (method === 'POST' && url === '/api/v2.0/me') {
        const authHeader = req.headers['authorization'];
        if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
          sendJson(res, { ok: false, error: 'missing_authorization' }, 401);
          return;
        }
        const token = authHeader.slice(7);
        // Consume the request body to be polite but we don't inspect it
        await readRequestBody(req).catch(() => '');
        sendJson(res, { ok: true, token, displayName: 'Mock User' });
        return;
      }

      if (method === 'GET' && url === '/control/health') {
        sendJson(res, { ok: true });
        return;
      }

      if (method === 'GET' && url === '/control/server-info') {
        sendJson(res, { ok: true, token: EXPECTED_TOKEN });
        return;
      }

      if (method === 'POST' && url === '/control/reset') {
        sendJson(res, { ok: true });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (err) {
      sendJson(res, { ok: false, error: 'server_error', message: String(err) }, 500);
    }
  });

  await new Promise<void>(resolve => server.listen(portArg, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : portArg;
  // eslint-disable-next-line no-console
  console.log(`Listening on http://127.0.0.1:${port}`);
  // eslint-disable-next-line no-console
  console.error(`[prescript-mock] expected token=${EXPECTED_TOKEN}`);

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[prescript-mock] failed to start:', err);
  process.exit(1);
});
