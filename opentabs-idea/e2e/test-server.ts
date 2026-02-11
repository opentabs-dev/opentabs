/**
 * Controllable test web server for E2E tests.
 *
 * Simulates a real web application (like Slack) that an OpenTabs plugin
 * targets. The plugin's IIFE is injected into a tab opened to this server,
 * and the plugin's tools call this server's internal API endpoints via
 * same-origin fetch — exactly like a real plugin would.
 *
 * Three categories of endpoints:
 *
 * 1. **Page** — serves the HTML "app" at `/` that the browser opens.
 * 2. **Internal API** — endpoints the plugin calls via fetch:
 *      POST /api/auth.check   — readiness probe (isReady)
 *      POST /api/echo         — echo a message back
 *      POST /api/greet        — compute a greeting
 *      POST /api/list-items   — return a paginated list
 *      POST /api/status       — return server status (zero-input)
 *      POST /api/create-item  — create a new item
 *      POST /api/fail         — always returns an error
 * 3. **Control** — endpoints the test harness uses to toggle behaviour:
 *      POST /control/set-auth        — { authenticated: boolean }
 *      POST /control/set-error       — { error: boolean } (all API 500s)
 *      POST /control/set-slow        — { delayMs: number } (add latency)
 *      GET  /control/invocations     — list of all API calls received
 *      POST /control/reset           — reset all state to defaults
 *      GET  /control/health          — simple health check
 *
 * Start: `bun e2e/test-server.ts`
 * Default port: 9516 (override with PORT env var)
 */

// ---------------------------------------------------------------------------
// State — mutated by /control endpoints, read by /api endpoints
// ---------------------------------------------------------------------------

interface Invocation {
  ts: number;
  method: string;
  path: string;
  body: unknown;
}

interface ServerState {
  authenticated: boolean;
  errorMode: boolean;
  delayMs: number;
  invocations: Invocation[];
  items: Array<{
    id: string;
    name: string;
    description: string;
    created_at: string;
  }>;
  nextItemId: number;
  startedAt: number;
}

const createDefaultState = (): ServerState => ({
  authenticated: true,
  errorMode: false,
  delayMs: 0,
  invocations: [],
  items: [
    {
      id: "item-1",
      name: "Alpha",
      description: "First item",
      created_at: new Date().toISOString(),
    },
    {
      id: "item-2",
      name: "Bravo",
      description: "Second item",
      created_at: new Date().toISOString(),
    },
    {
      id: "item-3",
      name: "Charlie",
      description: "Third item",
      created_at: new Date().toISOString(),
    },
    {
      id: "item-4",
      name: "Delta",
      description: "Fourth item",
      created_at: new Date().toISOString(),
    },
    {
      id: "item-5",
      name: "Echo",
      description: "Fifth item",
      created_at: new Date().toISOString(),
    },
  ],
  nextItemId: 6,
  startedAt: Date.now(),
});

let state = createDefaultState();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });

