import { chromium } from '@playwright/test';
import { mkdtempSync, cpSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';

// Type declaration for chrome API in page.evaluate context
declare const chrome: {
  storage: {
    sync: {
      set: (items: Record<string, unknown>, callback?: () => void) => void;
    };
  };
  runtime: {
    lastError?: { message: string };
    sendMessage: (message: unknown, callback?: () => void) => void;
  };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIST = join(__dirname, '../../../dist');

interface ToolPermissions {
  [toolId: string]: boolean;
}

interface ExtensionConfig {
  wsPort: number;
  toolPermissions?: ToolPermissions;
}

interface ExtensionFixture {
  context: BrowserContext;
  extensionId: string;
  getBackgroundPage: () => Promise<Page>;
  getSidePanelPage: () => Promise<Page>;
  getOptionsPage: () => Promise<Page>;
  setToolPermissions: (permissions: ToolPermissions) => Promise<void>;
  setWsPort: (port: number) => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * Configure the extension before loading
 *
 * Since Chrome extensions read storage for configuration, we need to
 * pre-configure this in the extension's storage or modify the defaults.
 * We do this by modifying the extension's built files.
 */
const configureExtension = (extensionDir: string, config: ExtensionConfig): void => {
  // Create a configuration file that the extension can read on startup
  // This will be injected into the background script's initial state
  const toolPermissionsJson = config.toolPermissions ? JSON.stringify(config.toolPermissions) : 'undefined';

  const configScript = `
    // E2E test configuration - injected by test harness
    (function() {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        var config = { wsPort: ${config.wsPort} };
        var toolPermissions = ${toolPermissionsJson};
        if (toolPermissions) {
          config.toolPermissions = toolPermissions;
        }
        chrome.storage.sync.set(config);
      }
    })();
  `;

  // We'll prepend this to the background.js
  const backgroundPath = join(extensionDir, 'background.js');
  const backgroundContent = readFileSync(backgroundPath, 'utf-8');
  writeFileSync(backgroundPath, configScript + '\n' + backgroundContent);
};

/**
 * Launch a browser with the extension loaded
 *
 * Playwright supports Chrome extensions via launchPersistentContext.
 * We copy the extension to a temp directory and configure it for the test port.
 */
export const launchWithExtension = async (wsPort: number): Promise<ExtensionFixture> => {
  // Create a temp directory for the user data and copy extension
  const userDataDir = mkdtempSync(join(tmpdir(), 'opentabs-e2e-'));
  const extensionDir = join(userDataDir, 'extension');

  // Copy extension to temp location so we can modify it
  cpSync(EXTENSION_DIST, extensionDir, { recursive: true });

  // Configure the extension to connect to our test server port
  configureExtension(extensionDir, { wsPort });

  // Launch Chrome with the extension
  // Note: Extensions require persistent context and can't use headless mode (use headless: false)
  // Chrome 109+ supports headless: 'new' which works with extensions in some cases
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // Extensions require headed mode
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--disable-translate',
    ],
    viewport: { width: 1280, height: 720 },
  });

  // Wait for extension to load and get its ID
  // The service worker URL format is: chrome-extension://[extension-id]/background.js
  let extensionId = '';

  // Get the background service worker
  const getBackgroundPage = async (): Promise<Page> => {
    // Wait for service worker to be registered
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Find the service worker for our extension
    const serviceWorkers = context.serviceWorkers();
    for (const worker of serviceWorkers) {
      const url = worker.url();
      if (url.includes('chrome-extension://') && url.includes('background')) {
        extensionId = url.split('/')[2];
        // For service workers, we can't directly access them as pages
        // We need to use a different approach for MV3 extensions
        break;
      }
    }

    // Note: MV3 service workers don't have a page we can navigate to
    // We'll return a new page that can be used for general testing
    const page = await context.newPage();
    return page;
  };

  // Try to get extension ID from service workers
  await new Promise(resolve => setTimeout(resolve, 2000));
  const serviceWorkers = context.serviceWorkers();
  for (const worker of serviceWorkers) {
    const url = worker.url();
    if (url.includes('chrome-extension://')) {
      extensionId = url.split('/')[2];
      break;
    }
  }

  if (!extensionId) {
    // Fallback: check background pages (for MV2 extensions)
    const backgroundPages = context.backgroundPages();
    if (backgroundPages.length > 0) {
      extensionId = backgroundPages[0].url().split('/')[2];
    }
  }

  const getSidePanelPage = async (): Promise<Page> => {
    if (!extensionId) {
      throw new Error('Extension ID not found');
    }
    const sidePanelUrl = `chrome-extension://${extensionId}/side-panel/index.html`;
    const page = await context.newPage();
    await page.goto(sidePanelUrl);
    return page;
  };

  const getOptionsPage = async (): Promise<Page> => {
    if (!extensionId) {
      throw new Error('Extension ID not found');
    }
    const optionsUrl = `chrome-extension://${extensionId}/options/index.html`;
    const page = await context.newPage();
    await page.goto(optionsUrl);
    return page;
  };

  const setToolPermissions = async (permissions: ToolPermissions): Promise<void> => {
    if (!extensionId) {
      throw new Error('Extension ID not found');
    }

    // Use the extension's options page to access chrome.storage
    const optionsUrl = `chrome-extension://${extensionId}/options/index.html`;
    const page = await context.newPage();
    await page.goto(optionsUrl);

    // Wait for page to load
    await page.waitForSelector('body', { timeout: 5000 });

    await page.evaluate(async (perms: ToolPermissions) => {
      await new Promise<void>((resolve, reject) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.sync.set({ toolPermissions: perms }, () => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        } else {
          reject(new Error('chrome.storage not available'));
        }
      });
    }, permissions);

    await page.close();

    // Give the extension time to process the storage change
    await new Promise(resolve => setTimeout(resolve, 500));
  };

  const setWsPort = async (port: number): Promise<void> => {
    if (!extensionId) {
      throw new Error('Extension ID not found');
    }

    // Use the extension's options page to set the port via chrome.runtime.sendMessage
    // This simulates what the options page does when saving a port
    const optionsUrl = `chrome-extension://${extensionId}/options/index.html`;
    const page = await context.newPage();
    await page.goto(optionsUrl);

    // Wait for page to load
    await page.waitForSelector('body', { timeout: 5000 });

    await page.evaluate(async (newPort: number) => {
      await new Promise<void>((resolve, reject) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.runtime) {
          // Save to storage and send message to background (mimics Options.tsx handlePortSave)
          chrome.storage.sync.set({ wsPort: newPort }, () => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              // Send SET_PORT message to background to trigger reconnection
              chrome.runtime.sendMessage({ type: 'set_port', port: newPort }, () => {
                if (chrome.runtime.lastError) {
                  // Ignore errors from sendMessage (background may not respond)
                }
                resolve();
              });
            }
          });
        } else {
          reject(new Error('chrome.storage or chrome.runtime not available'));
        }
      });
    }, port);

    await page.close();

    // Give the extension time to process the port change and reconnect
    await new Promise(resolve => setTimeout(resolve, 1000));
  };

  const cleanup = async (): Promise<void> => {
    await context.close();
    // Clean up temp directory
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return {
    context,
    extensionId,
    getBackgroundPage,
    getSidePanelPage,
    getOptionsPage,
    setToolPermissions,
    setWsPort,
    cleanup,
  };
};

export type { ExtensionFixture };
