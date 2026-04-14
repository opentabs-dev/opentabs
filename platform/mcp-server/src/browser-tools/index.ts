/**
 * Browser tools barrel — collects all browser tool definitions into a single array.
 *
 * On module load, validates that every tool definition matches its entry in the
 * static BROWSER_TOOLS_CATALOG (name, description, and icon). This catches drift
 * when a tool's metadata changes without regenerating the catalog.
 */

import { BROWSER_TOOLS_CATALOG } from '@opentabs-dev/shared';
import { addTabsToGroup } from './add-tabs-to-group.js';
import { analyzeSiteTool } from './analyze-site.js';
import { clearConsoleLogs } from './clear-console-logs.js';
import { clearEmulation } from './clear-emulation.js';
import { clearNetworkThrottle } from './clear-network-throttle.js';
import { clickElement } from './click-element.js';
import { closeTab } from './close-tab.js';
import { createTabGroup } from './create-tab-group.js';
import type { BrowserToolDefinition } from './definition.js';
import { deleteCookies } from './delete-cookies.js';
import { disableNetworkCapture } from './disable-network-capture.js';
import { emulateDevice } from './emulate-device.js';
import { emulateVisionDeficiency } from './emulate-vision-deficiency.js';
import { enableNetworkCapture } from './enable-network-capture.js';
import { executeScript } from './execute-script.js';
import { exportHar } from './export-har.js';
import { extensionCheckAdapter } from './extension-check-adapter.js';
import { extensionForceReconnect } from './extension-force-reconnect.js';
import { extensionGetLogs } from './extension-get-logs.js';
import { extensionGetSidePanel } from './extension-get-side-panel.js';
import { extensionGetState } from './extension-get-state.js';
import { failRequest } from './fail-request.js';
import { focusTab } from './focus-tab.js';
import { forcePseudoState } from './force-pseudo-state.js';
import { fulfillRequest } from './fulfill-request.js';
import { getConsoleLogs } from './get-console-logs.js';
import { getCookies } from './get-cookies.js';
import { getCssCoverage } from './get-css-coverage.js';
import { getElementStyles } from './get-element-styles.js';
import { getNetworkRequests } from './get-network-requests.js';
import { getPageHtml } from './get-page-html.js';
import { getResourceContent } from './get-resource-content.js';
import { getStorage } from './get-storage.js';
import { getTabContent } from './get-tab-content.js';
import { getTabInfo } from './get-tab-info.js';
import { getWebSocketFrames } from './get-websocket-frames.js';
import { handleDialog } from './handle-dialog.js';
import { hoverElement } from './hover-element.js';
import { interceptRequests } from './intercept-requests.js';
import { listResources } from './list-resources.js';
import { listTabGroups } from './list-tab-groups.js';
import { listTabs } from './list-tabs.js';
import { listTabsInGroup } from './list-tabs-in-group.js';
import { navigateTab } from './navigate-tab.js';
import { openTab } from './open-tab.js';
import { pluginListTabs } from './plugin-list-tabs.js';
import { pressKey } from './press-key.js';
import { queryElements } from './query-elements.js';
import { reloadExtension } from './reload-extension.js';
import { removeTabsFromGroup } from './remove-tabs-from-group.js';
import { screenshotTab } from './screenshot-tab.js';
import { scroll } from './scroll.js';
import { selectOption } from './select-option.js';
import { setCookie } from './set-cookie.js';
import { setGeolocation } from './set-geolocation.js';
import { setMediaFeatures } from './set-media-features.js';
import { showNotification } from './show-notification.js';
import { stopIntercepting } from './stop-intercepting.js';
import { throttleNetwork } from './throttle-network.js';
import { typeText } from './type-text.js';
import { updateTabGroup } from './update-tab-group.js';
import { waitForElement } from './wait-for-element.js';

const browserTools: BrowserToolDefinition[] = [
  reloadExtension,
  listTabs,
  openTab,
  closeTab,
  navigateTab,
  focusTab,
  getTabInfo,
  listTabGroups,
  createTabGroup,
  addTabsToGroup,
  removeTabsFromGroup,
  updateTabGroup,
  listTabsInGroup,
  executeScript,
  screenshotTab,
  getTabContent,
  getPageHtml,
  getStorage,
  clickElement,
  typeText,
  selectOption,
  waitForElement,
  queryElements,
  getCookies,
  setCookie,
  deleteCookies,
  enableNetworkCapture,
  getNetworkRequests,
  getWebSocketFrames,
  exportHar,
  disableNetworkCapture,
  getConsoleLogs,
  clearConsoleLogs,
  listResources,
  getResourceContent,
  pressKey,
  scroll,
  hoverElement,
  handleDialog,
  showNotification,
  interceptRequests,
  fulfillRequest,
  failRequest,
  stopIntercepting,
  emulateDevice,
  setGeolocation,
  setMediaFeatures,
  emulateVisionDeficiency,
  clearEmulation,
  getElementStyles,
  forcePseudoState,
  getCssCoverage,
  throttleNetwork,
  clearNetworkThrottle,
  extensionGetState,
  extensionGetLogs,
  extensionGetSidePanel,
  extensionCheckAdapter,
  extensionForceReconnect,
  analyzeSiteTool,
  pluginListTabs,
];

// Validate that every tool definition matches its entry in BROWSER_TOOLS_CATALOG.
// Catches metadata drift (name, description, icon changes) and missing entries.
// Skipped when the catalog generation script is running (it imports this module to
// discover tools, but the catalog may be stale — the script itself is what updates it).
const catalogByName = new Map(BROWSER_TOOLS_CATALOG.map(entry => [entry.name, entry]));

if (!process.env.OPENTABS_GENERATING_CATALOG) {
  for (const tool of browserTools) {
    const catalogEntry = catalogByName.get(tool.name);
    if (!catalogEntry) {
      throw new Error(
        `Browser tool "${tool.name}" is defined but missing from BROWSER_TOOLS_CATALOG — run \`npm run generate:browser-tools-catalog\` to update`,
      );
    }
    const actualIcon = tool.icon ?? 'globe';
    if (tool.description !== catalogEntry.description) {
      throw new Error(
        `Browser tool "${tool.name}" description mismatch: definition has "${tool.description}" but catalog has "${catalogEntry.description}" — run \`npm run generate:browser-tools-catalog\` to update`,
      );
    }
    if (actualIcon !== catalogEntry.icon) {
      throw new Error(
        `Browser tool "${tool.name}" icon mismatch: definition has "${actualIcon}" but catalog has "${catalogEntry.icon}" — run \`npm run generate:browser-tools-catalog\` to update`,
      );
    }
    const actualGroup = tool.group ?? undefined;
    const catalogGroup = catalogEntry.group ?? undefined;
    if (actualGroup !== catalogGroup) {
      throw new Error(
        `Browser tool "${tool.name}" group mismatch: definition has "${actualGroup}" but catalog has "${catalogGroup}" — run \`npm run generate:browser-tools-catalog\` to update`,
      );
    }
  }

  for (const entry of BROWSER_TOOLS_CATALOG) {
    if (!browserTools.some(t => t.name === entry.name)) {
      throw new Error(
        `BROWSER_TOOLS_CATALOG contains "${entry.name}" but no matching browser tool definition exists — run \`npm run generate:browser-tools-catalog\` to update`,
      );
    }
  }
}

export { browserTools };
