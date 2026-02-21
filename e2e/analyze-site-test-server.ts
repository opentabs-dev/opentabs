/**
 * Analyze-site E2E test server — simulates web applications with various
 * authentication patterns, API protocols, and framework markers.
 *
 * Each scenario is served under a distinct path prefix (e.g., /cookie-session/).
 * The plugin_analyze_site browser tool opens the URL in a new tab, captures
 * network traffic, and probes the page — so these pages must simulate
 * realistic web app behavior including session cookies, CSRF tokens, API
 * calls from the client, and framework globals.
 *
 * Scenarios:
 *   /cookie-session/    — Cookie-based session auth with CSRF meta tag and REST APIs
 *   /jwt-localstorage/  — JWT token in localStorage with Bearer header API calls
 *   /graphql/           — GraphQL API endpoint with queries and a mutation
 *   /jsonrpc-app/       — JSON-RPC 2.0 API endpoint with methods
 *   /nextjs-app/        — Next.js-style SSR app with __NEXT_DATA__ and auth data in globals
 *   /apikey-app/        — API key header auth with X-API-Key on all API requests
 *   /trpc-app/          — tRPC-style API with /api/trpc/<procedure> endpoints
 *   /mixed-auth/        — Mixed auth: cookie session + CSRF meta/hidden + Bearer token from window global
 *   /websocket-app/     — WebSocket real-time connection with auth token in URL
 *   /spa-app/           — SPA with client-side pushState routing and simulated React globals
 *
 * Start: `bun e2e/analyze-site-test-server.ts`
 * Default port: 0 (dynamic, override with PORT env var)
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ServerState {
  startedAt: number;
}

const state: ServerState = {
  startedAt: Date.now(),
};

// ---------------------------------------------------------------------------
// Cookie-session scenario HTML
// ---------------------------------------------------------------------------

/**
 * Simulates a logged-in web app with:
 * - Session cookie (connect.sid) set via Set-Cookie on the page response
 * - CSRF meta tag in <head>
 * - REST API endpoints called by client-side JS on load
 * - A form with hidden CSRF input
 */
const COOKIE_SESSION_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="csrf-token" content="csrf-test-token-abc123" />
  <title>Cookie Session Test App</title>
</head>
<body>
  <div id="app">
    <h1>Dashboard</h1>
    <p id="status">Loading...</p>

    <form action="/cookie-session/api/update-profile" method="POST">
      <input type="hidden" name="authenticity_token" value="csrf-test-token-abc123" />
      <input type="text" name="display_name" placeholder="Display name" />
      <input type="email" name="email" placeholder="Email" />
      <button type="submit">Update Profile</button>
    </form>
  </div>

  <script>
    // Simulate client-side API calls that a real app would make on page load.
    // Uses relative URLs so the page works on any port.
    (async function() {
      try {
        var profileRes = await fetch('/cookie-session/api/profile', {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        });
        var itemsRes = await fetch('/cookie-session/api/items', {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        });

        var profile = await profileRes.json();
        var items = await itemsRes.json();

        document.getElementById('status').textContent =
          'Loaded: ' + profile.user.name + ', ' + items.items.length + ' items';

        // Also make a POST request to test POST detection
        await fetch('/cookie-session/api/items', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New Item', description: 'Test item' })
        });
      } catch (e) {
        document.getElementById('status').textContent = 'Error: ' + e.message;
      }
    })();
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// JWT localStorage scenario HTML
// ---------------------------------------------------------------------------

/**
 * A valid JWT structure (base64url header.payload.signature).
 * The payload contains user info for realistic detection.
 */
const JWT_TOKEN = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiJ1c2VyLTEiLCJuYW1lIjoiVGVzdCBVc2VyIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaWF0IjoxNzA5MDAwMDAwLCJleHAiOjE3MDkwODY0MDB9',
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
].join('.');

/**
 * Simulates a logged-in SPA with:
 * - JWT stored in localStorage (key: "auth_token")
 * - API calls with Authorization: Bearer <jwt> header
 * - REST API endpoints for profile and items
 */
