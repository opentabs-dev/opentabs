# opentabs-plugin-{{pluginName}}

{{description}}

## Overview

This is an [OpenTabs](https://github.com/nichochar/opentabs) plugin that enables AI agents to interact with **{{displayName}}** through the user's authenticated browser session. No API tokens, bot setup, or admin approval required.

## How It Works

1. The user opens {{displayName}} in Chrome and signs in normally
2. The OpenTabs Chrome extension detects the tab and injects the adapter script
3. AI agents (Claude, etc.) call MCP tools which route through the extension to the adapter
4. The adapter makes API requests using the user's authenticated session (cookies, tokens)
5. Results flow back to the AI agent

## Project Structure

```
├── opentabs-plugin.json       # Plugin manifest — declares domains, tools, permissions
├── src/
│   ├── adapter.ts             # MAIN world script injected into the web page
│   └── tools/
│       ├── index.ts           # Tool entry point (registerTools + isHealthy)
│       └── general.ts         # Tool definitions
├── package.json
├── tsconfig.json
└── README.md
```

## Development

### Prerequisites

- [Bun](https://bun.sh/) (or Node.js 18+)
- The OpenTabs Chrome extension installed and running
- The OpenTabs MCP server running (`bun --hot packages/mcp-server/dist/index.js`)

### Setup

```bash
# Install dependencies
bun install

# Build the plugin
bun run build

# Type check without building
bun run type-check
```

### Key Files

#### `opentabs-plugin.json`

The manifest declares everything the platform needs to know about your plugin:

- **`name`**: Unique identifier, used as JSON-RPC method prefix (e.g. `{{pluginName}}.api`)
- **`adapter.domains`**: Which web pages the adapter is injected into
- **`adapter.urlPatterns`**: Chrome match patterns for tab detection
- **`service.healthCheck`**: How the platform verifies the session is alive
- **`service.authErrorPatterns`**: Strings that indicate an expired session
- **`permissions.network`**: Domains the adapter is allowed to access
- **`tools.entry`**: Path to the compiled tool registration module

#### `src/adapter.ts`

The adapter runs in the web page's JavaScript context (MAIN world). It has access to:

- `localStorage` / `sessionStorage` — for reading auth tokens
- `document.cookie` — for cookie-based auth
- `fetch()` with `credentials: 'include'` — for making authenticated API calls
- Any JavaScript globals the web app exposes

The adapter receives JSON-RPC requests and returns JSON-RPC responses. It should be a **thin transport layer** — business logic belongs in the tool definitions, not the adapter.

**Key function to customize:** `getAuth()` — extract authentication credentials from the page. Look at how the target web application stores its session:

- Open DevTools on the target web app
- Check `localStorage`, `sessionStorage`, cookies
- Look at network requests to see what auth headers are sent
- Check `window.__APP_STATE__` or similar globals

#### `src/tools/index.ts`

The entry point that the platform loads. Must export:

- **`registerTools(server)`** (required) — registers MCP tools on the server
- **`isHealthy(response, authErrorPatterns)`** (optional) — custom health check evaluation

#### `src/tools/general.ts`

Tool definitions. Each tool uses the SDK's helper functions:

- **`createToolRegistrar(server)`** — returns `{ tools, define }` for clean registration
- **`sendServiceRequest(service, params)`** — sends a request through the adapter
- **`success(data)`** / **`error(err)`** — format tool results
- **`registerErrorPatterns(patterns)`** — register domain-specific error messages

### Adding New Tools

1. Create a new file in `src/tools/` (e.g. `src/tools/search.ts`)
2. Export a registration function:

```typescript
import { createToolRegistrar, sendServiceRequest, success } from '@opentabs/plugin-sdk/server';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerSearchTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  define(
    '{{pluginName}}_search',
    {
      description: 'Search for items in {{displayName}}.',
      inputSchema: {
        query: z.string().describe('Search query'),
        limit: z.number().optional().default(20).describe('Max results'),
      },
    },
    async ({ query, limit }) => {
      const result = await sendServiceRequest('{{pluginName}}', {
        endpoint: '/api/search',
        method: 'POST',
        body: { query, limit },
      });
      return success(result);
    },
  );

  return tools;
};
```

3. Import and register it in `src/tools/index.ts`:

```typescript
import { registerSearchTools } from './search.js';

const TOOL_REGISTRATIONS: ToolRegistrationFn[] = [
  registerGeneralTools,
  registerSearchTools, // Add here
];
```

4. Rebuild: `bun run build`

### Tool Design Guidelines

- **Name tools descriptively**: `{{pluginName}}_search_items` is better than `{{pluginName}}_search`
- **Write detailed descriptions**: AI agents choose tools based on descriptions. Include what the tool does, what parameters mean, and example values.
- **Use `.describe()` on every Zod parameter**: Agents need to know what to pass
- **Return actionable data**: Include IDs and references that enable follow-up actions
- **Design for composability**: Tools should work well together (e.g. search returns IDs that other tools accept)

### Testing

#### Unit Testing with `@opentabs/plugin-test-utils`

The recommended way to test plugin tools is with `@opentabs/plugin-test-utils`, which provides a mock request provider and test harness that simulate the MCP server environment without requiring a running server, Chrome extension, or browser tabs.

```typescript
// src/tools/__tests__/general.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'; // or vitest/jest
import { createMockProvider, createTestHarness } from '@opentabs/plugin-test-utils';
import { registerTools } from '../index.js';

describe('{{pluginName}} tools', () => {
  const mock = createMockProvider();
  const harness = createTestHarness();

  beforeEach(() => {
    mock.install();
    harness.registerTools(registerTools);
  });

  afterEach(() => {
    mock.uninstall();
    harness.reset();
  });

  it('registers the expected tools', () => {
    harness.assertToolRegistered('{{pluginName}}_api_request');
  });

  it('makes an API request through the adapter', async () => {
    // Stub the adapter response
    mock.onServiceRequest('{{pluginName}}', { endpoint: '/api/items' }).resolveWith({
      items: [{ id: 1, name: 'Test Item' }],
      total: 1,
    });

    // Call the tool
    const result = await harness.callTool('{{pluginName}}_api_request', {
      endpoint: '/api/items',
      method: 'GET',
    });

    // Assert on the result
    expect(result.isError).toBe(false);
    const data = result.json<{ items: { id: number; name: string }[]; total: number }>();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].name).toBe('Test Item');

    // Verify the adapter was called correctly
    mock.assertServiceRequestMade('{{pluginName}}', { endpoint: '/api/items' });
  });

  it('handles adapter errors gracefully', async () => {
    mock.onServiceRequest('{{pluginName}}').rejectWith('Connection closed');

    const result = await harness.callTool('{{pluginName}}_api_request', {
      endpoint: '/api/items',
      method: 'GET',
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('Error');
  });
});
```

The mock provider supports:
- **`onServiceRequest(service, paramsMatch?)`** — Stub adapter responses with `.resolveWith()`, `.resolveUsing()`, or `.rejectWith()`
- **`onBrowserRequest(action, paramsMatch?)`** — Stub browser API responses
- **`history`** / **`serviceRequests`** / **`browserRequests`** — Inspect recorded calls
- **`assertServiceRequestMade(service, paramsMatch?)`** — Verify specific calls were made
- **`assertNoRequestsMade()`** — Verify no calls were made

The test harness supports:
- **`registerTools(fn)`** — Register tools from your plugin's entry point
- **`callTool(name, params)`** — Invoke a tool and get a parsed result with `.isError`, `.text`, `.json<T>()`
- **`assertToolRegistered(name)`** / **`assertToolsRegistered(names)`** — Verify tool registration

#### Manual Testing (Live)

To test your plugin against a live web application:

1. Build the plugin: `bun run build`
2. Rebuild the MCP server (if using hot reload, it picks up changes automatically)
3. Reload the Chrome extension: call the `reload_extension` MCP tool
4. Call your tools from an AI agent or via the MCP client

For the adapter, you can test directly in the browser DevTools console:

```javascript
// Check if the adapter is loaded
window.__openTabs?.adapters?.['{{pluginName}}']

// Send a test request
window.__openTabs.adapters['{{pluginName}}'].handleRequest({
  jsonrpc: '2.0',
  id: 'test-1',
  method: '{{pluginName}}.api',
  params: { endpoint: '/api/health', method: 'GET' }
}).then(console.log)
```

## Publishing

When your plugin is ready:

```bash
# Ensure it builds cleanly
bun run build
bun run type-check

# Publish to npm
npm publish
```

Users install your plugin with:

```bash
bun add opentabs-plugin-{{pluginName}}
bun run build
# Then reload the extension
```

## Adapter Patterns Reference

### Cookie-based auth (most common)

```typescript
const getAuth = (): AuthInfo | null => {
  // No explicit token needed — just use credentials: 'include' in fetch
  return { token: 'cookie-based', baseUrl: window.location.origin };
};
```

### localStorage token

```typescript
const getAuth = (): AuthInfo | null => {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  return { token, baseUrl: window.location.origin };
};
```

### CSRF token from meta tag

```typescript
const getAuth = (): AuthInfo | null => {
  const meta = document.querySelector('meta[name="csrf-token"]');
  const token = meta?.getAttribute('content');
  if (!token) return null;
  return { token, baseUrl: window.location.origin };
};
```

### Token from JavaScript global

```typescript
const getAuth = (): AuthInfo | null => {
  const appState = (window as any).__APP_STATE__;
  if (!appState?.auth?.token) return null;
  return { token: appState.auth.token, baseUrl: window.location.origin };
};
```

## License

MIT