const readBody = async (req: Request): Promise<Record<string, unknown>> => {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const recordInvocation = (req: Request, path: string, body: unknown) => {
  state.invocations.push({
    ts: Date.now(),
    method: req.method,
    path,
    body,
  });
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * If error mode is on, return a 500 JSON error. If delay mode is on, wait.
 * Returns a Response if the request should be short-circuited, or null to continue.
 */
const maybeShortCircuit = async (): Promise<Response | null> => {
  if (state.delayMs > 0) {
    await sleep(state.delayMs);
  }
  if (state.errorMode) {
    return json(
      {
        ok: false,
        error: "server_error",
        error_message: "Error mode is enabled",
      },
      500,
    );
  }
  return null;
};

/**
 * If not authenticated, return an auth error response.
 */
const requireAuth = (): Response | null => {
  if (!state.authenticated) {
    return json({
      ok: false,
      error: "not_authed",
      error_message: "Not authenticated",
    });
  }
  return null;
};

// ---------------------------------------------------------------------------
// Page HTML — the "web app" that the browser tab opens
// ---------------------------------------------------------------------------

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>E2E Test App</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; }
    h1 { color: #333; }
    .status { padding: 8px 16px; border-radius: 6px; display: inline-block; margin: 4px 0; }
    .ok { background: #d4edda; color: #155724; }
    .err { background: #f8d7da; color: #721c24; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
    #log { font-family: monospace; font-size: 12px; background: #1e1e1e; color: #d4d4d4;
           padding: 12px; border-radius: 6px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>🧪 E2E Test App</h1>
  <p>This page simulates a web application targeted by the <code>e2e-test</code> OpenTabs plugin.</p>
  <p>Auth status: <span id="auth" class="status">checking…</span></p>
  <p>Plugin adapter: <span id="adapter" class="status">checking…</span></p>
  <h3>Console log</h3>
  <div id="log"></div>
  <script>
    // Poll auth status
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth.check', { method: 'POST' });
        const data = await res.json();
        const el = document.getElementById('auth');
        el.textContent = data.ok ? 'Authenticated ✓' : 'Not authenticated ✗';
        el.className = 'status ' + (data.ok ? 'ok' : 'err');
      } catch (e) {
        const el = document.getElementById('auth');
        el.textContent = 'Server unreachable';
        el.className = 'status err';
      }
    }
    checkAuth();
    setInterval(checkAuth, 3000);

    // Check if adapter is injected
    function checkAdapter() {
      const ot = window.__openTabs;
      const el = document.getElementById('adapter');
      if (ot && ot.adapters && ot.adapters['e2e-test']) {
        el.textContent = 'Injected ✓';
        el.className = 'status ok';
      } else {
        el.textContent = 'Not injected';
        el.className = 'status err';
      }
    }
    checkAdapter();
    setInterval(checkAdapter, 1000);

    // Capture console.warn for display (OpenTabs logs tool invocations here)
    const origWarn = console.warn;
    const logEl = document.getElementById('log');
    console.warn = function(...args) {
      origWarn.apply(console, args);
      const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      logEl.textContent += text + '\\n';
      logEl.scrollTop = logEl.scrollHeight;
    };
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 9516;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- CORS preflight ---
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // --- Page ---
    if (path === "/" || path === "/index.html") {
      return new Response(PAGE_HTML, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // =======================================================================
    // Control endpoints (called by the test harness, not by the plugin)
    // =======================================================================

    if (path === "/control/set-auth" && req.method === "POST") {
      const body = await readBody(req);
      state.authenticated = body.authenticated === true;
      return json({ ok: true, authenticated: state.authenticated });
    }

    if (path === "/control/set-error" && req.method === "POST") {
      const body = await readBody(req);
      state.errorMode = body.error === true;
      return json({ ok: true, errorMode: state.errorMode });
    }

    if (path === "/control/set-slow" && req.method === "POST") {
      const body = await readBody(req);
      state.delayMs = typeof body.delayMs === "number" ? body.delayMs : 0;
      return json({ ok: true, delayMs: state.delayMs });
    }

    if (path === "/control/invocations" && req.method === "GET") {
      return json({ ok: true, invocations: state.invocations });
    }

    if (path === "/control/reset" && req.method === "POST") {
      state = createDefaultState();
      return json({ ok: true });
    }

    if (path === "/control/health" && req.method === "GET") {
      return json({
        ok: true,
        port: PORT,
        uptime: (Date.now() - state.startedAt) / 1000,
      });
    }

    if (path === "/control/diagnostics" && req.method === "GET") {
      const authCheckCalls = state.invocations.filter(
        (i) => i.path === "/api/auth.check",
      );
      const toolCalls = state.invocations.filter(
        (i) => i.path !== "/api/auth.check",
      );
      return json({
        ok: true,
        server: {
          port: PORT,
          uptime: Math.floor((Date.now() - state.startedAt) / 1000),
          authenticated: state.authenticated,
          errorMode: state.errorMode,
          delayMs: state.delayMs,
        },
        counts: {
          totalInvocations: state.invocations.length,
          authCheckCalls: authCheckCalls.length,
          toolCalls: toolCalls.length,
          items: state.items.length,
        },
        recentInvocations: state.invocations.slice(-10).map((i) => ({
          ts: i.ts,
          path: i.path,
          method: i.method,
          age: `${Date.now() - i.ts}ms ago`,
        })),
        // Has any page ever hit /api/auth.check? If yes, the adapter is alive
        // and calling isReady(). If zero, the adapter was never injected or
        // never ran isReady().
        adapterLikelyInjected: authCheckCalls.length > 0,
      });
    }

    // =======================================================================
    // Internal API endpoints (called by the plugin via same-origin fetch)
    // =======================================================================

    // --- Auth check (used by isReady) ---
    if (path === "/api/auth.check" && req.method === "POST") {
      const body = await readBody(req);
      recordInvocation(req, path, body);
      const sc = await maybeShortCircuit();
      if (sc) return sc;
      return json({ ok: state.authenticated });
    }

    // --- Echo ---
    if (path === "/api/echo" && req.method === "POST") {
      const body = await readBody(req);
      recordInvocation(req, path, body);
      const sc = await maybeShortCircuit();
      if (sc) return sc;
      const authErr = requireAuth();
      if (authErr) return authErr;
      return json({ ok: true, message: body.message ?? "" });
    }

    // --- Greet ---
    if (path === "/api/greet" && req.method === "POST") {
      const body = await readBody(req);
      recordInvocation(req, path, body);
      const sc = await maybeShortCircuit();
      if (sc) return sc;
      const authErr = requireAuth();
      if (authErr) return authErr;
      const name = (body.name as string) ?? "World";
      return json({ ok: true, greeting: `Hello, ${name}!` });
    }

    // --- List items ---
    if (path === "/api/list-items" && req.method === "POST") {
      const body = await readBody(req);
      recordInvocation(req, path, body);
      const sc = await maybeShortCircuit();
      if (sc) return sc;
      const authErr = requireAuth();
      if (authErr) return authErr;
      const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 100);
      const offset = Math.max(Number(body.offset) || 0, 0);
      const sliced = state.items.slice(offset, offset + limit);
      return json({
        ok: true,
        items: sliced.map((i) => ({ id: i.id, name: i.name })),
        total: state.items.length,
      });
    }

    // --- Status ---
    if (path === "/api/status" && req.method === "POST") {
      const body = await readBody(req);
      recordInvocation(req, path, body);
      const sc = await maybeShortCircuit();
      if (sc) return sc;
      return json({
        ok: true,
        authenticated: state.authenticated,
        uptime: Math.floor((Date.now() - state.startedAt) / 1000),
        version: "1.0.0-test",
      });
    }

    // --- Create item ---
    if (path === "/api/create-item" && req.method === "POST") {
      const body = await readBody(req);
      recordInvocation(req, path, body);
      const sc = await maybeShortCircuit();
      if (sc) return sc;
      const authErr = requireAuth();
      if (authErr) return authErr;
      const name = (body.name as string) ?? "Unnamed";
      const description = (body.description as string) ?? "";
      const item = {
        id: `item-${state.nextItemId++}`,
        name,
        description,
        created_at: new Date().toISOString(),
      };
      state.items.push(item);
      return json({ ok: true, item });
    }

    // --- Fail (always returns error) ---
    if (path === "/api/fail" && req.method === "POST") {
      const body = await readBody(req);
      recordInvocation(req, path, body);
      const sc = await maybeShortCircuit();
      if (sc) return sc;
      // Always fail, even if auth is fine — this endpoint is for testing error propagation
      const errorCode = (body.error_code as string) ?? "deliberate_failure";
      const errorMessage =
        (body.error_message as string) ?? "This tool always fails";
      return json({
        ok: false,
        error: errorCode,
        error_code: errorCode,
        error_message: errorMessage,
      });
    }

    // --- 404 ---
    return new Response("Not found", { status: 404 });
  },
});

console.log(`[e2e-test-server] Listening on http://localhost:${server.port}`);

// Export for programmatic use in tests
export { server, state };
export type { ServerState, Invocation };