const JWT_LOCALSTORAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>JWT LocalStorage Test App</title>
</head>
<body>
  <div id="app">
    <h1>JWT Dashboard</h1>
    <p id="status">Loading...</p>
  </div>

  <script>
    // Simulate post-login state: store JWT in localStorage
    var jwtToken = '${JWT_TOKEN}';
    localStorage.setItem('auth_token', jwtToken);

    // Delay API calls to allow the analyze-site orchestrator to enable
    // network capture after opening the tab. Without this delay, the fetch
    // calls fire before the CDP Network.enable command completes and are
    // missed by the capture.
    setTimeout(function() {
      (async function() {
        try {
          var profileRes = await fetch('/jwt-localstorage/api/me', {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + jwtToken
            }
          });
          var tasksRes = await fetch('/jwt-localstorage/api/tasks', {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + jwtToken
            }
          });

          var profile = await profileRes.json();
          var tasks = await tasksRes.json();

          document.getElementById('status').textContent =
            'Loaded: ' + profile.user.name + ', ' + tasks.tasks.length + ' tasks';

          // POST request with Bearer auth
          await fetch('/jwt-localstorage/api/tasks', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + jwtToken
            },
            body: JSON.stringify({ title: 'New Task', done: false })
          });
        } catch (e) {
          document.getElementById('status').textContent = 'Error: ' + e.message;
        }
      })();
    }, 1500);
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// GraphQL scenario HTML
// ---------------------------------------------------------------------------

/**
 * Simulates a web app backed by a GraphQL API:
 * - POST /graphql endpoint accepting { query, variables }
 * - Client-side JS fires 2 queries and 1 mutation on load
 * - Queries: GetUsers, GetItems; Mutation: CreateItem
 */
const GRAPHQL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GraphQL Test App</title>
</head>
<body>
  <div id="app">
    <h1>GraphQL Dashboard</h1>
    <p id="status">Loading...</p>
  </div>

  <script>
    // Delay API calls so the orchestrator's network capture is active
    setTimeout(function() {
      (async function() {
        try {
          // Query 1: GetUsers
          var usersRes = await fetch('/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: 'query GetUsers { users { id name email } }',
              variables: {}
            })
          });
          var usersData = await usersRes.json();

          // Query 2: GetItems
          var itemsRes = await fetch('/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: 'query GetItems { items { id title price } }',
              variables: {}
            })
          });
          var itemsData = await itemsRes.json();

          // Mutation: CreateItem
          var createRes = await fetch('/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: 'mutation CreateItem($title: String!, $price: Float!) { createItem(title: $title, price: $price) { id title price } }',
              variables: { title: 'New Widget', price: 29.99 }
            })
          });
          var createData = await createRes.json();

          document.getElementById('status').textContent =
            'Loaded: ' + usersData.data.users.length + ' users, ' +
            itemsData.data.items.length + ' items, created: ' +
            createData.data.createItem.title;
        } catch (e) {
          document.getElementById('status').textContent = 'Error: ' + e.message;
        }
      })();
    }, 1500);
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// JSON-RPC scenario HTML
// ---------------------------------------------------------------------------

/**
 * Simulates a web app backed by a JSON-RPC 2.0 API:
 * - POST /rpc endpoint accepting { jsonrpc: '2.0', method, params, id }
 * - Client-side JS fires 2 RPC calls on load: getItems and createItem
 */
const JSONRPC_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>JSON-RPC Test App</title>
</head>
<body>
  <div id="app">
    <h1>JSON-RPC Dashboard</h1>
    <p id="status">Loading...</p>
  </div>

  <script>
    // Delay API calls so the orchestrator's network capture is active
    setTimeout(function() {
      (async function() {
        try {
          // RPC call 1: getItems
          var itemsRes = await fetch('/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'getItems',
              params: { limit: 10 },
              id: 1
            })
          });
          var itemsData = await itemsRes.json();

          // RPC call 2: createItem
          var createRes = await fetch('/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'createItem',
              params: { title: 'New Item', description: 'Created via JSON-RPC' },
              id: 2
            })
          });
          var createData = await createRes.json();

          document.getElementById('status').textContent =
            'Loaded: ' + itemsData.result.items.length + ' items, created: ' +
            createData.result.item.title;
        } catch (e) {
          document.getElementById('status').textContent = 'Error: ' + e.message;
        }
      })();
    }, 1500);
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Next.js SSR scenario HTML
// ---------------------------------------------------------------------------

