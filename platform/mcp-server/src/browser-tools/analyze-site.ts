/**
 * plugin_analyze_site — comprehensively analyze a web page to help plugin
 * developers understand authentication methods, API patterns, page framework,
 * DOM structure, and storage usage.
 *
 * Produces actionable intelligence for building OpenTabs plugins: detected
 * auth mechanisms with extraction hints, classified API endpoints, framework
 * and SPA/SSR detection, DOM analysis, storage keys, and concrete tool
 * suggestions based on the observed site capabilities.
 */

import { z } from 'zod';
import { analyzeSite } from './analyze-site/index.js';
import { defineBrowserTool } from './definition.js';
import { safeUrl } from './url-validation.js';

const analyzeSiteTool = defineBrowserTool({
  name: 'plugin_analyze_site',
  description:
    'Comprehensively analyze a web page to produce actionable intelligence for building OpenTabs plugins. ' +
    'Opens the URL in a new tab, captures network traffic and WebSocket frame content, probes the page ' +
    'for frameworks, globals, auth, forms, storage, and APIs, then generates concrete tool suggestions. ' +
    'Returns: auth methods (cookies, JWT, Bearer, API keys, CSRF, Basic, custom headers, globals) with ' +
    'extraction hints; API endpoints classified by protocol (REST, GraphQL, JSON-RPC, tRPC, gRPC-Web, ' +
    'WebSocket, SSE) with sample WebSocket frame payloads for real-time API detection; framework ' +
    'detection (React, Next.js, Vue, Nuxt, Angular, Svelte, jQuery, Ember, Backbone) with SPA/SSR flags; ' +
    'non-standard window globals; forms with field names; interactive elements; data-* attributes; ' +
    'storage keys (cookies, localStorage, sessionStorage); and tool suggestions with snake_case names, ' +
    'descriptions, and implementation approaches. ' +
    'Use this when starting to develop a new plugin for a website — it tells you everything you need ' +
    'to know about how the site works. ' +
    'This is Phase 2 of the plugin development workflow. For the complete step-by-step guide ' +
    '(including auth discovery, API mapping, scaffolding, and common gotchas), use the build-plugin skill.',
  summary: 'Analyze a site for plugin development',
  icon: 'scan-search',
  group: 'Plugins',
  input: z.object({
    url: safeUrl.describe('URL of the site to analyze'),
    waitSeconds: z
      .number()
      .int()
      .positive()
      .max(25)
      .optional()
      .describe('Seconds to wait for API calls after page load (default 5, max 25)'),
  }),
  handler: async (args, state) => analyzeSite(state, args.url, args.waitSeconds),
});

export { analyzeSiteTool };
