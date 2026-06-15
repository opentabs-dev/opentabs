/**
 * Generate a Firefox-compatible manifest from the canonical Chrome manifest.
 *
 * The extension ships a single Chrome Manifest V3 manifest (`manifest.json`).
 * Firefox implements MV3 but diverges from Chrome on several keys, so loading
 * the Chrome manifest unmodified produces manifest errors (invalid permissions)
 * and missing UI surfaces. This script reads `manifest.json` and emits
 * `manifest.firefox.json` with a deterministic set of transforms — no Chrome
 * file is mutated, so the Chrome build and runtime are untouched.
 *
 * The transforms are derived from the Firefox WebExtensions reference, not from
 * guesses. Each one is justified inline. The output is a manifest Firefox can
 * load without manifest-level errors; remaining *runtime* gaps (offscreen
 * document, chrome.debugger network capture) are tracked in the Firefox port
 * artifacts and are out of scope for manifest generation.
 *
 * Usage: `npm run build:firefox-manifest` (from platform/browser-extension).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = import.meta.dirname;
const chromeManifestPath = join(base, 'manifest.json');
const firefoxManifestPath = join(base, 'manifest.firefox.json');

/**
 * Permissions the Chrome manifest requests that Firefox does NOT recognize.
 * Listing an unrecognized permission makes Firefox reject or warn on the
 * manifest, so they are stripped from the Firefox build:
 *
 * - `offscreen`  — Chrome-only API. Firefox has no offscreen documents; the
 *                  persistent WebSocket must live in the background script.
 * - `sidePanel`  — Chrome-only. Firefox exposes the side panel via the
 *                  `sidebar_action` manifest key, not a permission.
 * - `tabGroups`  — Chrome-only API; Firefox has no tab-groups WebExtension API.
 * - `debugger`   — Firefox does not implement `chrome.debugger` (CDP). Network
 *                  capture via the DevTools Protocol is unavailable; the
 *                  permission is dropped so the manifest stays valid.
 */
const FIREFOX_UNSUPPORTED_PERMISSIONS = new Set(['offscreen', 'sidePanel', 'tabGroups', 'debugger']);

/**
 * Gecko application metadata. Firefox requires an explicit extension id under
 * `browser_specific_settings.gecko`; without it, signing and `about:debugging`
 * installation are unreliable. `strict_min_version` pins the baseline at 142.0 —
 * the first release where both Firefox desktop and Firefox for Android support
 * `data_collection_permissions` (declared below). OpenTabs has no legacy Firefox
 * users, so requiring a current release is safe and keeps the manifest lint fully
 * clean on both platforms.
 */
const GECKO_ID = 'opentabs@opentabs.dev';
const GECKO_STRICT_MIN_VERSION = '142.0';

interface ChromeManifest {
  background?: { service_worker?: string; type?: string };
  side_panel?: { default_path?: string };
  permissions?: string[];
  icons?: Record<string, string>;
  [key: string]: unknown;
}

const chromeManifest = JSON.parse(readFileSync(chromeManifestPath, 'utf-8')) as ChromeManifest;

// Start from a structural clone so the Chrome manifest object is never mutated.
const firefox: Record<string, unknown> = structuredClone(chromeManifest) as Record<string, unknown>;

// 1. Background: Firefox MV3 (stable) does not support `background.service_worker`.
//    It loads background logic via `background.scripts`. The esbuild bundle is a
//    single self-contained file, so the same artifact is reused as a script entry.
if (chromeManifest.background?.service_worker) {
  firefox.background = { scripts: [chromeManifest.background.service_worker] };
}

// 2. Side panel: Chrome's `side_panel` key has no Firefox equivalent. Firefox
//    renders persistent panel UI through `sidebar_action.default_panel`, pointed
//    at the same HTML entry point.
if (chromeManifest.side_panel?.default_path) {
  firefox.sidebar_action = {
    default_panel: chromeManifest.side_panel.default_path,
    default_icon: chromeManifest.icons,
    default_title: 'OpenTabs',
  };
  delete firefox.side_panel;
}

// 3. Permissions: strip Chrome-only permissions Firefox does not recognize.
if (Array.isArray(chromeManifest.permissions)) {
  firefox.permissions = chromeManifest.permissions.filter(p => !FIREFOX_UNSUPPORTED_PERMISSIONS.has(p));
}

// 4. Gecko application metadata — required for Firefox installation and signing.
//    `data_collection_permissions.required` is required by the Firefox add-on
//    linter for new submissions. OpenTabs transmits browser session data only to
//    the user's local MCP server (localhost), so the baseline declares `none`;
//    a human publisher refines this before any AMO submission.
firefox.browser_specific_settings = {
  gecko: {
    id: GECKO_ID,
    strict_min_version: GECKO_STRICT_MIN_VERSION,
    data_collection_permissions: { required: ['none'] },
  },
};

writeFileSync(firefoxManifestPath, `${JSON.stringify(firefox, null, 2)}\n`);

const droppedPermissions = (chromeManifest.permissions ?? []).filter(p => FIREFOX_UNSUPPORTED_PERMISSIONS.has(p));
console.log('[opentabs:build:firefox-manifest] Wrote manifest.firefox.json');
console.log(`[opentabs:build:firefox-manifest] Dropped Chrome-only permissions: ${droppedPermissions.join(', ')}`);
console.log('[opentabs:build:firefox-manifest] background.service_worker → background.scripts; side_panel → sidebar_action');