/**
 * Simulates a Next.js-style SSR app with:
 * - window.__NEXT_DATA__ containing session/user data and a buildId
 * - div#__next root element (triggers SPA detection via known container IDs)
 * - __NEXT_DATA__.props triggers hydration marker detection
 * - Auth-related keys (session, user, accessToken) nested in __NEXT_DATA__
 */
const NEXTJS_SSR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Next.js SSR Test App</title>
</head>
<body>
  <div id="__next">
    <div class="layout">
      <h1>Next.js Dashboard</h1>
      <p id="status">Server-rendered content</p>
    </div>
  </div>

  <script>
    // Simulate Next.js SSR hydration data.
    // Top-level 'session' key ensures globals detection flags hasAuthData.
    // The nested props.pageProps.session is the realistic Next.js pattern
    // for auth data (NextAuth.js style).
    window.__NEXT_DATA__ = {
      buildId: 'test-build-123',
      session: {
        user: {
          id: 'user-1',
          name: 'Test User',
          email: 'test@example.com'
        },
        accessToken: 'fake-next-token-abc123',
        expires: '2099-12-31T23:59:59.999Z'
      },
      props: {
        pageProps: {
          session: {
            user: {
              id: 'user-1',
              name: 'Test User',
              email: 'test@example.com'
            },
            accessToken: 'fake-next-token-abc123',
            expires: '2099-12-31T23:59:59.999Z'
          },
          items: [
            { id: 'item-1', title: 'Alpha' },
            { id: 'item-2', title: 'Bravo' }
          ]
        }
      },
      page: '/dashboard',
      query: {}
    };
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// API key header scenario HTML
// ---------------------------------------------------------------------------

/**
 * Simulates a web app that authenticates API requests with an X-API-Key header:
 * - API key stored in a JS variable (simulating app-level config)
 * - All API calls include X-API-Key header
 * - Server returns 401 without the header
 */
const APIKEY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>API Key Auth Test App</title>
</head>
<body>
  <div id="app">
    <h1>API Key Dashboard</h1>
    <p id="status">Loading...</p>
  </div>

  <script>
    // Simulate an app that uses an API key for all requests
    var apiKey = 'ak_test_1234567890abcdef1234567890abcdef';

    // Delay API calls to allow the orchestrator to enable network capture
    setTimeout(function() {
      (async function() {
        try {
          var projectsRes = await fetch('/apikey-app/api/projects', {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey
            }
          });
          var eventsRes = await fetch('/apikey-app/api/events', {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey
            }
          });

          var projects = await projectsRes.json();
          var events = await eventsRes.json();

          document.getElementById('status').textContent =
            'Loaded: ' + projects.projects.length + ' projects, ' +
            events.events.length + ' events';

          // POST request with API key
          await fetch('/apikey-app/api/events', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey
            },
            body: JSON.stringify({ name: 'page_view', data: { page: '/dashboard' } })
          });
        } catch (e) {
          document.getElementById('status').textContent = 'Error: ' + e.message;
        }
      })();
    }, 1500);
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// tRPC scenario HTML
// ---------------------------------------------------------------------------

/**
 * Simulates a web app using tRPC-style API calls:
 * - GET /api/trpc/<procedure> for queries (with input as query param)
 * - POST /api/trpc/<procedure> for mutations (with JSON body)
 * - Client-side JS fires 2 queries and 1 mutation on load
 */
