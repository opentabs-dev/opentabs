import { readFileSync } from 'node:fs';
import type { ManifestType } from '@extension/shared';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

/**
 * OpenTabs - Chrome Extension
 * Connects MCP clients to Slack and Datadog via the authenticated web session
 */
const manifest = {
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extensionName__',
  version: packageJson.version,
  description: '__MSG_extensionDescription__',
  host_permissions: [
    'https://*.slack.com/*',
    'https://edgeapi.slack.com/*',
    'https://*.datadoghq.com/*',
    'https://sqlpad.production.brexapps.io/*',
    'https://sqlpad.staging.brexapps.io/*',
    'https://app.logrocket.com/*',
    'https://retool-v3.infra.brexapps.io/*',
    'https://retool-v3.staging.infra.brexapps.io/*',
    'https://app.snowflake.com/*',
  ],
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
  content_scripts: [
    // All services use the minimal stub content script for chrome API access
    // (PING/PONG health checks, TAB_READY notifications, visibility changes).
    // Actual API logic runs in MAIN world adapters registered by adapter-manager.
    {
      matches: ['https://*.slack.com/*', 'https://app.slack.com/*'],
      js: ['content/stub.iife.js'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://*.datadoghq.com/*'],
      js: ['content/stub.iife.js'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://sqlpad.production.brexapps.io/*', 'https://sqlpad.staging.brexapps.io/*'],
      js: ['content/stub.iife.js'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://app.logrocket.com/*'],
      js: ['content/stub.iife.js'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://retool-v3.infra.brexapps.io/*', 'https://retool-v3.staging.infra.brexapps.io/*'],
      js: ['content/stub.iife.js'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://app.snowflake.com/*'],
      js: ['content/stub.iife.js'],
      run_at: 'document_idle',
    },
  ],
  web_accessible_resources: [
    // MAIN world adapters (registered via chrome.scripting.registerContentScripts)
    {
      resources: ['adapters/slack.iife.js'],
      matches: ['https://*.slack.com/*', 'https://app.slack.com/*'],
    },
    {
      resources: ['adapters/datadog.iife.js'],
      matches: ['https://*.datadoghq.com/*'],
    },
    {
      resources: ['adapters/sqlpad.iife.js'],
      matches: ['https://sqlpad.production.brexapps.io/*', 'https://sqlpad.staging.brexapps.io/*'],
    },
    {
      resources: ['adapters/logrocket.iife.js'],
      matches: ['https://app.logrocket.com/*'],
    },
    {
      resources: ['adapters/retool.iife.js'],
      matches: ['https://retool-v3.infra.brexapps.io/*', 'https://retool-v3.staging.infra.brexapps.io/*'],
    },
    {
      resources: ['adapters/snowflake.iife.js'],
      matches: ['https://app.snowflake.com/*'],
    },
  ],
} satisfies ManifestType;

export default manifest;
