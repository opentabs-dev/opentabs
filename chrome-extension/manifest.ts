import { SERVICE_REGISTRY } from '@extension/shared';
import { readFileSync } from 'node:fs';
import type { ManifestType } from '@extension/shared';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

/**
 * OpenTabs - Chrome Extension
 * Connects MCP clients to webapp services via the authenticated web session.
 *
 * Host permissions, content scripts, and web-accessible resources are
 * generated from the centralized SERVICE_REGISTRY.
 */

/** Convert wildcard URL patterns to https-only for manifest entries */
const toHttps = (pattern: string): string => pattern.replace('*://', 'https://');

/** Collect all URL patterns for a service across all environments */
const allPatternsFor = (def: (typeof SERVICE_REGISTRY)[number]): string[] =>
  Object.values(def.urlPatterns).flatMap(patterns => patterns.map(toHttps));

/** Host permissions: use service-specific overrides when available, otherwise derive from URL patterns */
const hostPermissions = SERVICE_REGISTRY.flatMap(def => def.hostPermissions ?? allPatternsFor(def));

/** Content scripts: one entry per service, all using the same stub */
const contentScripts = SERVICE_REGISTRY.map(def => ({
  matches: allPatternsFor(def),
  js: ['content/stub.iife.js'],
  run_at: 'document_idle' as const,
}));

/** Web-accessible resources: one entry per adapter IIFE */
const webAccessibleResources = SERVICE_REGISTRY.map(def => ({
  resources: [`adapters/${def.type}.iife.js`],
  matches: allPatternsFor(def),
}));

const manifest = {
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extensionName__',
  version: packageJson.version,
  description: '__MSG_extensionDescription__',
  host_permissions: hostPermissions,
  permissions: ['storage', 'scripting', 'tabs', 'alarms', 'offscreen', 'sidePanel'],
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
  options_page: 'options/index.html',
  action: {
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
  side_panel: {
    default_path: 'side-panel/index.html',
  },
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
  content_scripts: contentScripts,
  web_accessible_resources: webAccessibleResources,
} satisfies ManifestType;

export default manifest;