const TRPC_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>tRPC Test App</title>
</head>
<body>
  <div id="app">
    <h1>tRPC Dashboard</h1>
    <p id="status">Loading...</p>
  </div>

  <script>
    // Delay API calls so the orchestrator's network capture is active
    setTimeout(function() {
      (async function() {
        try {
          // Query 1: user.list (GET with input as query param)
          var usersRes = await fetch(
            '/api/trpc/user.list?input=' + encodeURIComponent(JSON.stringify({ limit: 10 })),
            { method: 'GET', headers: { 'Content-Type': 'application/json' } }
          );
          var usersData = await usersRes.json();

          // Query 2: item.list (GET with input as query param)
          var itemsRes = await fetch(
            '/api/trpc/item.list?input=' + encodeURIComponent(JSON.stringify({ limit: 20 })),
            { method: 'GET', headers: { 'Content-Type': 'application/json' } }
          );
          var itemsData = await itemsRes.json();

          // Mutation: item.create (POST with JSON body)
          var createRes = await fetch('/api/trpc/item.create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'New Widget', price: 19.99 })
          });
          var createData = await createRes.json();

          document.getElementById('status').textContent =
            'Loaded: ' + usersData.result.data.length + ' users, ' +
            itemsData.result.data.length + ' items, created: ' +
            createData.result.data.title;
        } catch (e) {
          document.getElementById('status').textContent = 'Error: ' + e.message;
        }
      })();
    }, 1500);
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Mixed auth scenario HTML
// ---------------------------------------------------------------------------

/**
 * Simulates a real-world app (like Slack) that uses multiple auth mechanisms:
 * - Session cookie (session_id) set via Set-Cookie on the page response
 * - CSRF meta tag in <head> AND hidden input in a form
 * - Bearer token for XHR API calls, read from a window global (window.__APP_CONFIG__.apiToken)
 * - The window global also has auth-related data for globals detection
 */
const MIXED_AUTH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="csrf-token" content="csrf-mixed-token-xyz789" />
  <title>Mixed Auth Test App</title>
</head>
<body>
  <div id="app">
    <h1>Mixed Auth Dashboard</h1>
    <p id="status">Loading...</p>

    <form action="/mixed-auth/api/update-settings" method="POST">
      <input type="hidden" name="authenticity_token" value="csrf-mixed-token-xyz789" />
      <input type="text" name="setting_name" placeholder="Setting" />
      <input type="text" name="setting_value" placeholder="Value" />
      <button type="submit">Save Settings</button>
    </form>
  </div>

  <script>
    // App-level config global with auth data (simulates real apps that expose
    // tokens and session info via a server-rendered script tag).
    window.__APP_CONFIG__ = {
      apiToken: 'bearer-mixed-token-1234567890abcdef',
      session: {
        user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
        expiresAt: '2099-12-31T23:59:59Z'
      },
      appVersion: '2.4.1',
      environment: 'production'
    };

    // Delay API calls to allow the orchestrator to enable network capture
    setTimeout(function() {
      (async function() {
        try {
          var token = window.__APP_CONFIG__.apiToken;

          // GET request with Bearer token
          var dashboardRes = await fetch('/mixed-auth/api/dashboard', {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            }
          });
          var dashboard = await dashboardRes.json();

          // GET request with Bearer token
          var notificationsRes = await fetch('/mixed-auth/api/notifications', {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            }
          });
          var notifications = await notificationsRes.json();

          document.getElementById('status').textContent =
            'Loaded: ' + dashboard.data.widgets + ' widgets, ' +
            notifications.notifications.length + ' notifications';

          // POST request with Bearer token and CSRF header
          await fetch('/mixed-auth/api/actions', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token,
              'X-CSRF-Token': 'csrf-mixed-token-xyz789'
            },
            body: JSON.stringify({ action: 'mark_read', ids: ['n-1', 'n-2'] })
          });
        } catch (e) {
          document.getElementById('status').textContent = 'Error: ' + e.message;
        }
      })();
    }, 1500);
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// WebSocket scenario HTML
// ---------------------------------------------------------------------------

