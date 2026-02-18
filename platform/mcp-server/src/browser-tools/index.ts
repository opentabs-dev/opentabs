/**
 * Browser tools barrel — collects all browser tool definitions into a single array.
 */

import { clearConsoleLogs } from './clear-console-logs.js';
import { clickElement } from './click-element.js';
import { closeTab } from './close-tab.js';
import { deleteCookies } from './delete-cookies.js';
import { disableNetworkCapture } from './disable-network-capture.js';
import { enableNetworkCapture } from './enable-network-capture.js';
import { executeScript } from './execute-script.js';
import { focusTab } from './focus-tab.js';
import { getConsoleLogs } from './get-console-logs.js';
import { getCookies } from './get-cookies.js';
import { getNetworkRequests } from './get-network-requests.js';
import { getPageHtml } from './get-page-html.js';
import { getResourceContent } from './get-resource-content.js';
import { getStorage } from './get-storage.js';
import { getTabContent } from './get-tab-content.js';
import { getTabInfo } from './get-tab-info.js';
import { listResources } from './list-resources.js';
import { listTabs } from './list-tabs.js';
import { navigateTab } from './navigate-tab.js';
import { openTab } from './open-tab.js';
import { queryElements } from './query-elements.js';
import { reloadExtension } from './reload-extension.js';
import { screenshotTab } from './screenshot-tab.js';
import { selectOption } from './select-option.js';
import { setCookie } from './set-cookie.js';
import { typeText } from './type-text.js';
import { waitForElement } from './wait-for-element.js';
import type { BrowserToolDefinition } from './definition.js';

const browserTools: BrowserToolDefinition[] = [
  reloadExtension,
  listTabs,
  openTab,
  closeTab,
  navigateTab,
  focusTab,
  getTabInfo,
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
  disableNetworkCapture,
  getConsoleLogs,
  clearConsoleLogs,
  listResources,
  getResourceContent,
];

export { browserTools };
