// Offscreen document manager - handles offscreen document lifecycle and communication
// Used to maintain persistent WebSocket connection (MV3 service workers can suspend)

import { Defaults, MessageTypes } from '@extension/shared';

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

// Mutex to prevent race conditions when creating/closing offscreen document
let offscreenDocumentPromise: Promise<void> | null = null;

/**
 * Check if offscreen document exists
 */
export const hasOffscreenDocument = async (): Promise<boolean> => {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
    });
    return contexts.length > 0;
  } catch {
    // API might not be available in all contexts
    return false;
  }
};

/**
 * Ensure offscreen document exists, creating it if necessary.
 * Uses mutex to prevent race conditions during creation.
 */
export const setupOffscreenDocument = async (): Promise<void> => {
  // If there's already an operation in progress, wait for it
  if (offscreenDocumentPromise) {
    await offscreenDocumentPromise;
    // After waiting, check if we still need to create the document
    if (await hasOffscreenDocument()) {
      return;
    }
  }

  // Check if document already exists
  if (await hasOffscreenDocument()) {
    return;
  }

  // Create the document with a mutex to prevent race conditions
  offscreenDocumentPromise = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: 'Maintain persistent WebSocket connection to MCP server',
      });
    } catch (error) {
      // Check if error is because document already exists (race condition)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('single offscreen document')) {
        // Document already exists, this is fine
        return;
      }

      // Try to close any zombie document and retry
      try {
        await chrome.offscreen.closeDocument();
      } catch {
        // Ignore close errors - document might not exist
      }

      // Small delay to let things settle
      await new Promise(resolve => setTimeout(resolve, 100));

      // Retry creation if document doesn't exist
      if (!(await hasOffscreenDocument())) {
        try {
          await chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: [chrome.offscreen.Reason.BLOBS],
            justification: 'Maintain persistent WebSocket connection to MCP server',
          });
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          // If it already exists now, that's fine
          if (!retryMessage.includes('single offscreen document')) {
            // Log only unexpected errors at debug level
            console.debug('[OpenTabs] Offscreen document setup issue:', retryMessage);
          }
        }
      }
    }
  })();

  try {
    await offscreenDocumentPromise;
  } finally {
    offscreenDocumentPromise = null;
  }
};

/**
 * Send a message to the offscreen document with retry logic.
 * Handles cases where:
 * - Offscreen document doesn't exist yet
 * - Offscreen document exists but isn't ready
 * - Offscreen document crashed and needs recreation
 */
export const sendToOffscreen = async (message: Record<string, unknown>, retries = 2): Promise<unknown> => {
  await setupOffscreenDocument();

  // Small delay to ensure offscreen document is ready after creation
  await new Promise(resolve => setTimeout(resolve, 50));

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ target: 'offscreen', ...message }, response => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message ?? '';

        // If receiving end doesn't exist and we have retries left, recreate offscreen doc
        if (errorMsg.includes('Receiving end does not exist') && retries > 0) {
          console.log('[OpenTabs] Offscreen document not responding, recreating...');

          // Close and recreate offscreen document
          chrome.offscreen
            .closeDocument()
            .catch(() => {
              // Ignore - document might not exist
            })
            .then(async () => {
              // Wait a bit before recreating
              await new Promise(r => setTimeout(r, 100));
              // Retry the send
              try {
                const result = await sendToOffscreen(message, retries - 1);
                resolve(result);
              } catch (retryErr) {
                reject(retryErr);
              }
            });
        } else {
          reject(new Error(errorMsg));
        }
      } else {
        resolve(response);
      }
    });
  });
};

/**
 * Initialize WebSocket connection via offscreen document.
 * Fetches port from storage if not provided.
 * @param port Optional port to connect to. If not provided, fetches from storage or uses default.
 */
export const initializeWebSocket = async (port?: number): Promise<void> => {
  try {
    let wsPort = port;
    if (wsPort === undefined) {
      const stored = await chrome.storage.sync.get(['wsPort']);
      wsPort = (stored.wsPort as number) || Defaults.WS_PORT;
    }
    await sendToOffscreen({
      type: MessageTypes.CONNECT,
      url: `ws://127.0.0.1:${wsPort}`,
    });
  } catch (err) {
    // Log at debug level - the keepalive alarm will retry
    // This commonly happens during extension reload when offscreen doc isn't ready
    console.debug('[OpenTabs] WebSocket init deferred (will retry):', (err as Error).message);
  }
};

/**
 * Send data via WebSocket
 */
export const sendViaWebSocket = async (data: unknown): Promise<void> => {
  try {
    await sendToOffscreen({ type: MessageTypes.SEND, data });
  } catch (err) {
    console.error('[OpenTabs] Error sending via WebSocket:', err);
  }
};

/**
 * Update the WebSocket URL (e.g., when port changes)
 */
export const updateWebSocketUrl = async (port: number): Promise<void> => {
  await sendToOffscreen({ type: MessageTypes.UPDATE_URL, url: `ws://127.0.0.1:${port}` });
};