/**
 * Simulates a real-time web app with a WebSocket connection:
 * - Page establishes WebSocket with auth token in URL query param
 * - Server sends periodic messages (simulating real-time updates)
 * - Also makes a REST API call to test combined detection
 */
const WEBSOCKET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WebSocket Test App</title>
</head>
<body>
  <div id="app">
    <h1>WebSocket Dashboard</h1>
    <p id="status">Connecting...</p>
    <ul id="messages"></ul>
  </div>

  <script>
    // Delay WebSocket connection to allow the orchestrator to enable
    // network capture (CDP Network.enable) before the connection fires.
    setTimeout(function() {
      // Establish WebSocket connection with auth token in URL
      var wsUrl = 'ws://' + window.location.host + '/ws?token=ws-auth-token-abc123';
      var ws = new WebSocket(wsUrl);

      ws.onopen = function() {
        document.getElementById('status').textContent = 'Connected';
        ws.send(JSON.stringify({ type: 'subscribe', channel: 'updates' }));
      };

      ws.onmessage = function(event) {
        try {
          var data = JSON.parse(event.data);
          var li = document.createElement('li');
          li.textContent = data.message || JSON.stringify(data);
          document.getElementById('messages').appendChild(li);
        } catch (e) {
          // Not JSON, ignore
        }
      };

      ws.onerror = function() {
        document.getElementById('status').textContent = 'WebSocket error';
      };

      ws.onclose = function() {
        document.getElementById('status').textContent = 'Disconnected';
      };

      // Also make a REST API call to test combined detection
      fetch('/websocket-app/api/config', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      }).then(function(res) { return res.json(); }).catch(function() {});
    }, 1500);
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// SPA with client-side routing scenario HTML
// ---------------------------------------------------------------------------

/**
 * Simulates a React-like SPA with client-side routing:
 * - Simulated __REACT_DEVTOOLS_GLOBAL_HOOK__ global (triggers React framework detection)
 * - Single div#root element (triggers SPA container detection)
 * - Client-side pushState navigation between "routes"
 * - No actual React — just the globals and DOM structure the detector looks for
 */
