/**
 * MCP resource definitions for the OpenTabs server.
 *
 * Resources are static or dynamic documents that AI clients can fetch on demand
 * via `resources/read`. Unlike instructions (sent on every session), resources
 * are pull-based — clients discover them via `resources/list` and fetch content
 * when they need deeper context.
 *
 * Static resources return pre-built markdown content (guides, references).
 * The `opentabs://status` resource is dynamic — built from ServerState at read time.
 *
 * Resources include MCP annotations (audience, priority) that help AI clients
 * decide which resources to auto-include and which to present to users:
 *   - audience: ['assistant'] — content intended for the AI model
 *   - audience: ['user', 'assistant'] — content useful for both parties
 *   - priority: 0.0–1.0 — importance hint (1.0 = effectively required)
 */

import { BROWSER_TOOLS_CONTENT } from './resources/browser-tools.js';
import { CLI_CONTENT } from './resources/cli.js';
import { PLUGIN_DEVELOPMENT_CONTENT } from './resources/plugin-development.js';
import { QUICK_START_CONTENT } from './resources/quick-start.js';
import { SDK_API_CONTENT } from './resources/sdk-api.js';
import { SELF_IMPROVEMENT_CONTENT } from './resources/self-improvement.js';
import { buildStatusResource } from './resources/status.js';
import { TROUBLESHOOTING_CONTENT } from './resources/troubleshooting.js';
import type { ServerState } from './state.js';

/** MCP resource annotations per the 2025-06-18 spec */
interface ResourceAnnotations {
  audience?: Array<'user' | 'assistant'>;
  priority?: number;
}

/** A resource definition for MCP resources/list */
export interface ResourceDefinition {
  uri: string;
  name: string;
  title?: string;
  description: string;
  mimeType: string;
  annotations?: ResourceAnnotations;
}

/** A resolved resource for MCP resources/read */
export interface ResolvedResource {
  uri: string;
  mimeType: string;
  text: string;
}

/** All registered resources */
const RESOURCES: ResourceDefinition[] = [
  {
    uri: 'opentabs://guide/quick-start',
    name: 'quick-start',
    title: 'Quick Start Guide',
    description: 'Installation, configuration, and first tool call',
    mimeType: 'text/markdown',
    annotations: { audience: ['user', 'assistant'], priority: 0.7 },
  },
  {
    uri: 'opentabs://guide/plugin-development',
    name: 'plugin-development',
    title: 'Plugin Development Guide',
    description: 'Full guide to building OpenTabs plugins (SDK, patterns, conventions)',
    mimeType: 'text/markdown',
    annotations: { audience: ['assistant'], priority: 0.9 },
  },
  {
    uri: 'opentabs://guide/troubleshooting',
    name: 'troubleshooting',
    title: 'Troubleshooting Guide',
    description: 'Common errors and resolution steps',
    mimeType: 'text/markdown',
    annotations: { audience: ['assistant'], priority: 0.6 },
  },
  {
    uri: 'opentabs://reference/sdk-api',
    name: 'sdk-api',
    title: 'SDK API Reference',
    description: 'Plugin SDK API reference (utilities, errors, lifecycle hooks)',
    mimeType: 'text/markdown',
    annotations: { audience: ['assistant'], priority: 0.8 },
  },
  {
    uri: 'opentabs://reference/cli',
    name: 'cli',
    title: 'CLI Reference',
    description: 'CLI command reference (opentabs, opentabs-plugin)',
    mimeType: 'text/markdown',
    annotations: { audience: ['user', 'assistant'], priority: 0.5 },
  },
  {
    uri: 'opentabs://reference/browser-tools',
    name: 'browser-tools',
    title: 'Browser Tools Reference',
    description: 'All browser tools organized by category',
    mimeType: 'text/markdown',
    annotations: { audience: ['assistant'], priority: 0.5 },
  },
  {
    uri: 'opentabs://guide/self-improvement',
    name: 'self-improvement',
    title: 'Self-Improvement Guide',
    description:
      'How the MCP server content forms a self-improving loop — file-to-content mapping, ' +
      'contribution rules, and bootstrapping architecture',
    mimeType: 'text/markdown',
    annotations: { audience: ['assistant'], priority: 0.8 },
  },
  {
    uri: 'opentabs://status',
    name: 'status',
    title: 'Server Status',
    description: 'Live server state: loaded plugins, extension connectivity, tab states',
    mimeType: 'application/json',
    annotations: { audience: ['assistant'], priority: 0.4 },
  },
];

/** Resource URI → definition for O(1) lookup */
const RESOURCE_MAP = new Map(RESOURCES.map(r => [r.uri, r]));

/** URI → content for static resources */
const CONTENT_MAP = new Map<string, string>([
  ['opentabs://guide/quick-start', QUICK_START_CONTENT],
  ['opentabs://guide/plugin-development', PLUGIN_DEVELOPMENT_CONTENT],
  ['opentabs://guide/troubleshooting', TROUBLESHOOTING_CONTENT],
  ['opentabs://guide/self-improvement', SELF_IMPROVEMENT_CONTENT],
  ['opentabs://reference/sdk-api', SDK_API_CONTENT],
  ['opentabs://reference/cli', CLI_CONTENT],
  ['opentabs://reference/browser-tools', BROWSER_TOOLS_CONTENT],
]);

/** Return all resource definitions for resources/list, including annotations. */
export const getAllResources = (_state: ServerState): ResourceDefinition[] =>
  RESOURCES.map(r => ({
    uri: r.uri,
    name: r.name,
    ...(r.title ? { title: r.title } : {}),
    description: r.description,
    mimeType: r.mimeType,
    ...(r.annotations ? { annotations: r.annotations } : {}),
  }));

/**
 * Resolve a resource by URI, returning its content.
 * Returns null if the URI is not recognized.
 */
export const resolveResource = (state: ServerState, uri: string): ResolvedResource | null => {
  const def = RESOURCE_MAP.get(uri);
  if (!def) return null;

  if (uri === 'opentabs://status') {
    return { uri, mimeType: 'application/json', text: buildStatusResource(state) };
  }

  const content = CONTENT_MAP.get(uri);
  if (content) {
    return { uri, mimeType: def.mimeType, text: content };
  }

  // Static resources without content yet return a placeholder
  return { uri, mimeType: def.mimeType, text: `# ${def.name}\n\nContent coming soon.` };
};

/**
 * Get the text content of a static resource by URI (without needing ServerState).
 * Returns null for dynamic or unknown resources. Used by prompt resolvers to
 * embed resource content directly into prompt messages.
 */
export const getStaticResourceContent = (uri: string): string | null => CONTENT_MAP.get(uri) ?? null;