const SPA_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SPA React Test App</title>
</head>
<body>
  <div id="root">
    <nav>
      <a href="/spa-app/home" data-route="home">Home</a>
      <a href="/spa-app/about" data-route="about">About</a>
      <a href="/spa-app/settings" data-route="settings">Settings</a>
    </nav>
    <main id="content">
      <h1>Home Page</h1>
      <p>Welcome to the SPA.</p>
    </main>
  </div>

  <script>
    // Simulate React DevTools global hook (detected by the framework probe script)
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map([[1, { version: '18.2.0', bundleType: 1 }]]),
      supportsFiber: true,
      inject: function() {},
      onCommitFiberRoot: function() {},
      onCommitFiberUnmount: function() {}
    };

    // Client-side router using pushState
    var routes = {
      home: '<h1>Home Page</h1><p>Welcome to the SPA.</p>',
      about: '<h1>About Page</h1><p>This is a single-page application.</p>',
      settings: '<h1>Settings Page</h1><p>Manage your preferences.</p>'
    };

    function navigate(route) {
      var content = routes[route] || routes.home;
      document.getElementById('content').innerHTML = content;
      history.pushState({ route: route }, '', '/spa-app/' + route);
    }

    // Handle link clicks with pushState instead of full page navigation
    document.addEventListener('click', function(e) {
      var link = e.target.closest('[data-route]');
      if (link) {
        e.preventDefault();
        navigate(link.getAttribute('data-route'));
      }
    });

    // Handle browser back/forward
    window.addEventListener('popstate', function(e) {
      if (e.state && e.state.route) {
        var content = routes[e.state.route] || routes.home;
        document.getElementById('content').innerHTML = content;
      }
    });

    // Do an initial pushState to mark SPA routing as active
    history.replaceState({ route: 'home' }, '', '/spa-app/home');
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 0;

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- WebSocket upgrade ---
    if (path === '/ws') {
      if (server.upgrade(req)) return undefined as unknown as Response;
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // --- CORS preflight ---
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization, X-CSRF-Token',
        },
      });
    }

    // --- Health check ---
    if (path === '/control/health') {
      return new Response(JSON.stringify({ ok: true, port: PORT, uptime: (Date.now() - state.startedAt) / 1000 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===================================================================
    // Cookie-session scenario
    // ===================================================================

    // Page — serves HTML with Set-Cookie header
    if (path === '/cookie-session/' || path === '/cookie-session') {
      return new Response(COOKIE_SESSION_HTML, {
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie': 'connect.sid=s%3Afake-session-id-12345.sig; Path=/; HttpOnly',
        },
      });
    }

    // REST API — GET /cookie-session/api/profile
    if (path === '/cookie-session/api/profile' && req.method === 'GET') {
      return new Response(
        JSON.stringify({
          ok: true,
          user: {
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com',
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // REST API — GET /cookie-session/api/items
    if (path === '/cookie-session/api/items' && req.method === 'GET') {
      return new Response(
        JSON.stringify({
          ok: true,
          items: [
            { id: 'item-1', name: 'Alpha', description: 'First item' },
            { id: 'item-2', name: 'Bravo', description: 'Second item' },
            { id: 'item-3', name: 'Charlie', description: 'Third item' },
          ],
          total: 3,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // REST API — POST /cookie-session/api/items
    if (path === '/cookie-session/api/items' && req.method === 'POST') {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        // ignore parse errors
      }
      return new Response(
        JSON.stringify({
          ok: true,
          item: {
            id: 'item-new',
            name: body.name ?? 'Unnamed',
            description: body.description ?? '',
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // REST API — POST /cookie-session/api/update-profile (form target)
    if (path === '/cookie-session/api/update-profile' && req.method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===================================================================
    // JWT localStorage scenario
    // ===================================================================

    // Page — serves HTML (JWT is stored client-side via localStorage)
    if (path === '/jwt-localstorage/' || path === '/jwt-localstorage') {
      return new Response(JWT_LOCALSTORAGE_HTML, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // REST API — GET /jwt-localstorage/api/me (requires Bearer token)
    if (path === '/jwt-localstorage/api/me' && req.method === 'GET') {
      const authHeader = req.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          user: {
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com',
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // REST API — GET /jwt-localstorage/api/tasks
    if (path === '/jwt-localstorage/api/tasks' && req.method === 'GET') {
      const authHeader = req.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          tasks: [
            { id: 'task-1', title: 'Review PR', done: false },
            { id: 'task-2', title: 'Deploy staging', done: true },
          ],
          total: 2,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // REST API — POST /jwt-localstorage/api/tasks
    if (path === '/jwt-localstorage/api/tasks' && req.method === 'POST') {
      const authHeader = req.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        // ignore parse errors
      }
      return new Response(
        JSON.stringify({
          ok: true,
          task: {
            id: 'task-new',
            title: body.title ?? 'Untitled',
            done: body.done ?? false,
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ===================================================================
    // GraphQL scenario
    // ===================================================================

    // Page — serves HTML
    if (path === '/graphql/' || path === '/graphql-app' || path === '/graphql-app/') {
      return new Response(GRAPHQL_HTML, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // GraphQL API — POST /graphql
    if (path === '/graphql' && req.method === 'POST') {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return new Response(JSON.stringify({ errors: [{ message: 'Invalid JSON' }] }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const query = typeof body.query === 'string' ? body.query : '';
      const variables = (body.variables ?? {}) as Record<string, unknown>;

      // Minimal GraphQL resolver
      if (query.includes('GetUsers') || query.includes('users')) {
        return new Response(
          JSON.stringify({
            data: {
              users: [
                { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
                { id: 'user-2', name: 'Bob', email: 'bob@example.com' },
              ],
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (query.includes('GetItems') || (query.includes('items') && !query.includes('createItem'))) {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                { id: 'item-1', title: 'Widget A', price: 9.99 },
                { id: 'item-2', title: 'Widget B', price: 19.99 },
                { id: 'item-3', title: 'Widget C', price: 29.99 },
              ],
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (query.includes('createItem') || query.includes('CreateItem')) {
        return new Response(
          JSON.stringify({
            data: {
              createItem: {
                id: 'item-new',
                title: variables.title ?? 'Unnamed',
                price: variables.price ?? 0,
              },
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Fallback for unknown queries
      return new Response(
        JSON.stringify({
          data: null,
          errors: [{ message: `Unknown query: ${query.slice(0, 100)}` }],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ===================================================================
    // JSON-RPC scenario
    // ===================================================================

    // Page — serves HTML
    if (path === '/jsonrpc-app/' || path === '/jsonrpc-app') {
      return new Response(JSONRPC_HTML, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // JSON-RPC API — POST /rpc
    if (path === '/rpc' && req.method === 'POST') {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const method = typeof body.method === 'string' ? body.method : '';
      const id = body.id ?? null;
      const params = (body.params ?? {}) as Record<string, unknown>;

      if (method === 'getItems') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            result: {
              items: [
                { id: 'item-1', title: 'Widget A', description: 'First widget' },
                { id: 'item-2', title: 'Widget B', description: 'Second widget' },
                { id: 'item-3', title: 'Widget C', description: 'Third widget' },
              ],
              total: 3,
            },
            id,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (method === 'createItem') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            result: {
              item: {
                id: 'item-new',
                title: params.title ?? 'Unnamed',
                description: params.description ?? '',
              },
            },
            id,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Unknown method
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not found: ${method}` },
          id,
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ===================================================================
    // Next.js SSR scenario
    // ===================================================================

    // Page — serves HTML with __NEXT_DATA__ global
    if (path === '/nextjs-app/' || path === '/nextjs-app') {
      return new Response(NEXTJS_SSR_HTML, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // ===================================================================
    // API key header scenario
    // ===================================================================

    // Page — serves HTML
    if (path === '/apikey-app/' || path === '/apikey-app') {
      return new Response(APIKEY_HTML, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // API — GET /apikey-app/api/projects (requires X-API-Key)
    if (path === '/apikey-app/api/projects' && req.method === 'GET') {
      if (!req.headers.get('x-api-key')) {
        return new Response(JSON.stringify({ error: 'API key required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          projects: [
            { id: 'proj-1', name: 'Alpha', status: 'active' },
            { id: 'proj-2', name: 'Bravo', status: 'active' },
          ],
          total: 2,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // API — GET /apikey-app/api/events (requires X-API-Key)
    if (path === '/apikey-app/api/events' && req.method === 'GET') {
      if (!req.headers.get('x-api-key')) {
        return new Response(JSON.stringify({ error: 'API key required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          events: [
            { id: 'evt-1', name: 'login', timestamp: '2026-01-01T00:00:00Z' },
            { id: 'evt-2', name: 'page_view', timestamp: '2026-01-01T00:01:00Z' },
            { id: 'evt-3', name: 'click', timestamp: '2026-01-01T00:02:00Z' },
          ],
          total: 3,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // API — POST /apikey-app/api/events (requires X-API-Key)
    if (path === '/apikey-app/api/events' && req.method === 'POST') {
      if (!req.headers.get('x-api-key')) {
        return new Response(JSON.stringify({ error: 'API key required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        // ignore parse errors
      }
      return new Response(
        JSON.stringify({
          ok: true,
          event: {
            id: 'evt-new',
            name: body.name ?? 'unknown',
            timestamp: new Date().toISOString(),
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ===================================================================
    // tRPC scenario
    // ===================================================================

    // Page — serves HTML
    if (path === '/trpc-app/' || path === '/trpc-app') {
      return new Response(TRPC_HTML, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // tRPC query — GET /api/trpc/user.list
    if (path === '/api/trpc/user.list' && req.method === 'GET') {
      return new Response(
        JSON.stringify({
          result: {
            data: [
              { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
              { id: 'user-2', name: 'Bob', email: 'bob@example.com' },
              { id: 'user-3', name: 'Charlie', email: 'charlie@example.com' },
            ],
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // tRPC query — GET /api/trpc/item.list
    if (path === '/api/trpc/item.list' && req.method === 'GET') {
      return new Response(
        JSON.stringify({
          result: {
            data: [
              { id: 'item-1', title: 'Widget A', price: 9.99 },
              { id: 'item-2', title: 'Widget B', price: 19.99 },
            ],
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // tRPC mutation — POST /api/trpc/item.create
    if (path === '/api/trpc/item.create' && req.method === 'POST') {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        // ignore parse errors
      }
      return new Response(
        JSON.stringify({
          result: {
            data: {
              id: 'item-new',
              title: body.title ?? 'Unnamed',
              price: body.price ?? 0,
            },
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ===================================================================
    // Mixed auth scenario (cookie + CSRF + Bearer from global)
    // ===================================================================

    // Page — serves HTML with Set-Cookie header for session
    if (path === '/mixed-auth/' || path === '/mixed-auth') {
      return new Response(MIXED_AUTH_HTML, {
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie': 'session=mixed-session-abcdef12345; Path=/; HttpOnly',
        },
      });
    }

    // API — GET /mixed-auth/api/dashboard (requires Bearer token)
    if (path === '/mixed-auth/api/dashboard' && req.method === 'GET') {
      const authHeader = req.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: { widgets: 5, activeUsers: 42, lastUpdated: '2026-02-21T12:00:00Z' },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // API — GET /mixed-auth/api/notifications (requires Bearer token)
    if (path === '/mixed-auth/api/notifications' && req.method === 'GET') {
      const authHeader = req.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          notifications: [
            { id: 'n-1', text: 'New comment on your post', read: false },
            { id: 'n-2', text: 'System maintenance scheduled', read: true },
          ],
          total: 2,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // API — POST /mixed-auth/api/actions (requires Bearer token + CSRF header)
    if (path === '/mixed-auth/api/actions' && req.method === 'POST') {
      const authHeader = req.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        // ignore parse errors
      }
      return new Response(
        JSON.stringify({
          ok: true,
          action: body.action ?? 'unknown',
          processed: true,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // API — POST /mixed-auth/api/update-settings (form target)
    if (path === '/mixed-auth/api/update-settings' && req.method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===================================================================
    // WebSocket scenario
    // ===================================================================

    // Page — serves HTML
    if (path === '/websocket-app/' || path === '/websocket-app') {
      return new Response(WEBSOCKET_HTML, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // REST API — GET /websocket-app/api/config (supplementary REST endpoint)
    if (path === '/websocket-app/api/config' && req.method === 'GET') {
      return new Response(
        JSON.stringify({
          ok: true,
          config: {
            refreshInterval: 5000,
            channels: ['updates', 'alerts'],
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ===================================================================
    // SPA with client-side routing scenario
    // ===================================================================

    // Page — serves SPA HTML for any /spa-app/ path (simulates catch-all route)
    if (path.startsWith('/spa-app')) {
      return new Response(SPA_HTML, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // --- 404 ---
    return new Response('Not found', { status: 404 });
  },

  // WebSocket handler for the /ws endpoint
  websocket: {
    open(ws) {
      // Send a welcome message
      ws.send(JSON.stringify({ type: 'connected', message: 'Welcome to real-time updates' }));

      // Send periodic updates (2 messages, then stop)
      let count = 0;
      const interval = setInterval(() => {
        count++;
        ws.send(JSON.stringify({ type: 'update', message: `Update #${count}`, timestamp: Date.now() }));
        if (count >= 2) clearInterval(interval);
      }, 500);
    },
    message(_ws, _message) {
      // Acknowledge subscriptions but don't need to do anything special
    },
    close() {
      // No cleanup needed
    },
  },
});

console.log(`[analyze-site-test-server] Listening on http://localhost:${String(server.port)}`);

// Ensure the process exits on SIGTERM/SIGINT
const shutdown = () => {
  void server.stop();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { server, state };
